#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable CI PostgreSQL database}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/migrations"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATIONS/001_initial_registry.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATIONS/002_provider_evidence_guard.sql"

# Reapplying the evidence migration must be safe and must not duplicate the constraint.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATIONS/002_provider_evidence_guard.sql"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/test/postgres/provider-evidence-guard.sql"

# Exercise the real HTTP API against the migrated PostgreSQL registry.
node --test "$ROOT/test/postgres/api-inventory.integration.test.js"
