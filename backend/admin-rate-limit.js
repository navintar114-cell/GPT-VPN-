const DEFAULT_FAILURE_WINDOW_MS = 15 * 60_000;
const DEFAULT_READ_WINDOW_MS = 60_000;

function retryAfterSeconds(expiresAt, now) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

export function createAdminRateLimiter({
  maxFailedAttempts = 10,
  failureWindowMs = DEFAULT_FAILURE_WINDOW_MS,
  maxReadRequests = 30,
  readWindowMs = DEFAULT_READ_WINDOW_MS,
  maxEntries = 10_000,
  now = Date.now
} = {}) {
  for (const [name, value] of Object.entries({
    maxFailedAttempts, failureWindowMs, maxReadRequests, readWindowMs, maxEntries
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  if (typeof now !== "function") throw new TypeError("now must be a function.");

  const failures = new Map();
  const reads = new Map();

  function getOrCreate(map, key, windowMs) {
    const currentTime = now();
    let entry = map.get(key);
    if (entry && currentTime >= entry.expiresAt) {
      map.delete(key);
      entry = undefined;
    }
    if (entry) return { entry, currentTime };

    if (map.size >= maxEntries) {
      for (const [storedKey, stored] of map) {
        if (currentTime >= stored.expiresAt) map.delete(storedKey);
      }
      if (map.size >= maxEntries) {
        return {
          entry: null,
          currentTime,
          retryAfter: Math.max(1, Math.ceil(windowMs / 1000))
        };
      }
    }

    entry = { count: 0, expiresAt: currentTime + windowMs };
    map.set(key, entry);
    return { entry, currentTime };
  }

  function blockedResult(entry, currentTime) {
    return {
      limited: true,
      retryAfterSeconds: retryAfterSeconds(entry.expiresAt, currentTime)
    };
  }

  function checkFailureBlocked(key) {
    const entry = failures.get(key);
    if (!entry) return { limited: false };
    const currentTime = now();
    if (currentTime >= entry.expiresAt) {
      failures.delete(key);
      return { limited: false };
    }
    return entry.count >= maxFailedAttempts
      ? blockedResult(entry, currentTime)
      : { limited: false };
  }

  function recordFailure(key) {
    const result = getOrCreate(failures, key, failureWindowMs);
    if (!result.entry) {
      return { limited: true, retryAfterSeconds: result.retryAfter };
    }
    result.entry.count += 1;
    return result.entry.count >= maxFailedAttempts
      ? blockedResult(result.entry, result.currentTime)
      : { limited: false };
  }

  function recordSuccess(key) {
    failures.delete(key);
  }

  function consumeRead(key) {
    const result = getOrCreate(reads, key, readWindowMs);
    if (!result.entry) {
      return { limited: true, retryAfterSeconds: result.retryAfter };
    }
    if (result.entry.count >= maxReadRequests) {
      return blockedResult(result.entry, result.currentTime);
    }
    result.entry.count += 1;
    return { limited: false };
  }

  return Object.freeze({
    checkFailureBlocked,
    recordFailure,
    recordSuccess,
    consumeRead,
    get sizes() {
      return { failures: failures.size, reads: reads.size };
    }
  });
}
