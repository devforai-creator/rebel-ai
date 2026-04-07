#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="$ROOT_DIR/supabase/schema.sql"
TEMP_FILE="$(mktemp)"

cleanup() {
  rm -f "$TEMP_FILE"
}

trap cleanup EXIT

{
  cat <<'EOF'
-- RebelAI hosted bootstrap schema
-- Generated from supabase/migrations by scripts/build-hosted-schema.sh.
-- Source of truth: supabase/migrations
-- For hosted Supabase SQL Editor setup, enable Vault / pgsodium first if your
-- project does not already have them available.
EOF

  for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
    printf '\n\n-- >>> %s\n\n' "$(basename "$migration")"
    cat "$migration"
    printf '\n'
  done
} > "$TEMP_FILE"

if [[ "${1:-}" == "--check" ]]; then
  if ! cmp -s "$TEMP_FILE" "$OUTPUT_FILE"; then
    echo "supabase/schema.sql is out of date. Run: npm run db:schema"
    exit 1
  fi

  echo "supabase/schema.sql is up to date."
  exit 0
fi

mv "$TEMP_FILE" "$OUTPUT_FILE"
trap - EXIT
echo "Generated $OUTPUT_FILE"
