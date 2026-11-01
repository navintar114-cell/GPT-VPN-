import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createServer } from "../../server.js";

test("admin audit API writes and reads a PostgreSQL audit event; append-only triggers reject mutation", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000
  });
  const token = "ci-only-admin-token-never-used-outside-this-test";
  const tokenSha256 = createHash("sha256").update(token).digest("hex");
  const actorId = "ci-postgres-admin";
  const server = createServer({
    getPoolImpl: async () => pool,
    adminAuthConfig: { tokenSha256, actorId }
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const denied = await fetch(`${baseUrl}/v1/admin/audit-log`);
    const deniedBody = await denied.json();
    assert.equal(denied.status, 401);
    assert.equal(deniedBody.error.code, "ADMIN_UNAUTHORIZED");

    const invalidLimit = await fetch(`${baseUrl}/v1/admin/audit-log?limit=101`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const invalidLimitBody = await invalidLimit.json();
    assert.equal(invalidLimit.status, 400);
    assert.equal(invalidLimitBody.error.code, "INVALID_LIMIT");

    const response = await fetch(`${baseUrl}/v1/admin/audit-log?limit=10`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].actorId, actorId);
    assert.equal(body.items[0].action, "ADMIN_AUDIT_LOG_READ");
    assert.equal(body.items[0].targetType, "admin_audit_log");
    assert.equal(typeof body.items[0].requestId, "string");
    assert.equal(body.items[0].requestId, response.headers.get("x-request-id"));

    const persisted = await pool.query(
      `SELECT actor_id, action, request_id, details
       FROM admin_audit_log WHERE request_id = $1`,
      [body.items[0].requestId]
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].actor_id, actorId);
    assert.equal(persisted.rows[0].action, "ADMIN_AUDIT_LOG_READ");
    assert.equal(JSON.stringify(persisted.rows[0].details).includes(token), false);

    const client = await pool.connect();
    const fixtureId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO admin_audit_log
          (actor_id, action, request_id, details)
         VALUES ($1, 'CI_APPEND_ONLY_CHECK', $2, '{}'::jsonb)`,
        [actorId, fixtureId]
      );

      await client.query("SAVEPOINT before_update");
      await assert.rejects(
        client.query("UPDATE admin_audit_log SET actor_id = 'tampered' WHERE request_id = $1", [fixtureId]),
        /append-only/
      );
      await client.query("ROLLBACK TO SAVEPOINT before_update");

      await client.query("SAVEPOINT before_delete");
      await assert.rejects(
        client.query("DELETE FROM admin_audit_log WHERE request_id = $1", [fixtureId]),
        /append-only/
      );
      await client.query("ROLLBACK TO SAVEPOINT before_delete");

      await client.query("SAVEPOINT before_truncate");
      await assert.rejects(client.query("TRUNCATE admin_audit_log"), /append-only/);
      await client.query("ROLLBACK TO SAVEPOINT before_truncate");

      const fixture = await client.query(
        "SELECT 1 FROM admin_audit_log WHERE request_id = $1",
        [fixtureId]
      );
      assert.equal(fixture.rowCount, 1);
      await client.query("ROLLBACK");
    } finally {
      if (!client._ending) {
        await client.query("ROLLBACK").catch(() => {});
      }
      client.release();
    }
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
    await pool.end();
  }
});
