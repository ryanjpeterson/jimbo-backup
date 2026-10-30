#!/bin/bash
# Shared helpers for jimbo-backup.
# Sourced by backup.sh, scheduler.sh and entrypoint.sh. Not executable on its own.

LOG_DIR="${LOG_DIR:-/logs}"
STATE_FILE="${LOG_DIR}/state.json"
LOCK_DIR="${LOG_DIR}/.lock"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"

# Where backup job files live (jobs/*.sh in the project, mounted read-only).
JOBS_DIR="${JOBS_DIR:-/app/jobs}"

# Job files name real host paths (/Volumes/media/Music). The host's volumes
# directory is mounted into the container at /host-volumes, so a path under
# HOST_VOLUMES_DIR is rewritten to its container twin before use.
HOST_VOLUMES_DIR="${HOST_VOLUMES_DIR:-/Volumes}"
CONTAINER_VOLUMES_DIR="${CONTAINER_VOLUMES_DIR:-/host-volumes}"

RSYNC_FLAGS="${RSYNC_FLAGS:--rtvh --delete --no-p --no-g --no-o}"

LOG_FILE=""

# ---------------------------------------------------------------------------
# logging
# ---------------------------------------------------------------------------
log() {
    local line
    line="$(date '+%Y-%m-%d %H:%M:%S')  $*"
    if [ -n "$LOG_FILE" ]; then
        echo "$line" | tee -a "$LOG_FILE"
    else
        echo "$line"
    fi
}

log_raw() {
    if [ -n "$LOG_FILE" ]; then
        tee -a "$LOG_FILE"
    else
        cat
    fi
}

now_iso() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------

# /Volumes/media/Music -> /host-volumes/media/Music. Other paths pass through.
container_path() {
    local p="${1%/}"
    case "$p" in
        "$HOST_VOLUMES_DIR") echo "$CONTAINER_VOLUMES_DIR" ;;
        "$HOST_VOLUMES_DIR"/*) echo "${CONTAINER_VOLUMES_DIR}${p#"$HOST_VOLUMES_DIR"}" ;;
        *) echo "$p" ;;
    esac
}

# A folder that is really there. On Docker Desktop an unplugged drive can leave
# an empty stale directory behind, so "exists" isn't enough for a source: it
# must also have something in it. (A missing source mirrored with --delete
# would empty the backup.)
source_found() {
    [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ]
}

# A backup location is found when the folder itself exists. Create it once by
# hand; the runner never creates it, so an unplugged drive can't be mistaken
# for an empty one and filled on the boot disk.
dest_found() {
    [ -d "$1" ]
}

# ---------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------

# Job files in run order: jobs/10-music-internal.sh, jobs/20-…
job_files() {
    local f
    for f in "$JOBS_DIR"/*.sh; do
        [ -f "$f" ] && echo "$f"
    done | sort
}

# jobs/10-music-internal.sh -> music-internal (the number only sets the order).
job_id() {
    local base
    base="$(basename "$1" .sh)"
    echo "${base#[0-9]*-}"
}

job_file_for() {
    local f
    while IFS= read -r f; do
        [ "$(job_id "$f")" = "$1" ] && { echo "$f"; return 0; }
    done < <(job_files)
    return 1
}

# Reset every JOB_* variable and hook, then load one job file. Call in a
# subshell: a job file is plain bash, and a broken one must not take anything
# else down with it.
load_job() {
    unset JOB_NAME JOB_SOURCE JOB_DEST JOB_REMOVABLE JOB_SCHEDULE JOB_RSYNC_FLAGS
    unset -f before_sync after_sync 2>/dev/null || true
    # shellcheck disable=SC1090
    source "$1"
}

# One job as JSON, for the dashboard (backup.sh --list).
job_json() {
    local file="$1" id err=""
    id="$(job_id "$file")"
    (
        if ! load_job "$file" >/dev/null 2>&1; then
            err="This job file has an error in it."
        elif [ -z "${JOB_SOURCE:-}" ] || [ -z "${JOB_DEST:-}" ]; then
            err="Set both JOB_SOURCE and JOB_DEST in this job file."
        fi
        jq -nc --arg id "$id" --arg file "$(basename "$file")" \
              --arg name "${JOB_NAME:-$id}" --arg source "${JOB_SOURCE:-}" --arg dest "${JOB_DEST:-}" \
              --arg removable "${JOB_REMOVABLE:-0}" --arg schedule "${JOB_SCHEDULE:-scheduled}" \
              --arg hook "$(declare -F before_sync >/dev/null && echo before_sync || true)" \
              --arg error "$err" \
            '{id:$id, file:$file, name:$name, source:$source, dest:$dest,
              removable:($removable == "1"), scheduled:($schedule != "manual"),
              hasHook:($hook != ""), error:(if $error == "" then null else $error end)}'
    )
}

# ---------------------------------------------------------------------------
# state.json  --  the GUI reads this; it never writes it.
# Keyed by job id, e.g. "music-internal".
# ---------------------------------------------------------------------------
state_init() {
    mkdir -p "$LOG_DIR"
    [ -f "$STATE_FILE" ] || echo '{"jobs":{}}' > "$STATE_FILE"
}

# state_set <job-id> <json-object-to-merge>
state_set() {
    local key="$1" patch="$2" tmp
    state_init
    tmp="$(mktemp "${LOG_DIR}/.state.XXXXXX")"
    if jq --arg k "$key" --argjson v "$patch" \
         '.jobs[$k] = ((.jobs[$k] // {}) + $v)' "$STATE_FILE" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$STATE_FILE"
    else
        rm -f "$tmp"
        echo "WARNING: could not update $STATE_FILE" >&2
    fi
}

# A container stopped mid-run leaves jobs marked "running" with no process
# behind them. Called at startup so the dashboard doesn't show a phantom job.
state_clear_running() {
    local tmp
    state_init
    tmp="$(mktemp "${LOG_DIR}/.state.XXXXXX")"
    if jq --arg e "$(now_iso)" '
          .jobs |= with_entries(
            if .value.status == "running"
            then .value += {status:"failed", lastEnd:$e,
                            message:"Interrupted - container restarted"}
            else . end)' "$STATE_FILE" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$STATE_FILE"
    else
        rm -f "$tmp"
    fi
}

# Before job files, state was keyed "<set>:<dest>" ("music:internal"). Carry
# that history over to the matching job ids so last-good-copy ages survive.
state_migrate() {
    local tmp
    state_init
    tmp="$(mktemp "${LOG_DIR}/.state.XXXXXX")"
    if jq '
          .jobs |= (reduce (to_entries[] | select(.key | test("^[a-z]+:[a-z]+$"))) as $e (.;
            ($e.key | split(":") | "\(.[0])-\(.[1])") as $id
            | if has($id) then . else .[$id] = $e.value end)
          | with_entries(select(.key | test(":") | not)))' "$STATE_FILE" > "$tmp" 2>/dev/null; then
        mv "$tmp" "$STATE_FILE"
    else
        rm -f "$tmp"
    fi
}

# ---------------------------------------------------------------------------
# lock  --  one job at a time, container-wide.
# mkdir is atomic, so this is race-free without extra tooling.
# ---------------------------------------------------------------------------
lock_write() {
    jq -nc --argjson pid "$$" --arg job "$1" --arg title "$2" --arg started "$(now_iso)" --arg log "$3" \
        '{pid:$pid, job:$job, title:$title, started:$started, logFile:$log}' > "${LOCK_DIR}/info.json"
}

lock_acquire() {
    mkdir -p "$LOG_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        lock_write "$1" "$1" ""
        return 0
    fi

    # Lock exists. If the owning process is gone, it is stale -- clear it.
    local pid
    pid="$(jq -r '.pid // empty' "${LOCK_DIR}/info.json" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 1
    fi
    echo "Clearing stale lock (pid ${pid:-unknown} is gone)." >&2
    rm -rf "$LOCK_DIR"
    lock_acquire "$1"
}

lock_release() { rm -rf "$LOCK_DIR"; }

lock_holder() { jq -r '.title // .job // "a backup"' "${LOCK_DIR}/info.json" 2>/dev/null || echo "a backup"; }

# ---------------------------------------------------------------------------
# log pruning
# ---------------------------------------------------------------------------
prune_logs() {
    find "$LOG_DIR" -maxdepth 1 -type f -name '*.log' \
        -mtime "+${LOG_RETENTION_DAYS}" -delete 2>/dev/null || true
}
