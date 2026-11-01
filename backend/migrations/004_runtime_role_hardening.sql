-- GPT VPN least-privilege runtime role.
-- Apply after migrations 001-003 using a trusted database migration role.
-- This creates a NOLOGIN group role; it does not create credentials or assign
-- membership to any login. The API login must not own these objects.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'gptvpn_app_runtime'
  ) THEN
    CREATE ROLE gptvpn_app_runtime;
  END IF;
END
$$;

ALTER ROLE gptvpn_app_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  INHERIT NOREPLICATION NOBYPASSRLS;

-- Remove any broad/default grants on these application tables, then grant
-- only the operations currently required by the control-plane API.
REVOKE ALL PRIVILEGES ON TABLE
  providers, regions, vpn_servers, admin_audit_log
  FROM PUBLIC, gptvpn_app_runtime;

GRANT USAGE ON SCHEMA public TO gptvpn_app_runtime;
REVOKE CREATE ON SCHEMA public FROM gptvpn_app_runtime;

GRANT SELECT ON TABLE providers, regions, vpn_servers
  TO gptvpn_app_runtime;

GRANT SELECT, INSERT ON TABLE admin_audit_log
  TO gptvpn_app_runtime;

-- INSERT into the identity column requires sequence privileges.
REVOKE ALL PRIVILEGES ON SEQUENCE public.admin_audit_log_id_seq
  FROM PUBLIC, gptvpn_app_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.admin_audit_log_id_seq
  TO gptvpn_app_runtime;
