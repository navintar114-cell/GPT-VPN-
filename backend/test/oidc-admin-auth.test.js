import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signJwt } from "node:crypto";
import { createOidcAdminAuthenticator } from "../oidc-admin-auth.js";

const NOW = 1_800_000_000;
const ISSUER = "https://identity.example.test/";
const AUDIENCE = "gpt-vpn-admin-api";
const KID = "ci-rsa-key-1";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 0x10001
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KID,
  use: "sig",
  alg: "RS256",
  key_ops: ["verify"]
};

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function makeToken(claimOverrides = {}, key = privateKey, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: KID, ...headerOverrides };
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "oidc-user-123",
    iat: NOW - 10,
    exp: NOW + 300,
    roles: ["security_auditor"],
    ...claimOverrides
  };
  const encodedHeader = base64url(header);
  const encodedClaims = base64url(claims);
  const input = encodedHeader + "." + encodedClaims;
  return input + "." + signJwt("RSA-SHA256", Buffer.from(input), key).toString("base64url");
}

function createAuthenticator(overrides = {}) {
  let fetchCount = 0;
  const authenticate = createOidcAdminAuthenticator({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: "https://identity.example.test/.well-known/jwks.json",
    now: () => NOW,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    ...overrides
  });
  return { authenticate, fetchCount: () => fetchCount };
}

function request(token) {
  return { headers: { authorization: token ? "Bearer " + token : "" } };
}

test("valid OIDC token yields subject and validated RBAC roles", async () => {
  const { authenticate } = createAuthenticator();
  const result = await authenticate(request(makeToken()));
  assert.equal(result.ok, true);
  assert.equal(result.actorId, "oidc-user-123");
  assert.deepEqual(result.principal, {
    subject: "oidc-user-123",
    roles: ["security_auditor"]
  });
});

test("JWKS keys are cached across token validations", async () => {
  const { authenticate, fetchCount } = createAuthenticator();
  assert.equal((await authenticate(request(makeToken()))).ok, true);
  assert.equal((await authenticate(request(makeToken()))).ok, true);
  assert.equal(fetchCount(), 1);
});

test("rejects wrong issuer, audience, expiry, and future not-before claims", async () => {
  const { authenticate } = createAuthenticator();
  for (const overrides of [
    { iss: "https://attacker.example.test/" },
    { aud: "different-api" },
    { exp: NOW - 120 },
    { nbf: NOW + 120 }
  ]) {
    assert.equal((await authenticate(request(makeToken(overrides)))).ok, false);
  }
});

test("rejects excessive token lifetime and mismatched authorized party", async () => {
  const { authenticate } = createAuthenticator();
  assert.equal(
    (await authenticate(request(makeToken({ exp: NOW + 86401 })))).ok,
    false
  );
  assert.equal(
    (await authenticate(request(makeToken({ aud: [AUDIENCE, "other"], azp: "other" })))).ok,
    false
  );
});

test("rejects unsupported algorithms and invalid signatures", async () => {
  const { authenticate } = createAuthenticator();
  assert.equal(
    (await authenticate(request(makeToken({}, privateKey, { alg: "none" })))).ok,
    false
  );
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.equal((await authenticate(request(makeToken({}, other.privateKey)))).ok, false);
});

test("unknown roles fail closed and missing roles grant no permission", async () => {
  const { authenticate } = createAuthenticator();
  const unknown = await authenticate(request(makeToken({ roles: ["superuser"] })));
  assert.equal(unknown.ok, false);
  const absent = await authenticate(request(makeToken({ roles: [] })));
  assert.equal(absent.ok, true);
  assert.deepEqual(absent.principal.roles, []);
});

test("rejects malformed bearer tokens and oversized token values", async () => {
  const { authenticate } = createAuthenticator();
  assert.equal((await authenticate(request("not.a.jwt"))).ok, false);
  assert.equal((await authenticate(request("x".repeat(17000)))).ok, false);
  assert.equal((await authenticate(request(null))).ok, false);
});

test("JWKS outage fails closed", async () => {
  const { authenticate } = createAuthenticator({
    fetchImpl: async () => new Response("unavailable", { status: 503 })
  });
  assert.equal((await authenticate(request(makeToken()))).ok, false);
});

test("rejects non-HTTPS issuer or JWKS configuration", () => {
  assert.throws(() => createOidcAdminAuthenticator({
    issuer: "http://identity.example.test/",
    audience: AUDIENCE,
    jwksUri: "https://identity.example.test/keys"
  }), /Invalid OIDC/);
  assert.throws(() => createOidcAdminAuthenticator({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: "http://identity.example.test/keys"
  }), /HTTPS/);
});
