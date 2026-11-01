import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

test("runtime role has only read-registry and append-only audit privileges", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000
  });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const role = await client.query(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = 'gptvpn_app_runtime'`
    );
    assert.equal(role.rowCount, 1);
    assert.deepEqual(role.rows[0], {
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false
    });

    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL ROLE gptvpn_app_runtime");

    const currentRole = await client.query("SELECT current_user AS role");
    assert.equal(currentRole.rows[0].role, "gptvpn_app_runtime");

    // Read-only registry access is required by the public inventory API.
    await client.query("SELECT id FROM providers LIMIT 1");
    await client.query("SELECT id FROM regions LIMIT 1");
    await client.query("SELECT id FROM vpn_servers LIMIT 1");

    // The admin audit endpoint may append and read events.
    const requestId = `ci-runtime-role-${Date.now()}`;
    const inserted = await client.query(
      `INSERT INTO admin_audit_log (actor_id, action, request_id, details)
       VALUES ('ci-runtime-role', 'CI_RUNTIME_ROLE_CHECK', $1, '{}'::jsonb)
       RETURNING id`,
      [requestId]
    );
    assert.equal(inserted.rowCount, 1);
    const readBack = await client.query(
      "SELECT request_id FROM admin_audit_log WHERE request_id = $1",
      [requestId]
    );
    assert.equal(readBack.rowCount, 1);

    async function expectPermissionDenied(sql) {
      await client.query("SAVEPOINT before_denied_statement");
      await assert.rejects(
        client.query(sql),
        /permission denied|must be owner/
      );
      await client.query("ROLLBACK TO SAVEPOINT before_denied_statement");
      await client.query("RELEASE SAVEPOINT before_denied_statement");
    }

    await expectPermissionDenied(
      "UPDATE admin_audit_log SET actor_id = 'tampered' WHERE request_id = 'missing'"
    );
    await expectPermissionDenied(
      "DELETE FROM admin_audit_log WHERE request_id = 'missing'"
    );
    await expectPermissionDenied("TRUNCATE admin_audit_log");
    await expectPermissionDenied(
      "INSERT INTO providers (id, display_name, provider_type) VALUES (gen_random_uuid(), 'not-allowed', 'PARTNER')"
    );
    await expectPermissionDenied("CREATE TABLE public.runtime_role_must_not_create (id integer)");

    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});
