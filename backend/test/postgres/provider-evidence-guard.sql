-- Integration checks for the provider evidence database constraint.
-- Run only against the disposable PostgreSQL database created by CI.

DO $$
DECLARE
  violation_code TEXT;
BEGIN
  -- A VERIFIED provider without an evidence URL must be rejected.
  BEGIN
    INSERT INTO providers (
      id, display_name, provider_type, status, permission_verified_at,
      reviewed_at, reviewed_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      'missing-url', 'PARTNER', 'VERIFIED', NOW(), NOW(), 'ci-reviewer'
    );
    RAISE EXCEPTION 'Expected missing evidence URL to violate the CHECK constraint';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violation_code = RETURNED_SQLSTATE;
    IF violation_code <> '23514' THEN
      RAISE;
    END IF;
  END;

  -- Whitespace-only evidence URLs must be rejected.
  BEGIN
    INSERT INTO providers (
      id, display_name, provider_type, status, permission_verified_at,
      permission_evidence_url, reviewed_at, reviewed_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000002',
      'blank-url', 'PARTNER', 'VERIFIED', NOW(), '   ', NOW(), 'ci-reviewer'
    );
    RAISE EXCEPTION 'Expected whitespace-only evidence URL to be rejected';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violation_code = RETURNED_SQLSTATE;
    IF violation_code <> '23514' THEN
      RAISE;
    END IF;
  END;

  -- A missing review timestamp must be rejected.
  BEGIN
    INSERT INTO providers (
      id, display_name, provider_type, status, permission_verified_at,
      permission_evidence_url, reviewed_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000003',
      'missing-reviewed-at', 'PARTNER', 'VERIFIED', NOW(),
      'https://evidence.invalid/permission', 'ci-reviewer'
    );
    RAISE EXCEPTION 'Expected missing reviewed_at to violate the CHECK constraint';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violation_code = RETURNED_SQLSTATE;
    IF violation_code <> '23514' THEN
      RAISE;
    END IF;
  END;

  -- A whitespace-only reviewer label must be rejected.
  BEGIN
    INSERT INTO providers (
      id, display_name, provider_type, status, permission_verified_at,
      permission_evidence_url, reviewed_at, reviewed_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000004',
      'blank-reviewer', 'PARTNER', 'VERIFIED', NOW(),
      'https://evidence.invalid/permission', NOW(), '   '
    );
    RAISE EXCEPTION 'Expected whitespace-only reviewer to be rejected';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violation_code = RETURNED_SQLSTATE;
    IF violation_code <> '23514' THEN
      RAISE;
    END IF;
  END;
END
$$;

-- A fully populated VERIFIED provider and a PENDING provider must both be accepted.
INSERT INTO providers (
  id, display_name, provider_type, status, permission_verified_at,
  permission_evidence_url, permission_notes, reviewed_at, reviewed_by
) VALUES
  (
    '10000000-0000-4000-8000-000000000005',
    'complete-evidence', 'PARTNER', 'VERIFIED', NOW(),
    'https://evidence.invalid/permission', 'CI fixture', NOW(), 'ci-reviewer'
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'pending-provider', 'PARTNER', 'PENDING', NULL,
    NULL, NULL, NULL, NULL
  );

DO $$
DECLARE
  provider_count INTEGER;
  constraint_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO provider_count
  FROM providers
  WHERE id IN (
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000006'
  );

  SELECT COUNT(*) INTO constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.providers'::regclass
    AND conname = 'providers_verified_evidence_required';

  IF provider_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 accepted provider fixtures, found %', provider_count;
  END IF;

  IF constraint_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one evidence guard constraint, found %', constraint_count;
  END IF;
END
$$;

SELECT 'provider evidence migration integration checks passed' AS result;
