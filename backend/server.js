import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { authenticateAdmin, recordAdminAuditEvent } from "./admin-auth.js";

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
let poolPromise;

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined
    }));
  }
  return poolPromise;
}

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

const verifiedServerPredicate = `
  s.status = 'ACTIVE'
  AND s.verified_at IS NOT NULL
  AND s.last_health_check >= NOW() - INTERVAL '5 minutes'
  AND s.capacity_state = 'AVAILABLE'
  AND p.status = 'VERIFIED'
  AND p.permission_verified_at IS NOT NULL
  AND NULLIF(BTRIM(p.permission_evidence_url), '') IS NOT NULL
  AND p.reviewed_at IS NOT NULL
  AND NULLIF(BTRIM(p.reviewed_by), '') IS NOT NULL
`;

export function createServer({
  getPoolImpl = getPool,
  adminAuthConfig = {
    tokenSha256: process.env.ADMIN_API_TOKEN_SHA256,
    actorId: process.env.ADMIN_API_TOKEN_ACTOR_ID
  }
} = {}) {
  return http.createServer(async (req, res) => {
    const requestId = randomUUID();

    try {
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
        let database = "not-configured";
        const pool = await getPoolImpl();
        if (pool) {
          try {
            await pool.query("SELECT 1");
            database = "ok";
          } catch {
            database = "unavailable";
          }
        }
        return sendJson(res, 200, {
          status: "ok",
          service: "gpt-vpn-control-plane",
          scope: "control-plane-only",
          database,
          vpnDataPlane: "not-configured"
        }, requestId);
      }

      if (req.method === "GET" && pathname === "/v1/admin/audit-log") {
        const auth = authenticateAdmin(req, adminAuthConfig);
        if (!auth.ok) {
          const message = auth.status === 503
            ? "Admin authentication is not configured."
            : "Valid admin credentials are required.";
          return sendJson(res, auth.status, {
            error: { code: auth.code, message }
          }, requestId);
        }

        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return sendJson(res, 400, {
            error: { code: "INVALID_LIMIT", message: "limit must be an integer from 1 to 100." }
          }, requestId);
        }

        const pool = await getPoolImpl();
        if (!pool) {
          return sendJson(res, 503, {
            error: { code: "DATABASE_NOT_CONFIGURED", message: "The audit registry is unavailable." }
          }, requestId);
        }

        await recordAdminAuditEvent(pool, {
          actorId: auth.actorId,
          action: "ADMIN_AUDIT_LOG_READ",
          targetType: "admin_audit_log",
          requestId
        });
        const result = await pool.query(
          `SELECT id, actor_id AS "actorId", action,
                  target_type AS "targetType", target_id AS "targetId",
                  request_id AS "requestId", details,
                  created_at AS "createdAt"
           FROM admin_audit_log
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        );
        return sendJson(res, 200, {
          items: result.rows,
          count: result.rowCount
        }, requestId);
      }

      if (req.method === "GET" && pathname === "/v1/regions") {
        const pool = await getPoolImpl();
        if (!pool) {
          return sendJson(res, 200, {
            items: [],
            count: 0,
            source: "verified_registry",
            registry: "not-configured",
            message: "No database is configured; no production regions are available."
          }, requestId);
        }

        const result = await pool.query(`
          SELECT DISTINCT r.id, r.country_code AS "countryCode",
                 r.name, r.continent
          FROM regions r
          JOIN vpn_servers s ON s.region_id = r.id
          JOIN providers p ON p.id = s.provider_id
          WHERE ${verifiedServerPredicate}
          ORDER BY r.continent, r.name
        `);
        return sendJson(res, 200, {
          items: result.rows,
          count: result.rowCount,
          source: "verified_registry",
          registry: "connected"
        }, requestId);
      }

      if (req.method === "GET" && pathname === "/v1/servers") {
        const pool = await getPoolImpl();
        if (!pool) {
          return sendJson(res, 200, {
            items: [],
            count: 0,
            source: "verified_registry",
            registry: "not-configured",
            message: "No database is configured; no production servers are available."
          }, requestId);
        }

        const values = [];
        let regionFilter = "";
        const regionId = url.searchParams.get("regionId");
        if (regionId) {
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (!uuidPattern.test(regionId)) {
            return sendJson(res, 400, {
              error: { code: "INVALID_REGION_ID", message: "regionId must be a valid UUID." }
            }, requestId);
          }
          values.push(regionId);
          regionFilter = " AND r.id = $1";
        }

        const result = await pool.query(`
          SELECT s.id, r.country_code AS "countryCode",
                 r.name AS region, p.provider_type AS "providerType",
                 p.display_name AS "providerName",
                 s.wireguard_endpoint AS "wireGuardEndpoint",
                 s.wireguard_public_key AS "publicKey",
                 s.capacity_state AS "capacityState",
                 s.last_health_check AS "lastHealthCheck",
                 s.verified_at AS "verifiedAt"
          FROM vpn_servers s
          JOIN regions r ON r.id = s.region_id
          JOIN providers p ON p.id = s.provider_id
          WHERE ${verifiedServerPredicate} ${regionFilter}
          ORDER BY s.last_health_check DESC
        `, values);
        return sendJson(res, 200, {
          items: result.rows,
          count: result.rowCount,
          source: "verified_registry",
          registry: "connected"
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
    } catch {
      // Deliberately avoid logging database errors, request URLs, or user traffic metadata.
      return sendJson(res, 503, {
        error: { code: "SERVICE_UNAVAILABLE", message: "The registry service is temporarily unavailable." }
      }, requestId);
    }
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
