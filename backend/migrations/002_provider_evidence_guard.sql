-- GPT VPN provider permission evidence guard.
-- Safe to apply after 001_initial_registry.sql; all additions are idempotent.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS permission_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS permission_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.providers'::regclass
      AND conname = 'providers_verified_evidence_required'
  ) THEN
    ALTER TABLE providers
      ADD CONSTRAINT providers_verified_evidence_required
      CHECK (
        status <> 'VERIFIED'
        OR (
          permission_verified_at IS NOT NULL
          AND NULLIF(BTRIM(permission_evidence_url), '') IS NOT NULL
          AND reviewed_at IS NOT NULL
          AND NULLIF(BTRIM(reviewed_by), '') IS NOT NULL
        )
      );
  END IF;
END
$$;
