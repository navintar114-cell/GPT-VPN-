# GPT VPN Control Plane API (initial scaffold)

Node.js 22+ API scaffold. This is a **control-plane preview**, not a VPN service.

## Run locally

```sh
cd backend
npm test
npm start
```

The API listens on `127.0.0.1:8080` by default. Set `HOST`, `PORT`, and
`ALLOWED_ORIGINS` through the deployment environment when needed. Do not commit
real secrets or provider credentials.

## Routes

- `GET /v1/health` — reports API process health only; it does not test VPN servers.
- `GET /v1/regions` — returns an empty verified registry until real providers are audited.
- `GET /v1/servers` — returns an empty verified registry until real nodes are provisioned.
- Session creation, peer provisioning, and session revocation return
  `503 PROVISIONING_NOT_CONFIGURED` until authentication, persistence, and
  WireGuard provisioning are implemented.

## Security boundaries

- No demo or fabricated production servers are returned.
- No private keys, provider credentials, browsing history, DNS queries, or traffic
  contents are accepted or stored by this scaffold.
- CORS is deny-by-default when an Origin header is present; configure exact
  trusted origins before a browser client is used.
- Basic in-memory request limiting and security response headers are enabled.
- The in-memory limiter is a development safeguard, not a substitute for a
  production gateway/WAF or distributed rate limiting.
- Deploy behind HTTPS. Do not expose this API over plain public HTTP.

## Not implemented yet

Authentication, database persistence, signed server inventory, provider
verification, health/capacity probes, device key management, WireGuard peer
provisioning/revocation, and Android integration.

A healthy response from `/v1/health` means only that this API process responds.
It must never be presented as proof that a VPN tunnel is available.
