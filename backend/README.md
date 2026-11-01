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
environment. Admin audit access uses either the legacy shared-token mode or
explicit OIDC JWT mode. Never commit database
URLs, passwords, provider credentials, admin tokens, or WireGuard private keys.
For deployments behind a reverse proxy, set `TRUSTED_PROXY_IPS` to a
comma-separated list of exact proxy IP addresses; leave it unset when clients
connect directly. Do not add broad or unverified proxy addresses.

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
  valid admin bearer token, the `audit:read` permission, and migration 003.
  Optional `limit` must use canonical decimal digits and be between 1 and 100.
  Authenticated principals without permission receive `403 ADMIN_FORBIDDEN`.
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
- Admin audit access supports a legacy shared-token mode and an explicit OIDC
  JWT verification mode. OIDC mode validates RS256 signatures against a
  configured HTTPS JWKS endpoint, exact issuer, audience, expiry, not-before,
  issued-at, subject, and known role claims. Unknown or invalid credentials fail
  closed.
- Admin authorization is deny-by-default and checks explicit roles against a
  permission matrix: `admin` and `security_auditor` receive `audit:read`;
  `support_readonly` receives no admin API permissions. Unknown roles or
  malformed role configuration fail closed.
- Admin authentication is throttled after 10 failed attempts per source IP in a
  15-minute window; successful audit-log reads are limited to 30 per source IP
  per minute. Responses include `Retry-After` when throttled.
- Admin rate-limit counters are bounded in-memory process state by default.
  They reset on process restart and are not shared across instances.
- `TRUSTED_PROXY_IPS` accepts exact IP addresses only (not CIDR ranges). The API
  honors `X-Forwarded-For` only when the immediate socket peer is in this explicit
  allowlist. It validates the complete chain, caps it at 20 addresses, and walks
  right-to-left to select the first untrusted hop. Invalid or absent headers fall
  back to the socket peer. Never trust forwarded headers from arbitrary peers.
- `createServer` accepts an asynchronous `adminRateLimiter` adapter implementing
  `checkFailureBlocked(key)`, `recordFailure(key)`, `recordSuccess(key)`, and
  `consumeRead(key)`. A shared-store implementation can use this seam, but none
  is included or configured in this PR. Shared implementations must make
  `recordFailure` and `consumeRead` atomic, apply expiry server-side, and fail
  closed on store errors. Multi-instance/distributed limiting is NOT implemented
  until a reviewed shared adapter and its integration tests are added.
- Audit event details must be a plain JSON object no larger than 8 KiB after
  serialization; malformed or oversized payloads are rejected.
- Legacy `ADMIN_API_TOKEN_ACTOR_ID` is a configured subject/actor label, not
  independently verified human identity. `ADMIN_API_TOKEN_ROLES` is a
  comma-separated list of roles assigned to that one shared token. Everyone
  holding it has the same subject and permissions.
- The audit table has triggers blocking ordinary UPDATE/DELETE/TRUNCATE statements.
  The runtime role additionally lacks those table privileges. A database
  owner or superuser can still alter or disable these protections.
- Provider approvals and registry writes remain disabled. Future mutations must
  authenticate, authorize the specific action, and write an audit event in the
  same database transaction before being enabled.
- The API uses parameterized SQL for filters.
- CORS is deny-by-default when an Origin header is present; configure exact
  trusted origins before a browser client is used.
- Basic process-local request limiting and security response headers are enabled.
  Production still needs a gateway/WAF and a separately deployed, tested
  distributed rate limiter for multi-instance deployments.
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

OIDC authorization-code login/client integration, provider discovery and
registration automation, provider-side MFA policy enforcement, per-user
credential lifecycle/revocation management, audited provider approval and
registry writes, automated provider verification, independent health/capacity probes,
signed inventory, device key management, WireGuard peer provisioning/revocation,
and Android integration.

A healthy response from `/v1/health` means only that the API process responds.
It must never be presented as proof that a VPN tunnel is available.


## Admin role policy

Set `ADMIN_API_TOKEN_ROLES` to an explicit comma-separated role list, for
example `security_auditor`. Supported roles are `admin`,
`security_auditor`, and `support_readonly`. Only `admin` and
`security_auditor` currently receive `audit:read`. An absent role list
authenticates no privileged capability; the endpoint returns 403. Unknown
roles make the auth configuration invalid and return 503.

This PR introduces the authorization policy and enforcement point only. The
existing single bearer token remains the authentication mechanism, so it does
not establish individual human identity. A future identity-provider adapter
must validate issuer, audience, signature, expiry, subject, and role claims
before returning a principal; do not trust arbitrary identity headers.


## OIDC administrator authentication

The API can validate access tokens issued by an independently operated OIDC
identity provider. It does not host a login page or implement an OAuth
authorization-code flow. A trusted identity provider must issue signed JWT
access tokens and enforce its own account lifecycle and any required MFA policy.

To enable OIDC mode, configure these non-secret deployment settings:

- `ADMIN_AUTH_MODE=oidc` — explicitly selects OIDC. There is no fallback to
  the legacy shared token when OIDC mode is selected.
- `ADMIN_OIDC_ISSUER` — exact HTTPS issuer identifier; it must match the JWT
  `iss` claim exactly.
- `ADMIN_OIDC_AUDIENCE` — exact API audience expected in the JWT `aud` claim.
- `ADMIN_OIDC_JWKS_URI` — HTTPS URL for the identity provider's public signing
  keys. Configure this URL from the provider's trusted documentation.
- `ADMIN_OIDC_ROLES_CLAIM=roles` — optional top-level JWT claim containing
  supported role names. Supported roles are `admin`, `security_auditor`,
  and `support_readonly`.

The verifier accepts RS256 only, rejects unknown key IDs after one JWKS refresh,
and caches validated public keys for up to five minutes. It bounds token and
JWKS sizes, requires a non-empty subject, and checks `iss`, `aud`, `exp`,
`iat`, and optional `nbf` with a maximum configurable-in-code clock
tolerance of 60 seconds. Only known role names are accepted; an empty role list
authenticates the subject but grants no admin permission. The JWKS endpoint must
be reachable over HTTPS. Never trust role or identity headers supplied by a
client.

This is an API-side JWT verifier, not a complete OIDC client. It does not
perform discovery, redirect-based login, token exchange, refresh-token
handling, logout, MFA enrollment, or provider-side account administration.
The operator must independently verify the issuer, audience, JWKS URL, role
claim mapping, token type, and provider security configuration before enabling
OIDC mode. Do not put signing private keys or client secrets in this repository
or in chat.
