import test from "node:test";
import assert from "node:assert/strict";
import { createAdminRateLimiter } from "../admin-rate-limit.js";

test("failure counter blocks only after threshold and expires", () => {
  let time = 1000;
  const limiter = createAdminRateLimiter({ maxFailedAttempts: 2, failureWindowMs: 5000, now: () => time });
  assert.equal(limiter.checkFailureBlocked("client-a").limited, false);
  limiter.recordFailure("client-a");
  limiter.recordFailure("client-a");
  assert.equal(limiter.checkFailureBlocked("client-a").limited, true);
  const concurrentOverflow = limiter.recordFailure("client-a");
  assert.equal(concurrentOverflow.limited, true);
  time += 5001;
  assert.equal(limiter.checkFailureBlocked("client-a").limited, false);
});

test("successful authentication clears failure history", () => {
  const limiter = createAdminRateLimiter({ maxFailedAttempts: 1 });
  limiter.recordFailure("client-a");
  assert.equal(limiter.checkFailureBlocked("client-a").limited, true);
  limiter.recordSuccess("client-a");
  assert.equal(limiter.checkFailureBlocked("client-a").limited, false);
});

test("read counter resets after its fixed window", () => {
  let time = 100;
  const limiter = createAdminRateLimiter({ maxReadRequests: 1, readWindowMs: 1000, now: () => time });
  assert.equal(limiter.consumeRead("client-a").limited, false);
  assert.equal(limiter.consumeRead("client-a").limited, true);
  time += 1001;
  assert.equal(limiter.consumeRead("client-a").limited, false);
});

test("new keys are rejected when the bounded map is full", () => {
  const limiter = createAdminRateLimiter({ maxEntries: 1, now: () => 500 });
  assert.equal(limiter.recordFailure("client-a").limited, false);
  assert.equal(limiter.recordFailure("client-b").limited, true);
  assert.equal(limiter.sizes.failures, 1);
});
