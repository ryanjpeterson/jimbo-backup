#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

mkdir -p "$LOG_DIR"
state_init

# A container restart in the middle of a job leaves the lock behind. The pid it
# names is definitely gone, so clear it now rather than blocking the first run.
if [ -d "$LOCK_DIR" ]; then
    echo "Clearing lock left over from a previous container run."
    rm -rf "$LOCK_DIR"
fi

# Likewise, any job still marked "running" was killed with the container.
state_clear_running

# History from before job files ("music:internal") moves to the job ids.
state_migrate

# Scheduler in the background, GUI in the foreground as PID 1's child so that
# `docker stop` and `docker logs` behave normally.
"$(dirname "$0")/scheduler.sh" &

exec node /app/app/server.js
