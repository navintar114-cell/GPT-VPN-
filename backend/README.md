# GPT VPN Control Plane API

Node.js 22+ control-plane API with a PostgreSQL registry. This is **not yet a VPN service**.

## Run locally

```sh
cd backend
npm install
npm test
npm start
```

The API listens on `127.0.0.1:8080` by default. Configure `HOST`, `PORT`,
`DATABASE_URL`, `PGSSL`, and `ALLOWED_ORIGINS` through the deployment
environment. Admin audit access additionally requires
`ADMIN_API_TOKEN_SHA256` and `ADMIN_API_TOKEN_ACTOR_ID`. Never commit database
URLs, passwords, provider credentials, admin tokens, or WireGuard private keys.

## PostgreSQL setup

Apply `migrations/001_initial_registry.sql`,
`migrations/002_provider_evidence_guard.sql`,
`migrations/003_admin_audit_log.sql`, and
`migrations/004_runtime_role_hardening.sql` to a dedicated PostgreSQL database
using a trusted migration process, in numeric order. The API does not
automatically run schema changes at startup. Configure `DATABASE_URL` in the
hosting provider's secret environment settings and set `PGSSL=true` when using
a managed PostgreSQL service that requires TLS.

The registry starts empty. Do not add a provider or server until provider
permission, ownership, node configuration, and independent health checks have
been verified.

## Runtime database role

Migration 004 creates the `gptvpn_app_runtime` NOLOGIN group role. It grants
only:

- `SELECT` on `providers`, `regions`, and `vpn_servers`;
- `SELECT` and `INSERT` on `admin_audit_log`;
- the minimum identity-sequence privileges needed for audit inserts.

It explicitly removes PUBLIC and runtime-role table grants before applying
these permissions. It does not create a login, password, or membership. After
the migration, a database administrator must create a separate login and grant
membership, for example:

```sql
CREATE ROLE gptvpn_api_login LOGIN;
GRANT gptvpn_app_runtime TO gptvpn_api_login;
```

Set that login's credential through the database provider's secure credential
workflow, then configure the API's `DATABASE_URL` with the runtime login.
Never put credentials in source control or chat. Do not use the migration
owner, database owner, or a superuser as the API login.

**Important ownership boundary:** PostgreSQL object owners retain implicit
control regardless of ordinary GRANT/REVOKE statements. The API login must not
own the registry tables, audit table, identity sequence, schema, or migration
objects; it must not be a member of privileged roles. Keep migration
credentials separate from runtime credentials. Migration 004 does not transfer
existing object ownership or alter existing login memberships. Review those
settings with a trusted database administrator before using this role in a
live environment.

The runtime role is intentionally not granted provider/server writes, session
provisioning, schema creation, UPDATE/DELETE/TRUNCATE on audit events, or
migration privileges. Future features must receive separately reviewed,
narrow permissions and audited transaction handling.

## Routes

- `GET /v1/health` — reports API process and database connectivity separately;
  it does not test VPN tunnel readiness.
- `GET /v1/regions` — returns only regions with eligible verified servers.
- `GET /v1/servers` — returns only eligible verified servers.
- `GET /v1/servers?regionId={uuid}` — filters eligible verified servers by region.
- `GET /v1/admin/audit-log` — returns recent admin audit events; requires a
  valid admin bearer token and migration 003. Optional `limit` is restricted
  to 1–100.
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
- `reviewed_by` is currently a text label, not authenticated identity.
- Admin audit access uses a SHA-256 token digest from environment configuration;
  the plaintext token is not stored by the API.
- `ADMIN_API_TOKEN_ACTOR_ID` is a configured actor label, not independently
  verified human identity. This initial version supports one configured token,
  not per-user accounts or role-based authorization.
- The audit table has triggers blocking ordinary UPDATE/DELETE/TRUNCATE statements.
  The runtime role additionally lacks those table privileges. A database
  owner or superuser can still alter or disable these protections.
- Provider approvals and registry writes remain disabled. Future mutations must
  authenticate, authorize the specific action, and write an audit event in the
  same database transaction before being enabled.
- The API uses parameterized SQL for filters.
- CORS is deny-by-default when an Origin header is present; configure exact
  trusted origins before a browser client is used.
- Basic in-memory request limiting and security response headers are enabled.
  Production still needs a gateway/WAF and distributed rate limiting.
- Deploy behind HTTPS. Restrict database network access and use the dedicated
  least-privilege runtime role described above.
- Database health is reported separately from VPN data-plane readiness.

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

The endpoint is read-only apart from recording the audit-log read itself. It
does not create providers, approve evidence, provision peers, or change registry
records. A single configured token is not a substitute for individual
accounts, roles, MFA, or a managed identity provider.

## Not implemented yet

Per-user admin accounts, role-based authorization, token rotation/revocation
management, audited provider approval and registry writes, automated provider
verification, independent health/capacity probes, signed inventory, device key
management, WireGuard peer provisioning/revocation, and Android integration.

A healthy response from `/v1/health` means only that the API process responds.
It must never be presented as proof that a VPN tunnel is available.
