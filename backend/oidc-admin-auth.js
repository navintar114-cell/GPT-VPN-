import { createPublicKey, verify as verifySignature } from "node:crypto";
import { validateAdminRoles } from "./admin-rbac.js";

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_JWKS_BYTES = 256 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;

function decodeSegment(segment, maxBytes = MAX_TOKEN_BYTES) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error("Invalid JWT segment.");
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.length > maxBytes) throw new Error("JWT segment too large.");
  return decoded;
}

function parseJsonSegment(segment, maxBytes) {
  const decoded = decodeSegment(segment, maxBytes);
  return JSON.parse(decoded.toString("utf8"));
}

function unauthorized() {
  return { ok: false, status: 401, code: "ADMIN_UNAUTHORIZED" };
}

export function createOidcAdminAuthenticator({
  issuer,
  audience,
  jwksUri,
  fetchImpl = globalThis.fetch,
  now = () => Math.floor(Date.now() / 1000),
  rolesClaim = "roles",
  clockToleranceSeconds = 60
} = {}) {
  let cachedKeys = null;
  let cacheExpiresAt = 0;
  let pendingFetch = null;

  let parsedJwksUrl;
  try {
    parsedJwksUrl = new URL(jwksUri);
  } catch {
    throw new TypeError("OIDC JWKS URL must be a valid HTTPS URL.");
  }

  if (parsedJwksUrl.protocol !== "https:") {
    throw new TypeError("OIDC JWKS URL must use HTTPS.");
  }

  if (
    typeof issuer !== "string" || !issuer.startsWith("https://") ||
    typeof audience !== "string" || !audience.trim() ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    typeof rolesClaim !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(rolesClaim) ||
    !Number.isInteger(clockToleranceSeconds) || clockToleranceSeconds < 0 || clockToleranceSeconds > 300
  ) {
    throw new TypeError("Invalid OIDC admin authenticator configuration.");
  }

  async function loadKeys(forceRefresh = false) {
    if (!forceRefresh && cachedKeys && Date.now() < cacheExpiresAt) return cachedKeys;
    if (pendingFetch) return pendingFetch;

    pendingFetch = (async () => {
      const response = await fetchImpl(parsedJwksUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });
      if (!response?.ok) throw new Error("OIDC JWKS endpoint unavailable.");
      const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
      if (declaredLength > MAX_JWKS_BYTES) throw new Error("OIDC JWKS response too large.");
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_JWKS_BYTES) throw new Error("OIDC JWKS response too large.");
      const document = JSON.parse(raw);
      if (!document || !Array.isArray(document.keys) || document.keys.length < 1 || document.keys.length > 50) {
        throw new Error("Invalid OIDC JWKS document.");
      }
      const keys = new Map();
      for (const jwk of document.keys) {
        if (
          jwk?.kty !== "RSA" ||
          (jwk.use !== undefined && jwk.use !== "sig") ||
          (jwk.alg !== undefined && jwk.alg !== "RS256") ||
          typeof jwk.kid !== "string" ||
          !/^[A-Za-z0-9._-]{1,128}$/.test(jwk.kid) ||
          typeof jwk.n !== "string" || typeof jwk.e !== "string" ||
          (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes("verify")) ||
          Object.hasOwn(jwk, "d") || Object.hasOwn(jwk, "p") ||
          Object.hasOwn(jwk, "q") || Object.hasOwn(jwk, "dp") ||
          Object.hasOwn(jwk, "dq") || Object.hasOwn(jwk, "qi")
        ) continue;
        try {
          const key = createPublicKey({ key: jwk, format: "jwk" });
          if (keys.has(jwk.kid)) throw new Error("Duplicate OIDC key ID.");
          keys.set(jwk.kid, key);
        } catch {
          throw new Error("Invalid OIDC public key.");
        }
      }
      if (keys.size === 0) throw new Error("No supported OIDC signing keys.");
      cachedKeys = keys;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return keys;
    })();

    try {
      return await pendingFetch;
    } finally {
      pendingFetch = null;
    }
  }

  return async function authenticateOidcAdmin(req) {
    try {
      const authorization = req?.headers?.authorization ?? "";
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
      if (!match || Buffer.byteLength(match[1], "utf8") > MAX_TOKEN_BYTES) return unauthorized();

      const parts = match[1].split(".");
      if (parts.length !== 3) return unauthorized();
      const header = parseJsonSegment(parts[0], 2048);
      const claims = parseJsonSegment(parts[1], 8192);
      const signature = decodeSegment(parts[2], 1024);

      if (
        !header || header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        (header.typ !== undefined && header.typ !== "JWT") ||
        Object.keys(header).some((key) => !["alg", "kid", "typ"].includes(key)) ||
        !claims || typeof claims !== "object" || Array.isArray(claims)
      ) return unauthorized();

      let keys = await loadKeys();
      let key = keys.get(header.kid);
      if (!key) {
        keys = await loadKeys(true);
        key = keys.get(header.kid);
      }
      if (!key) return unauthorized();

      const signed = Buffer.from(parts[0] + "." + parts[1], "ascii");
      if (!verifySignature("RSA-SHA256", signed, key, signature)) return unauthorized();

      const currentTime = now();
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (
        claims.iss !== issuer ||
        !audiences.includes(audience) ||
        (audiences.length > 1 && claims.azp !== audience) ||
        typeof claims.sub !== "string" || !claims.sub.trim() || claims.sub.length > 255 ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= currentTime - clockToleranceSeconds ||
        !Number.isFinite(claims.iat) ||
        claims.iat > currentTime + clockToleranceSeconds ||
        (claims.nbf !== undefined && (
          !Number.isFinite(claims.nbf) ||
          claims.nbf > currentTime + clockToleranceSeconds
        ))
      ) return unauthorized();

      const roles = claims[rolesClaim] ?? [];
      if (!validateAdminRoles(roles)) return unauthorized();

      return {
        ok: true,
        actorId: claims.sub,
        principal: {
          subject: claims.sub,
          roles: [...new Set(roles)]
        }
      };
    } catch {
      return unauthorized();
    }
  };
}
