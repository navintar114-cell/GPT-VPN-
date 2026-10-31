import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";

async function withServer(run) {
  const server = createServer();
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
