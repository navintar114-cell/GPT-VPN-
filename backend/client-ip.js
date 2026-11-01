import { isIP } from "node:net";

function normalizeIp(value) {
  if (typeof value !== "string") return null;
  const ip = value.trim().toLowerCase();
  if (isIP(ip) === 0) return null;
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) {
    return ip.slice(7);
  }
  return ip;
}

export function createClientIpResolver({ trustedProxyIps = [] } = {}) {
  if (!Array.isArray(trustedProxyIps)) {
    throw new TypeError("trustedProxyIps must be an array of IP addresses.");
  }

  const trusted = new Set();
  for (const value of trustedProxyIps) {
    const normalized = normalizeIp(value);
    if (!normalized) {
      throw new TypeError("TRUSTED_PROXY_IPS contains an invalid IP address.");
    }
    trusted.add(normalized);
  }

  return function resolveClientIp(req) {
    const peer = normalizeIp(req?.socket?.remoteAddress) ?? "unknown";
    if (!trusted.has(peer)) return peer;

    const header = req?.headers?.["x-forwarded-for"];
    if (typeof header !== "string" || header.length === 0 || header.length > 2048) {
      return peer;
    }

    const chain = header.split(",").map(normalizeIp);
    if (chain.length === 0 || chain.length > 20 || chain.some((ip) => !ip)) {
      return peer;
    }

    // Walk from the trusted socket peer toward the client. Stop at the first
    // untrusted hop; entries farther left are not trusted or consulted.
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const candidate = chain[index];
      if (!trusted.has(candidate)) return candidate;
    }

    return chain[0] ?? peer;
  };
}
