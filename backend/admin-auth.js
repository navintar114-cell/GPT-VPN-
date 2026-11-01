import { createHash, timingSafeEqual } from "node:crypto";
import { validateAdminRoles } from "./admin-rbac.js";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export function authenticateAdmin(req, config = {}) {
  const { tokenSha256, actorId, roles = [] } = config;
  if (
    typeof tokenSha256 !== "string" ||
    !SHA256_HEX.test(tokenSha256) ||
    typeof actorId !== "string" ||
    !actorId.trim() ||
    !validateAdminRoles(roles)
  ) {
    return { ok: false, status: 503, code: "ADMIN_AUTH_NOT_CONFIGURED" };
  }

  const authorization = req.headers.authorization ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) {
    return { ok: false, status: 401, code: "ADMIN_UNAUTHORIZED" };
  }

  const presented = createHash("sha256").update(match[1], "utf8").digest();
  const expected = Buffer.from(tokenSha256, "hex");
  if (!timingSafeEqual(presented, expected)) {
    return { ok: false, status: 401, code: "ADMIN_UNAUTHORIZED" };
  }

  return {
    ok: true,
    actorId: actorId.trim(),
    principal: { subject: actorId.trim(), roles: [...new Set(roles)] }
  };
}

export async function recordAdminAuditEvent(pool, event) {
  const {
    actorId,
    action,
    targetType = null,
    targetId = null,
    requestId,
    details = {}
  } = event ?? {};

  if (
    typeof actorId !== "string" || !actorId.trim() ||
    typeof action !== "string" || !/^[A-Z][A-Z0-9_]{1,79}$/.test(action) ||
    typeof requestId !== "string" || !requestId.trim() ||
    (targetType !== null && (typeof targetType !== "string" || targetType.length > 80)) ||
    (targetId !== null && (typeof targetId !== "string" || targetId.length > 160)) ||
    !details || typeof details !== "object" || Array.isArray(details)
  ) {
    throw new TypeError("Invalid admin audit event.");
  }

  if (
    Object.getPrototypeOf(details) !== Object.prototype &&
    Object.getPrototypeOf(details) !== null
  ) {
    throw new TypeError("Audit details must be a plain JSON object.");
  }

  let serializedDetails;
  try {
    serializedDetails = JSON.stringify(details);
  } catch {
    throw new TypeError("Audit details must be JSON-serializable.");
  }

  if (
    typeof serializedDetails !== "string" ||
    Buffer.byteLength(serializedDetails, "utf8") > 8192
  ) {
    throw new TypeError("Audit details must serialize to at most 8192 bytes.");
  }

  await pool.query(
    `INSERT INTO admin_audit_log
      (actor_id, action, target_type, target_id, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actorId.trim(),
      action,
      targetType,
      targetId,
      requestId,
      serializedDetails
    ]
  );
}
