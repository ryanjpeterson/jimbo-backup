#!/bin/bash
# Helpers a job file's before_sync() can call. Sourced by backup.sh before each
# job file, so every job can use them. Each returns non-zero on failure and
# sets HOOK_MESSAGE to a short reason for the dashboard.
#
# Inside a hook these are set:
#   SOURCE_PATH  the source folder, as the container sees it
#   DEST_PATH    the backup location, as the container sees it
#   JOB_ID       e.g. immich-internal

# ---------------------------------------------------------------------------
# postgres_dump <dir> <prefix> [keep]
#
# Dumps a Postgres database (pg_dump -F c) to <dir>/<prefix>_YYYY-MM-DD.dump and
# keeps the newest [keep] dumps (default 7). Put <dir> inside the source folder
# and the dump travels to the backup with the files.
#
# Connection, from the environment (.env), each overridable in the job file:
#   PG_HOST      default $DB_HOSTNAME, then immich_postgres
#   PG_USER      default $DB_USERNAME, then postgres
#   PG_DATABASE  default $DB_DATABASE_NAME, then immich
#   PG_PASSWORD  default $DB_PASSWORD
# The container must share a Docker network with the database
# (IMMICH_NETWORK in .env).
# ---------------------------------------------------------------------------
postgres_dump() {
    local dir="$1" prefix="$2" keep="${3:-7}"
    local host="${PG_HOST:-${DB_HOSTNAME:-immich_postgres}}"
    local user="${PG_USER:-${DB_USERNAME:-postgres}}"
    local db="${PG_DATABASE:-${DB_DATABASE_NAME:-immich}}"
    local file="${dir}/${prefix}_$(date +'%Y-%m-%d').dump"

    log "--- Dumping database ${db} on ${host} ---"
    mkdir -p "$dir" || { HOOK_MESSAGE="Couldn't create ${dir}"; return 1; }

    # Dump to a temporary name and only then replace today's file, so a failed
    # second run in a day can't destroy a good dump from earlier that day.
    local tmp="${file}.partial"
    PGPASSWORD="${PG_PASSWORD:-${DB_PASSWORD:-}}" pg_dump -h "$host" -U "$user" -d "$db" \
        -F c -f "$tmp" 2>&1 | log_raw
    local rc="${PIPESTATUS[0]}"
    if [ "$rc" -ne 0 ]; then
        rm -f "$tmp"
        HOOK_MESSAGE="pg_dump exited ${rc} (no new dump)"
        log "ERROR: ${HOOK_MESSAGE}"
        return 1
    fi
    mv -f "$tmp" "$file"
    log "Database dump written: $(basename "$file") ($(du -h "$file" | cut -f1))"

    local removed=0 old
    while IFS= read -r old; do
        [ -n "$old" ] || continue
        rm -f "$old" && removed=$((removed + 1))
    done < <(ls -1t "${dir}/${prefix}"_*.dump 2>/dev/null | tail -n "+$((keep + 1))")
    [ "$removed" -gt 0 ] && log "Pruned ${removed} old dump(s), keeping the newest ${keep}."
    return 0
}
