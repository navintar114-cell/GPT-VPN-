# GPT VPN Control Plane — API contract draft

Base URL: HTTPS only. No production host is configured yet.

## Planned endpoints
- `GET /v1/regions` — verified regions and provider/source labels.
- `GET /v1/servers?region={id}` — eligible nodes; never return unverified nodes.
- `POST /v1/sessions` — authenticate device and request a session.
- `POST /v1/servers/{id}/peers` — submit device public key and request peer provisioning.
- `DELETE /v1/sessions/{id}` — revoke session/peer.
- `GET /v1/health` — control-plane health only.

## Server record
`id`, `countryCode`, `region`, `providerType` (`FIRST_PARTY` or `PARTNER`),
`providerName`, `wireGuardEndpoint`, `publicKey`, `capacityState`,
`lastHealthCheck`, `verifiedAt`, `expiresAt`, `status`.

Do not expose provider credentials or private keys. A node is eligible only when
ownership/permission, health, capacity, and configuration signatures are verified.
