import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createServer } from "../../server.js";

test("PostgreSQL-backed inventory exposes only active, healthy servers from evidenced VERIFIED providers", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000
  });
  const ids = {
    verifiedProvider: randomUUID(),
    pendingProvider: randomUUID(),
    region: randomUUID(),
    eligibleServer: randomUUID(),
    pendingProviderServer: randomUUID(),
    staleServer: randomUUID(),
    inactiveServer: randomUUID(),
    fullServer: randomUUID()
  };
  let server;
  let committed = false;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO providers (
        id, display_name, provider_type, status, permission_verified_at,
        permission_evidence_url, reviewed_at, reviewed_by
      ) VALUES ($1, 'CI verified provider', 'PARTNER', 'VERIFIED', NOW(),
                'https://evidence.invalid/ci-permission', NOW(), 'ci-integration-reviewer')`,
      [ids.verifiedProvider]
    );
    await client.query(
      `INSERT INTO providers (id, display_name, provider_type, status)
       VALUES ($1, 'CI pending provider', 'PARTNER', 'PENDING')`,
      [ids.pendingProvider]
    );
    await client.query(
      `INSERT INTO regions (id, country_code, name, continent)
       VALUES ($1, 'ZZ', 'CI Integration Region', 'Test')`,
      [ids.region]
    );

    const insertServer = async (id, providerId, status, capacity, healthSql = "NOW()") => {
      await client.query(
        `INSERT INTO vpn_servers (
          id, provider_id, region_id, provider_type, wireguard_endpoint,
          wireguard_public_key, capacity_state, status, last_health_check, verified_at
        ) VALUES ($1, $2, $3, 'PARTNER', 'ci.invalid:51820', $4, $5, $6,
                  ${healthSql}, NOW())`,
        [id, providerId, ids.region, "A".repeat(44), capacity, status]
      );
    };

    await insertServer(ids.eligibleServer, ids.verifiedProvider, "ACTIVE", "AVAILABLE");
    await insertServer(ids.pendingProviderServer, ids.pendingProvider, "ACTIVE", "AVAILABLE");
    await insertServer(ids.staleServer, ids.verifiedProvider, "ACTIVE", "AVAILABLE", "NOW() - INTERVAL '6 minutes'");
    await insertServer(ids.inactiveServer, ids.verifiedProvider, "SUSPENDED", "AVAILABLE");
    await insertServer(ids.fullServer, ids.verifiedProvider, "ACTIVE", "FULL");
    await client.query("COMMIT");
    committed = true;

    server = createServer({ getPoolImpl: async () => pool });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const serversResponse = await fetch(`${baseUrl}/v1/servers`);
    const serversBody = await serversResponse.json();
    assert.equal(serversResponse.status, 200);
    assert.equal(serversBody.registry, "connected");
    assert.equal(serversBody.count, 1);
    assert.deepEqual(serversBody.items.map((item) => item.id), [ids.eligibleServer]);

    const regionsResponse = await fetch(`${baseUrl}/v1/regions`);
    const regionsBody = await regionsResponse.json();
    assert.equal(regionsResponse.status, 200);
    assert.equal(regionsBody.count, 1);
    assert.deepEqual(regionsBody.items.map((item) => item.id), [ids.region]);
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
    if (committed) {
      await client.query(
        "DELETE FROM vpn_servers WHERE id = ANY($1::uuid[])",
        [[ids.eligibleServer, ids.pendingProviderServer, ids.staleServer, ids.inactiveServer, ids.fullServer]]
      );
      await client.query("DELETE FROM regions WHERE id = $1", [ids.region]);
      await client.query("DELETE FROM providers WHERE id = ANY($1::uuid[])", [[ids.verifiedProvider, ids.pendingProvider]]);
    } else {
      await client.query("ROLLBACK").catch(() => {});
    }
    client.release();
    await pool.end();
  }
});
