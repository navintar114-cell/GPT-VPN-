import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const rateWindowMs = 60_000;
const rateLimit = 60;
const requestsByIp = new Map();

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify({ ...payload, requestId });
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId
  });
  res.end(body);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;

  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  return true;
}

function isRateLimited(req) {
  const ip = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const current = requestsByIp.get(ip);

  if (!current || now - current.startedAt >= rateWindowMs) {
    requestsByIp.set(ip, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > rateLimit;
}

export function createServer() {
  return http.createServer((req, res) => {
    const requestId = randomUUID();

    if (!applyCors(req, res)) {
      return sendJson(res, 403, {
        error: { code: "ORIGIN_NOT_ALLOWED", message: "This origin is not allowed." }
      }, requestId);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (isRateLimited(req)) {
      return sendJson(res, 429, {
        error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." }
      }, requestId);
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/v1/health") {
      return sendJson(res, 200, {
        status: "ok",
        service: "gpt-vpn-control-plane",
        scope: "control-plane-only",
        vpnDataPlane: "not-configured"
      }, requestId);
    }

    if (req.method === "GET" && pathname === "/v1/regions") {
      return sendJson(res, 200, {
        items: [],
        count: 0,
        source: "verified_registry",
        message: "No verified production regions are configured."
      }, requestId);
    }

    if (req.method === "GET" && pathname === "/v1/servers") {
      return sendJson(res, 200, {
        items: [],
        count: 0,
        source: "verified_registry",
        message: "No verified production servers are configured."
      }, requestId);
    }

    if (
      (req.method === "POST" && (pathname === "/v1/sessions" || /^\/v1\/servers\/[^/]+\/peers$/.test(pathname))) ||
      (req.method === "DELETE" && /^\/v1\/sessions\/[^/]+$/.test(pathname))
    ) {
      return sendJson(res, 503, {
        error: {
          code: "PROVISIONING_NOT_CONFIGURED",
          message: "VPN session and WireGuard peer provisioning are not implemented."
        }
      }, requestId);
    }

    return sendJson(res, 404, {
      error: { code: "NOT_FOUND", message: "Route not found." }
    }, requestId);
  });
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const server = createServer();
  server.listen(PORT, HOST, () => {
    // Do not log request URLs, user identifiers, or VPN traffic metadata.
    console.log(`GPT VPN control-plane API listening on ${HOST}:${PORT}`);
  });
}
