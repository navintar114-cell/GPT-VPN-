-- GPT VPN admin audit log.
-- Apply after 001_initial_registry.sql and 002_provider_evidence_guard.sql.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created_at_idx
  ON admin_audit_log (actor_id, created_at DESC);

-- Prevent accidental UPDATE/DELETE through ordinary application SQL.
-- A database owner/superuser can still alter or disable this protection.
CREATE OR REPLACE FUNCTION prevent_admin_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_no_mutation ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_log_mutation();

DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_admin_audit_log_mutation();
