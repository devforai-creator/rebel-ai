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

  # Match Supabase CLI's version ordering, including the transition after 99.
  while IFS= read -r -d '' migration_name; do
    migration="$ROOT_DIR/supabase/migrations/$migration_name"
    printf '\n\n-- >>> %s\n\n' "$(basename "$migration")"
    cat "$migration"
    printf '\n'
  done < <(find "$ROOT_DIR/supabase/migrations" -maxdepth 1 -name '*.sql' -printf '%f\0' | LC_ALL=C sort -z -t_ -k1,1)
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
