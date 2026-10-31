-- GPT VPN control-plane registry schema.
-- Apply manually with a trusted PostgreSQL migration process.
-- Never insert a server as ACTIVE until provider permission and node health
-- have been independently verified.

CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('FIRST_PARTY', 'PARTNER')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'SUSPENDED')),
  permission_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'VERIFIED' AND permission_verified_at IS NOT NULL)
    OR status <> 'VERIFIED'
  )
);

CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  name TEXT NOT NULL,
  continent TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, name)
);

CREATE TABLE IF NOT EXISTS vpn_servers (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id),
  region_id UUID NOT NULL REFERENCES regions(id),
  provider_type TEXT NOT NULL CHECK (provider_type IN ('FIRST_PARTY', 'PARTNER')),
  wireguard_endpoint TEXT NOT NULL,
  wireguard_public_key CHAR(44) NOT NULL,
  capacity_state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (capacity_state IN ('UNKNOWN', 'AVAILABLE', 'FULL', 'OFFLINE')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  last_health_check TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'ACTIVE' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS vpn_servers_registry_lookup
  ON vpn_servers (region_id, status, capacity_state, last_health_check DESC);

CREATE INDEX IF NOT EXISTS vpn_servers_provider_lookup
  ON vpn_servers (provider_id, status);
