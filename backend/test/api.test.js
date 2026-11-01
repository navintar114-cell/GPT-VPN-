import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";

async function withServer(run, options = {}) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
}

test("health reports control-plane health without claiming VPN readiness", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.vpnDataPlane, "not-configured");
  });
});

test("regions and servers are empty until verified inventory exists", async () => {
  await withServer(async (baseUrl) => {
    for (const route of ["/v1/regions", "/v1/servers"]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.items, []);
      assert.equal(body.count, 0);
    }
  });
});

test("public inventory SQL requires complete provider review evidence", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    }
  };

  await withServer(async (baseUrl) => {
    for (const route of ["/v1/regions", "/v1/servers"]) {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.items, []);
      assert.equal(body.registry, "connected");
    }
  }, { getPoolImpl: async () => pool });

  assert.equal(queries.length, 2);
  for (const sql of queries) {
    assert.match(sql, /p\.status = 'VERIFIED'/);
    assert.match(sql, /p\.permission_verified_at IS NOT NULL/);
    assert.match(sql, /NULLIF\(BTRIM\(p\.permission_evidence_url\), ''\) IS NOT NULL/);
    assert.match(sql, /p\.reviewed_at IS NOT NULL/);
    assert.match(sql, /NULLIF\(BTRIM\(p\.reviewed_by\), ''\) IS NOT NULL/);
  }
});

test("invalid region IDs are rejected before querying the registry", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      return { rows: [], rowCount: 0 };
    }
  };

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/servers?regionId=not-a-uuid`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_REGION_ID");
  }, { getPoolImpl: async () => pool });

  assert.equal(queryCount, 0);
});

test("session provisioning is explicitly unavailable", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/sessions`, { method: "POST" });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "PROVISIONING_NOT_CONFIGURED");
  });
});

test("unknown routes return 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/not-a-route`);
    assert.equal(response.status, 404);
  });
});
