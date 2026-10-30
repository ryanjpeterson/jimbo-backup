#!/bin/bash
# jimbo-backup — runs backup jobs.
#
#   backup.sh <job-id>     run one job (e.g. music-internal)
#   backup.sh scheduled    run every scheduled job, in file order
#   backup.sh all          run every job, in file order
#   backup.sh --list       print the jobs as JSON (the dashboard reads this)
#
# A job is a file in jobs/ naming a source folder and a backup location (see
# jobs/README.md). If either can't be found, that job is marked failed (or
# skipped, for a removable drive) with the reason, and the next job carries on.
#
# Safe to run by hand:
#   docker exec -it jimbo-backup /app/scripts/backup.sh music-internal
#
# Takes a container-wide lock, so it will refuse to stack on a running job.

set -uo pipefail
HERE="$(dirname "$0")"
source "$HERE/lib.sh"
source "$HERE/hooks.sh"

usage() { echo "usage: backup.sh <job-id> | scheduled | all | --list" >&2; exit 2; }

# --- state ------------------------------------------------------------------
mark_running() {
    state_set "$1" "$(jq -nc --arg s "$(now_iso)" --arg l "$(basename "$LOG_FILE")" \
        '{status:"running", lastStart:$s, logFile:$l, message:""}')"
}

# mark_done <id> <status> <started-epoch> <message>
mark_done() {
    local id="$1" status="$2" started="$3" message="$4" patch
    patch="$(jq -nc --arg st "$status" --arg e "$(now_iso)" --argjson d "$(( $(date +%s) - started ))" \
                    --arg m "$message" --arg l "$(basename "$LOG_FILE")" \
        '{status:$st, lastEnd:$e, durationSec:$d, message:$m, logFile:$l}')"
    [ "$status" = "success" ] && patch="$(echo "$patch" | jq -c --arg e "$(now_iso)" '. + {lastSuccess:$e}')"
    state_set "$id" "$patch"
}

# --- one job ----------------------------------------------------------------
# Runs in a subshell (see the loop below): a job file is plain bash, and a
# broken one must not stop the jobs after it.
run_job() {
    local file="$1" id started name
    id="$(job_id "$file")"
    started="$(date +%s)"
    LOG_FILE="${LOG_DIR}/${id}_$(date +'%Y-%m-%d_%H-%M-%S').log"

    if ! load_job "$file" > >(log_raw) 2>&1; then
        log "ERROR: $(basename "$file") has an error in it (see above). Nothing was copied."
        mark_done "$id" failed "$started" "This job file has an error in it"
        return 1
    fi
    name="${JOB_NAME:-$id}"
    lock_write "$id" "$name" "$(basename "$LOG_FILE")"
    mark_running "$id"

    log "=========================================="
    log "BACKUP STARTED: ${name} (${id})"
    log "  from ${JOB_SOURCE:-?}"
    log "  to   ${JOB_DEST:-?}"
    log "=========================================="

    if [ -z "${JOB_SOURCE:-}" ] || [ -z "${JOB_DEST:-}" ]; then
        log "ERROR: $(basename "$file") must set both JOB_SOURCE and JOB_DEST."
        mark_done "$id" failed "$started" "Set both JOB_SOURCE and JOB_DEST in $(basename "$file")"
        return 1
    fi

    SOURCE_PATH="$(container_path "$JOB_SOURCE")"
    DEST_PATH="$(container_path "$JOB_DEST")"
    JOB_ID="$id"
    export SOURCE_PATH DEST_PATH JOB_ID

    # The backup location first: a removable drive that isn't plugged in is a
    # skip, not a failure.
    if ! dest_found "$DEST_PATH"; then
        if [ "${JOB_REMOVABLE:-0}" = "1" ]; then
            log "SKIPPED: backup location not found: ${JOB_DEST}. The drive isn't plugged in."
            mark_done "$id" skipped "$started" "Backup location not found (drive not plugged in)"
            return 0
        fi
        log "ERROR: backup location not found: ${JOB_DEST}"
        log "       Is the drive mounted? The folder must exist; create it once by hand."
        mark_done "$id" failed "$started" "Backup location not found: ${JOB_DEST}"
        return 1
    fi

    if ! source_found "$SOURCE_PATH"; then
        log "ERROR: source not found or empty: ${JOB_SOURCE}"
        log "       Refusing to sync: mirroring an empty source would empty the backup."
        mark_done "$id" failed "$started" "Source not found or empty: ${JOB_SOURCE}"
        return 1
    fi

    # Optional hook (a database dump, say). If it fails, the files are still
    # copied — a hiccup in the hook mustn't freeze the backup — but the run is
    # marked failed with the hook's reason.
    local hook_error=""
    if declare -F before_sync >/dev/null; then
        HOOK_MESSAGE=""
        if ! before_sync; then
            hook_error="${HOOK_MESSAGE:-before_sync failed}"
            log "ERROR: ${hook_error}. Copying the files anyway."
        fi
    fi

    log "--- Syncing ---"
    # shellcheck disable=SC2086
    rsync ${JOB_RSYNC_FLAGS:-$RSYNC_FLAGS} "${SOURCE_PATH}/" "${DEST_PATH}/" 2>&1 | log_raw
    local rc="${PIPESTATUS[0]}"
    if [ "$rc" -ne 0 ]; then
        log "ERROR: rsync exited ${rc}."
        mark_done "$id" failed "$started" "rsync exited ${rc}"
        return 1
    fi

    if declare -F after_sync >/dev/null; then
        HOOK_MESSAGE=""
        after_sync || { [ -n "$hook_error" ] || hook_error="${HOOK_MESSAGE:-after_sync failed}"; log "ERROR: after_sync failed."; }
    fi

    if [ -n "$hook_error" ]; then
        mark_done "$id" failed "$started" "Files copied; ${hook_error}"
        return 1
    fi
    log "Done."
    mark_done "$id" success "$started" ""
    return 0
}

# --- main -------------------------------------------------------------------
TARGET="${1:-}"
[ -n "$TARGET" ] || usage

if [ "$TARGET" = "--list" ]; then
    { while IFS= read -r f; do job_json "$f"; done < <(job_files); } | jq -s '.'
    exit 0
fi

FILES=()
case "$TARGET" in
    all)
        while IFS= read -r f; do FILES+=("$f"); done < <(job_files) ;;
    scheduled)
        # Broken job files are included, so they show up as failed rather than
        # silently never running.
        while IFS= read -r f; do
            if ( load_job "$f" >/dev/null 2>&1 || exit 0; [ "${JOB_SCHEDULE:-scheduled}" != "manual" ] ); then FILES+=("$f"); fi
        done < <(job_files) ;;
    *)
        f="$(job_file_for "$TARGET")" || { echo "No job called '${TARGET}' in ${JOBS_DIR}." >&2; exit 2; }
        FILES=("$f") ;;
esac

if [ "${#FILES[@]}" -eq 0 ]; then
    echo "No backup jobs to run in ${JOBS_DIR}."
    exit 0
fi

mkdir -p "$LOG_DIR"
if ! lock_acquire "$TARGET"; then
    echo "REFUSED: $(lock_holder) is already running. Nothing was started."
    exit 3
fi
trap 'lock_release' EXIT

EXIT_CODE=0
for f in "${FILES[@]}"; do
    ( run_job "$f" ) || EXIT_CODE=1
done

prune_logs
exit "$EXIT_CODE"
