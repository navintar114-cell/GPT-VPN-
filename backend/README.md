# GPT VPN Control Plane API

Node.js 22+ control-plane API with a PostgreSQL registry. This is **not yet a VPN service**.

## Run locally

```sh
cd backend
npm install
npm test
npm start
```

The API listens on `127.0.0.1:8080` by default. Set `HOST`, `PORT`,
`DATABASE_URL`, `PGSSL`, and `ALLOWED_ORIGINS` through the deployment
environment when needed. Never commit real database URLs, passwords, provider
credentials, or WireGuard private keys.

## PostgreSQL setup

Apply `migrations/001_initial_registry.sql` to a dedicated PostgreSQL database
using a trusted migration process. The API does not automatically run schema
changes at startup. Configure `DATABASE_URL` in the hosting provider's secret
environment settings.

The registry starts empty. Do not add a provider or server until provider
permission, ownership, node configuration, and independent health checks have
been verified.

## Routes

- `GET /v1/health` — reports API process and database connectivity separately;
  it does not test VPN tunnel readiness.
- `GET /v1/regions` — returns only regions with eligible verified servers.
- `GET /v1/servers` — returns only eligible verified servers.
- `GET /v1/servers?regionId={uuid}` — filters eligible servers by region.
- Session creation, peer provisioning, and session revocation return
  `503 PROVISIONING_NOT_CONFIGURED` until authentication, session persistence,
  and WireGuard provisioning are implemented.

A server is eligible only if its status is ACTIVE, it has a verification
timestamp, its provider is VERIFIED with permission evidence, its capacity is
AVAILABLE, and its health check is no older than five minutes.

## Security boundaries

- No demo or fabricated production servers are returned.
- The schema stores WireGuard public keys only; private keys must never be stored
  in this registry.
- Provider permission evidence is required before a provider can be marked
  VERIFIED.
- The API uses parameterized SQL for filters.
- CORS is deny-by-default when an Origin header is present; configure exact
  trusted origins before a browser client is used.
- Basic in-memory request limiting and security response headers are enabled.
  Production still needs a gateway/WAF and distributed rate limiting.
- Deploy behind HTTPS. Restrict database network access and use a least-privilege
  database role.
- Database health is reported separately from VPN data-plane readiness.

## Not implemented yet

Authentication, admin authorization and audited registry writes, automated
provider verification, independent health/capacity probes, signed inventory,
device key management, WireGuard peer provisioning/revocation, and Android
integration.

A healthy response from `/v1/health` means only that the API process responds.
It must never be presented as proof that a VPN tunnel is available.
