#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="${HOME}/nexus-proxy"
CLOUD_ENV="${ROOT_DIR}/.nexus-cloud.env"
SOURCE_CONTAINER="nexus-postgres"
POSTGRES_IMAGE="postgres:17-alpine"
BACKUP_ROOT="${ROOT_DIR}/.migration-backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

DUMP_FILE="${RUN_DIR}/nexus-public.dump"
ARCHIVE_LIST="${RUN_DIR}/archive.list"
RESTORE_LIST="${RUN_DIR}/restore.list"
SOURCE_COUNTS="${RUN_DIR}/source-counts.tsv"
TARGET_COUNTS="${RUN_DIR}/target-counts.tsv"
COUNT_SQL="${RUN_DIR}/table-counts.sql"

STOPPED_CONTAINERS=()

restore_local_services() {
  local container

  for container in "${STOPPED_CONTAINERS[@]:-}"
  do
    if docker inspect "$container" >/dev/null 2>&1
    then
      docker start "$container" >/dev/null || true
    fi
  done
}

fail() {
  printf '\nMIGRATION FAILED: %s\n' "$1" >&2
  exit 1
}

trap restore_local_services EXIT

[ -d "$ROOT_DIR" ] ||
  fail "Project root not found: $ROOT_DIR"

[ -f "$CLOUD_ENV" ] ||
  fail "Cloud secrets file not found: $CLOUD_ENV"

docker inspect "$SOURCE_CONTAINER" >/dev/null 2>&1 ||
  fail "Source PostgreSQL container is missing: $SOURCE_CONTAINER"

SOURCE_STATE="$(
  docker inspect \
    --format '{{.State.Running}}' \
    "$SOURCE_CONTAINER"
)"

[ "$SOURCE_STATE" = "true" ] ||
  fail "Source PostgreSQL container is not running"

umask 077

mkdir -p "$RUN_DIR"
chmod 700 "$BACKUP_ROOT" "$RUN_DIR"

if ! grep -qxF '.migration-backups/' \
  "$ROOT_DIR/.gitignore" 2>/dev/null
then
  printf '\n.migration-backups/\n' \
    >> "$ROOT_DIR/.gitignore"
fi

set -a
# shellcheck disable=SC1090
source "$CLOUD_ENV"
set +a

: "${SUPABASE_SESSION_DATABASE_URL:?SUPABASE_SESSION_DATABASE_URL is not loaded}"

case "$SUPABASE_SESSION_DATABASE_URL" in
  *PASTE_*|*YOUR-PASSWORD*)
    fail "Supabase connection URL still contains a placeholder"
    ;;
esac

case "$SUPABASE_SESSION_DATABASE_URL" in
  *sslmode=*)
    TARGET_URL="$SUPABASE_SESSION_DATABASE_URL"
    ;;
  *\?*)
    TARGET_URL="${SUPABASE_SESSION_DATABASE_URL}&sslmode=require"
    ;;
  *)
    TARGET_URL="${SUPABASE_SESSION_DATABASE_URL}?sslmode=require"
    ;;
esac

export TARGET_URL

cat > "$COUNT_SQL" <<'SQL'
\pset tuples_only on
\pset format unaligned
SELECT format(
  'SELECT %L, count(*) FROM %I.%I;',
  tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
SQL

printf '\n==> Pulling PostgreSQL client image\n'

docker pull "$POSTGRES_IMAGE" >/dev/null

printf '\n==> Checking source and target PostgreSQL versions\n'

SOURCE_VERSION="$(
  docker exec "$SOURCE_CONTAINER" \
    sh -ceu '
      PGPASSWORD="$POSTGRES_PASSWORD" \
      psql \
        --host=127.0.0.1 \
        --username="$POSTGRES_USER" \
        --dbname="$POSTGRES_DB" \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --command="SHOW server_version;"
    ' |
  tr -d '[:space:]'
)"

TARGET_VERSION="$(
  docker run \
    --rm \
    --env TARGET_URL \
    "$POSTGRES_IMAGE" \
    sh -ceu '
      psql \
        "$TARGET_URL" \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --command="SHOW server_version;"
    ' |
  tr -d '[:space:]'
)"

printf 'Source PostgreSQL: %s\n' "$SOURCE_VERSION"
printf 'Target PostgreSQL: %s\n' "$TARGET_VERSION"

printf '\n==> Confirming Supabase public schema is empty\n'

TARGET_TABLES="$(
  docker run \
    --rm \
    --env TARGET_URL \
    "$POSTGRES_IMAGE" \
    sh -ceu '
      psql \
        "$TARGET_URL" \
        --no-psqlrc \
        --tuples-only \
        --no-align \
        --command="
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = '\''public'\''
          ORDER BY tablename;
        "
    ' |
  sed '/^[[:space:]]*$/d'
)"

if [ -n "$TARGET_TABLES" ]
then
  printf '%s\n' \
    "Supabase already contains public tables:" \
    "$TARGET_TABLES" >&2

  fail "Target database is not empty; no data was changed"
fi

printf '\n==> Pausing local application writers\n'

for container in \
  nexus-control-plane \
  nexus-proxy-engine \
  nexus-node-agent
do
  if docker inspect "$container" >/dev/null 2>&1
  then
    if [ "$(
      docker inspect \
        --format '{{.State.Running}}' \
        "$container"
    )" = "true" ]
    then
      docker stop "$container" >/dev/null
      STOPPED_CONTAINERS+=("$container")
      printf 'Stopped: %s\n' "$container"
    fi
  fi
done

printf '\n==> Recording source table counts\n'

docker exec \
  --interactive \
  "$SOURCE_CONTAINER" \
  sh -ceu '
    PGPASSWORD="$POSTGRES_PASSWORD" \
    psql \
      --host=127.0.0.1 \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --no-psqlrc \
      --quiet \
      --tuples-only \
      --no-align \
      --field-separator="$(printf "\t")"
  ' \
  < "$COUNT_SQL" \
  | sort \
  > "$SOURCE_COUNTS"

printf '\n==> Creating protected local migration backup\n'

docker exec "$SOURCE_CONTAINER" \
  sh -ceu '
    PGPASSWORD="$POSTGRES_PASSWORD" \
    pg_dump \
      --host=127.0.0.1 \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --format=custom \
      --schema=public \
      --no-owner \
      --no-privileges
  ' \
  > "$DUMP_FILE"

chmod 600 \
  "$DUMP_FILE" \
  "$SOURCE_COUNTS" \
  "$COUNT_SQL"

[ -s "$DUMP_FILE" ] ||
  fail "PostgreSQL dump is empty"

sha256sum "$DUMP_FILE" \
  > "${DUMP_FILE}.sha256"

chmod 600 "${DUMP_FILE}.sha256"

printf '\n==> Preparing a Supabase-safe restore list\n'

docker run \
  --rm \
  --volume "${RUN_DIR}:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore \
    --list \
    /backup/nexus-public.dump \
  > "$ARCHIVE_LIST"

awk '
  $0 !~ / SCHEMA - public /
' "$ARCHIVE_LIST" \
  > "$RESTORE_LIST"

chmod 600 "$ARCHIVE_LIST" "$RESTORE_LIST"

[ -s "$RESTORE_LIST" ] ||
  fail "Restore list is empty"

printf '\n==> Restoring schema and data into Supabase\n'

docker run \
  --rm \
  --env TARGET_URL \
  --volume "${RUN_DIR}:/backup:ro" \
  "$POSTGRES_IMAGE" \
  sh -ceu '
    pg_restore \
      --dbname="$TARGET_URL" \
      --no-owner \
      --no-privileges \
      --exit-on-error \
      --use-list=/backup/restore.list \
      /backup/nexus-public.dump
  '

printf '\n==> Recording Supabase table counts\n'

docker run \
  --rm \
  --interactive \
  --env TARGET_URL \
  "$POSTGRES_IMAGE" \
  sh -ceu '
    psql \
      "$TARGET_URL" \
      --no-psqlrc \
      --quiet \
      --tuples-only \
      --no-align \
      --field-separator="$(printf "\t")"
  ' \
  < "$COUNT_SQL" \
  | sort \
  > "$TARGET_COUNTS"

chmod 600 "$TARGET_COUNTS"

printf '\n==> Comparing source and Supabase row counts\n'

if ! diff \
  --unified \
  "$SOURCE_COUNTS" \
  "$TARGET_COUNTS"
then
  fail "Source and Supabase row counts do not match"
fi

TABLE_COUNT="$(
  wc -l < "$SOURCE_COUNTS" |
  tr -d '[:space:]'
)"

TOTAL_ROWS="$(
  awk -F '\t' '
    {
      total += $2
    }
    END {
      print total + 0
    }
  ' "$SOURCE_COUNTS"
)"

printf '\n========================================\n'
printf 'NEXUS POSTGRESQL MIGRATION PASSED\n'
printf '========================================\n'
printf 'Tables verified: %s\n' "$TABLE_COUNT"
printf 'Rows verified:   %s\n' "$TOTAL_ROWS"
printf 'Backup folder:   %s\n' "$RUN_DIR"
printf 'Credential digests were copied unchanged.\n'
printf 'Local application containers were restarted.\n'
