# GPT VPN Control Plane API

Node.js 22+ control-plane API with a PostgreSQL registry. This is **not yet a VPN service**.

## Run locally

```sh
cd backend
npm install
npm test
npm start
```

The API listens on `127.0.0.1:8080` by default. Set `HOST`, `PORT`, `DATABASE_URL`, `PGSSL`, and `ALLOWED_ORIGINS` through the deployment environment when needed. Admin audit access additionally requires `ADMIN_API_TOKEN_SHA256` and `ADMIN_API_TOKEN_ACTOR_ID`. Never commit real credentials or tokens. Never commit real database URLs, passwords, provider
credentials, or WireGuard private keys.

## PostgreSQL setup

Apply `migrations/001_initial_registry.sql` and then
`migrations/002_provider_evidence_guard.sql`, and then
`migrations/003_admin_audit_log.sql` to a dedicated PostgreSQL database
using a trusted migration process. Apply each migration once, in numeric order.
The API does not automatically run schema changes at startup. Configure
`DATABASE_URL` in the hosting provider's secret environment settings.

The registry starts empty. Do not add a provider or server until provider
permission, ownership, node configuration, and independent health checks have
been verified.

## Routes

- `GET /v1/health` — reports API process and database connectivity separately;
  it does not test VPN tunnel readiness.
- `GET /v1/regions` — returns only regions with eligible verified servers.
- `GET /v1/servers` — returns only eligible verified servers.
- `GET /v1/servers?regionId={uuid}` — filters eligible servers by region.\n- `GET /v1/admin/audit-log` — returns recent admin audit events; requires a valid admin bearer token and the audit migration. Optional `limit` is restricted to 1–100.
- Session creation, peer provisioning, and session revocation return
  `503 PROVISIONING_NOT_CONFIGURED` until authentication, session persistence,
  and WireGuard provisioning are implemented.

A server is eligible only if its status is ACTIVE, it has a verification
timestamp, its provider is VERIFIED, the provider has a permission verification
timestamp, non-empty permission evidence URL, review timestamp and non-empty
reviewer label, its capacity is AVAILABLE, and its health check is no older than
five minutes. These fields establish metadata completeness only; they do not
independently prove that evidence is authentic or that the reviewer is authorized.

## Security boundaries

- No demo or fabricated production servers are returned.
- The schema stores WireGuard public keys only; private keys must never be stored
  in this registry.
- Provider permission evidence metadata is required before a provider can be
  marked VERIFIED; the database constraint and public inventory query both
  enforce the required fields.
- `reviewed_by` is currently a text label, not authenticated identity. Do not
  add public provider-approval or registry-write routes until authentication,
  role-based authorization and an audit trail are implemented.
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


## Admin audit access

Generate a high-entropy token locally; do not send it in chat or commit it:

```sh
ADMIN_TOKEN="$(openssl rand -hex 32)"
printf '%s' "$ADMIN_TOKEN" | sha256sum
```

Store only the resulting 64-character SHA-256 hex digest as
`ADMIN_API_TOKEN_SHA256` in the hosting provider's secret settings, and set
`ADMIN_API_TOKEN_ACTOR_ID` to a non-secret administrator label. Keep the
plaintext token in a secure password manager and send it only over HTTPS as
`Authorization: Bearer <token>`. Rotate the token by generating a new one and
replacing the digest. Never paste the token or digest into a public issue.

The current endpoint is read-only apart from recording the audit-log read
itself. It does not create providers, approve evidence, provision peers, or
change registry records. A single configured token is not a substitute for
individual accounts, roles, MFA, or a managed identity provider.
