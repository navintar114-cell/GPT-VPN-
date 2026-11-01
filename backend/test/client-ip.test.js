import test from "node:test";
import assert from "node:assert/strict";
import { createClientIpResolver } from "../client-ip.js";

function request(peer, forwardedFor) {
  return {
    socket: { remoteAddress: peer },
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }
  };
}

test("ignores forwarded headers from an untrusted socket peer", () => {
  const resolve = createClientIpResolver({ trustedProxyIps: ["10.0.0.5"] });
  assert.equal(resolve(request("198.51.100.9", "203.0.113.7")), "198.51.100.9");
});

test("uses the first untrusted hop walking back through trusted proxies", () => {
  const resolve = createClientIpResolver({
    trustedProxyIps: ["10.0.0.5", "10.0.0.6"]
  });
  assert.equal(
    resolve(request("10.0.0.6", "203.0.113.8, 10.0.0.5")),
    "203.0.113.8"
  );
});

test("falls back to socket peer for malformed or oversized forwarded chains", () => {
  const resolve = createClientIpResolver({ trustedProxyIps: ["10.0.0.5"] });
  assert.equal(resolve(request("10.0.0.5", "not-an-ip")), "10.0.0.5");
  assert.equal(resolve(request("10.0.0.5", Array(22).fill("203.0.113.1").join(", "))), "10.0.0.5");
  assert.equal(resolve(request("10.0.0.5", "203.0.113.1, invalid")), "10.0.0.5");
});

test("normalizes IPv4-mapped IPv6 socket addresses", () => {
  const resolve = createClientIpResolver({ trustedProxyIps: ["127.0.0.1"] });
  assert.equal(resolve(request("::ffff:127.0.0.1", "203.0.113.12")), "203.0.113.12");
});

test("rejects invalid trusted proxy configuration at construction", () => {
  assert.throws(() => createClientIpResolver({ trustedProxyIps: ["not-an-ip"] }), /invalid IP/);
  assert.throws(() => createClientIpResolver({ trustedProxyIps: "10.0.0.5" }), /must be an array/);
});
