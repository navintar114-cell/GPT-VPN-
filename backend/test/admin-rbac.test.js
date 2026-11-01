import test from "node:test";
import assert from "node:assert/strict";
import { authorizeAdmin, validateAdminRoles } from "../admin-rbac.js";

test("admin and security auditor can read the audit log", () => {
  for (const role of ["admin", "security_auditor"]) {
    assert.deepEqual(
      authorizeAdmin({ subject: "user-1", roles: [role] }, "audit:read"),
      { allowed: true }
    );
  }
});

test("support read-only role cannot access the audit log", () => {
  assert.deepEqual(
    authorizeAdmin({ subject: "user-2", roles: ["support_readonly"] }, "audit:read"),
    { allowed: false, code: "ADMIN_FORBIDDEN" }
  );
});

test("unknown roles and malformed principals fail closed", () => {
  assert.equal(validateAdminRoles(["admin"]), true);
  assert.equal(validateAdminRoles(["root"]), false);
  assert.equal(validateAdminRoles("admin"), false);
  assert.equal(authorizeAdmin(null, "audit:read").allowed, false);
  assert.equal(authorizeAdmin({ subject: " ", roles: ["admin"] }, "audit:read").allowed, false);
});

test("role arrays with duplicates remain valid for safe deduplication by authentication", () => {
  assert.equal(validateAdminRoles(["admin", "admin"]), true);
});
