const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(["audit:read"]),
  security_auditor: Object.freeze(["audit:read"]),
  support_readonly: Object.freeze([])
});

export const ADMIN_ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));

export function authorizeAdmin(principal, permission) {
  if (
    !principal ||
    typeof principal.subject !== "string" ||
    !principal.subject.trim() ||
    !Array.isArray(principal.roles) ||
    typeof permission !== "string" ||
    !permission.trim()
  ) {
    return { allowed: false, code: "ADMIN_FORBIDDEN" };
  }

  const allowed = principal.roles.some((role) =>
    Object.hasOwn(ROLE_PERMISSIONS, role) &&
    ROLE_PERMISSIONS[role].includes(permission)
  );

  return allowed
    ? { allowed: true }
    : { allowed: false, code: "ADMIN_FORBIDDEN" };
}

export function validateAdminRoles(roles) {
  if (!Array.isArray(roles)) return false;
  return roles.every((role) =>
    typeof role === "string" && Object.hasOwn(ROLE_PERMISSIONS, role)
  );
}
