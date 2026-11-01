import test from "node:test";
import assert from "node:assert/strict";
import { recordAdminAuditEvent } from "../admin-auth.js";

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    }
  };
}

function event(details = {}) {
  return {
    actorId: "test-admin",
    action: "TEST_AUDIT_EVENT",
    requestId: "test-request-id",
    details
  };
}

test("audit event accepts bounded plain JSON details", async () => {
  const pool = fakePool();
  await recordAdminAuditEvent(pool, event({ source: "unit-test", count: 2 }));
  assert.equal(pool.calls.length, 1);
  assert.equal(JSON.parse(pool.calls[0].values[5]).source, "unit-test");
});

test("audit event rejects details larger than 8192 UTF-8 bytes", async () => {
  const pool = fakePool();
  await assert.rejects(
    recordAdminAuditEvent(pool, event({ note: "x".repeat(8192) })),
    /at most 8192 bytes/
  );
  assert.equal(pool.calls.length, 0);
});

test("audit event rejects arrays, class instances, and non-serializable details", async () => {
  const pool = fakePool();
  class CustomDetails { constructor() { this.value = "x"; } }
  const circular = {};
  circular.self = circular;

  for (const details of [[], new CustomDetails(), circular, { value: 1n }]) {
    await assert.rejects(
      recordAdminAuditEvent(pool, event(details)),
      TypeError
    );
  }
  assert.equal(pool.calls.length, 0);
});
