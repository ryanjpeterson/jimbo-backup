#!/bin/bash
# Schedules backups. Deliberately a plain sleep loop -- no cron daemon, nothing
# to misconfigure, and it keeps working even if the web GUI is stopped.
#
# One schedule: at each run, every job in jobs/ (except JOB_SCHEDULE=manual
# ones) runs in file-name order. A removable drive that isn't plugged in is
# skipped, not failed.

set -uo pipefail
source "$(dirname "$0")/lib.sh"

HERE="$(dirname "$0")"

INTERVAL="${BACKUP_INTERVAL:-daily}"
TIME="${BACKUP_TIME:-03:00}"
DAY="${BACKUP_DAY:-sunday}"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  [scheduler] $*"; }

# ---------------------------------------------------------------------------
# next_run_epoch <interval> <HH:MM> <weekday>
#
# Prints the epoch seconds of the next run, or fails if the interval is not
# understood. Runs are anchored to <HH:MM> rather than to "now + interval", so
# a container restart does not shift the schedule.
# ---------------------------------------------------------------------------
next_run_epoch() {
    local interval="$1" tm="$2" day="$3"
    local now base step=0
    now="$(date +%s)"

    if [ "$interval" = "weekly" ]; then
        base="$(date -d "$day $tm" +%s 2>/dev/null)" || return 1
        [ -n "$base" ] || return 1
        while [ "$base" -le "$now" ]; do base=$((base + 604800)); done
        echo "$base"; return 0
    fi

    # Regex, not a glob: "[0-9]*h" would also match "3xh", and the arithmetic
    # that followed would blow up inside the scheduling loop.
    if   [ "$interval" = "hourly" ];        then step=3600
    elif [ "$interval" = "daily" ];         then step=86400
    elif [[ "$interval" =~ ^([0-9]+)h$ ]];  then step=$(( ${BASH_REMATCH[1]} * 3600 ))
    elif [[ "$interval" =~ ^([0-9]+)d$ ]];  then step=$(( ${BASH_REMATCH[1]} * 86400 ))
    else return 1
    fi

    [ "$step" -gt 0 ] || return 1

    base="$(date -d "$tm" +%s 2>/dev/null)" || return 1
    [ -n "$base" ] || return 1
    while [ "$base" -gt "$now" ]; do base=$((base - step)); done
    while [ "$base" -le "$now" ]; do base=$((base + step)); done
    echo "$base"
}

describe() {
    local interval="$1" tm="$2" day="$3"
    case "$interval" in
        off)            echo "disabled (manual triggers only)" ;;
        hourly)         echo "every hour" ;;
        daily)          echo "daily at ${tm}" ;;
        weekly)         echo "weekly on ${day} at ${tm}" ;;
        *)
            if   [[ "$interval" =~ ^([0-9]+)h$ ]]; then echo "every ${BASH_REMATCH[1]} hours"
            elif [[ "$interval" =~ ^([0-9]+)d$ ]]; then echo "every ${BASH_REMATCH[1]} days at ${tm}"
            else echo "UNRECOGNISED ('${interval}')"
            fi ;;
    esac
}

# ---------------------------------------------------------------------------
say "Timezone: ${TZ:-system default}. Current time: $(date '+%Y-%m-%d %H:%M')"
say "Backups run $(describe "$INTERVAL" "$TIME" "$DAY")."

if [ "$INTERVAL" = "off" ]; then
    # Stay alive so the container doesn't look half dead. (A plain loop rather
    # than `sleep infinity`, which is GNU-only.)
    while true; do sleep 86400; done
fi

while true; do
    if ! target="$(next_run_epoch "$INTERVAL" "$TIME" "$DAY")"; then
        say "ERROR: cannot parse BACKUP_INTERVAL='${INTERVAL}' BACKUP_TIME='${TIME}' BACKUP_DAY='${DAY}'."
        say "       Expected interval: daily | weekly | hourly | <N>h | <N>d | off"
        say "       Retrying in 1h. The dashboard's Back up buttons still work."
        sleep 3600
        continue
    fi

    sleep_sec=$(( target - $(date +%s) ))
    [ "$sleep_sec" -lt 1 ] && sleep_sec=1
    say "Next run $(date -d "@${target}" '+%Y-%m-%d %H:%M') (sleeping ${sleep_sec}s)."
    sleep "$sleep_sec"

    say "Starting scheduled backups."
    "${HERE}/backup.sh" scheduled
    say "Finished with exit $?."

    # A run that overran an hourly window would otherwise fire again at once.
    sleep 2
done
