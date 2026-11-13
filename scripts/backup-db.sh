#!/usr/bin/env bash
# Back up the production database to this laptop, and prove the copy restores.
#
#   export NEON_URL='postgres://…neon.tech/…'   # in your own terminal, as for migrations
#   make backup
#
# Reads only $NEON_URL. The URL is never written anywhere or printed. The dump
# lands outside the repo (the repo is public, the dump has every tenant's
# Aadhaar and phone number) in $BACKUP_DIR, default ~/Backups/hostel, readable
# by you alone. Plain files, by choice (Nov 2026); FileVault is the place to
# encrypt them if that changes.
#
# A file is only called a backup once it has been restored. Each run restores
# it into a scratch local database (hostel_backup_check, dropped after) and
# compares every table's row count with production. That needs local Postgres
# running; without it the file is kept but reported as NOT verified.
set -euo pipefail

CHECK_DB=hostel_backup_check
DIR="${BACKUP_DIR:-$HOME/Backups/hostel}"

if [ -z "${NEON_URL:-}" ]; then
  echo "NEON_URL is not set. In your own terminal:" >&2
  echo "  export NEON_URL='postgres://…neon.tech/…'" >&2
  echo "  make backup" >&2
  exit 1
fi
case "$NEON_URL" in
  *neon.tech*) ;;
  *) echo "Note: NEON_URL is not a neon.tech address, so this is not backing up production." ;;
esac

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
FILE="$DIR/hostel-$(date +%Y-%m-%d-%H%M).dump"

# Every table's exact row count, as "table count" lines.
COUNT_SQL="SELECT table_name || ' ' || (xpath('/row/c/text()',
  query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name"

echo "→ dumping to $FILE"
pg_dump --format=custom --no-owner --no-acl --file="$FILE.partial" "$NEON_URL"
mv "$FILE.partial" "$FILE"
PROD_COUNTS=$(psql "$NEON_URL" -X -Atc "$COUNT_SQL")
VERSION=$(psql "$NEON_URL" -X -Atc "SELECT version || CASE WHEN dirty THEN ' (dirty)' ELSE '' END FROM schema_migrations" 2>/dev/null || echo "?")
SIZE=$(du -h "$FILE" | cut -f1 | tr -d ' ')

echo "→ restoring into a scratch local database to check it"
if ! psql -X -d postgres -Atc "SELECT 1" >/dev/null 2>&1; then
  echo
  echo "Saved $FILE ($SIZE), but NOT verified: local Postgres is not running."
  echo "Start it (brew services start postgresql@18) and run make backup again."
  exit 1
fi
dropdb --if-exists "$CHECK_DB" 2>/dev/null
createdb "$CHECK_DB"
trap 'dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true' EXIT
# Not --exit-on-error: a Neon-only extension or comment the local server lacks
# is noise. The row counts below are the real test.
RESTORE_LOG=$(pg_restore --no-owner --no-acl --dbname="$CHECK_DB" "$FILE" 2>&1) || true
CHECK_COUNTS=$(psql -X -d "$CHECK_DB" -Atc "$COUNT_SQL")

count_of() { printf '%s\n' "$PROD_COUNTS" | awk -v t="$1" '$1 == t { print $2 }'; }
TABLES=$(printf '%s\n' "$PROD_COUNTS" | grep -c . || true)
ROWS=$(printf '%s\n' "$PROD_COUNTS" | awk '{ s += $2 } END { print s + 0 }')

echo
echo "Saved   $FILE ($SIZE)"
echo "Schema  migration $VERSION · $TABLES tables · $ROWS rows"
echo "        $(count_of tenants) tenants · $(count_of stays) stays · $(count_of payments) payments"
if [ "$PROD_COUNTS" = "$CHECK_COUNTS" ]; then
  echo "Checked restored into a scratch database: every table's row count matches production."
else
  echo "NOT verified: the restored copy's row counts differ from production:"
  diff <(printf '%s\n' "$PROD_COUNTS") <(printf '%s\n' "$CHECK_COUNTS") | sed 's/^/        /' || true
  echo "If someone was using the app during the backup, run it again."
  if [ -n "$RESTORE_LOG" ]; then
    echo "pg_restore said:"
    printf '%s\n' "$RESTORE_LOG" | tail -5 | sed 's/^/        /'
  fi
  exit 1
fi
if [ -n "$RESTORE_LOG" ]; then
  echo "        (pg_restore warned, but nothing went missing: $(printf '%s\n' "$RESTORE_LOG" | tail -1))"
fi
