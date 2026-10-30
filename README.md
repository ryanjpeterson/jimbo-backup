# jimbo-backup

Scheduled folder backups to local drives, in one Docker container, with a
dashboard to watch them and run any one on demand.

Each backup is a small shell file in `jobs/` naming a **source folder** and a
**backup location**. jimbo-backup mirrors one to the other with `rsync`, on a
schedule or when you press *Back up*. If either folder can't be found, that
backup is marked failed with the reason, and nothing else is affected. A job
can run a hook first, such as exporting a database into the folder being
backed up, so services like Immich are a few lines to add.

```
jobs/10-music-internal.sh    /Volumes/media/Music          →  /Volumes/internal-backup/Music
jobs/20-immich-internal.sh   /Volumes/data/Immich (+ db)   →  /Volumes/internal-backup/Immich
jobs/30-music-external.sh    /Volumes/media/Music          →  /Volumes/external-backup/Music   (removable)
```

---

## Contents

- [What it does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Set up on a new machine](#set-up-on-a-new-machine)
- [Backup jobs](#backup-jobs)
- [Scheduling](#scheduling)
- [Configuration reference](#configuration-reference)
- [The dashboard](#the-dashboard)
- [Running a backup by hand](#running-a-backup-by-hand)
- [Safety behaviour](#safety-behaviour)
- [Restoring Immich](#restoring-immich)
- [Troubleshooting](#troubleshooting)
- [How it fits together](#how-it-fits-together)
- [Moving an existing install to job files](#moving-an-existing-install-to-job-files)

---

## What it does

**Backups**
- One file per backup in `jobs/`: a source folder, a backup location and
  optional settings. Add a backup by adding a file; no rebuild or restart.
- Mirrors with `rsync --delete`, so each backup matches its source.
- Checks both folders before copying. A source must exist *and* have
  something in it; a backup location must exist. Missing → the job is marked
  **failed** with the reason, and the next job runs anyway. For a drive that
  comes and goes (`JOB_REMOVABLE=1`), a missing backup location is a quiet
  **skip** instead.
- Optional `before_sync` / `after_sync` hooks per job. `postgres_dump` exports
  a Postgres database into the source folder, with dated dumps and pruning.

**Scheduling**
- One schedule from `.env`: `daily`, `weekly`, `hourly`, every `<N>h` or
  `<N>d`, or `off`. Each run goes through every job in file-name order.
- Any job can be left out of the schedule (`JOB_SCHEDULE=manual`).
- One backup at a time, container-wide: a scheduled run never stacks on a
  manual one.

**Dashboard** (port 4343, built on jimbo.ui — phone first)
- Every backup, grouped by the volume it copies to, with what its last run did
  and how old its last good copy is.
- A one-line verdict, and stale copies flagged after `STALE_WARN_HOURS`.
- A *Back up* button per job, disabled with a reason when a volume isn't there.
- Live log while a job runs; a Runs tab with every run's log.
- Settings lists every job, every mounted volume (and which ones backups use),
  and the schedule. The jimbo-ui config section (`/jimbo-ui`) sets the look
  for everyone.

**Logs**
- One log per job run, pruned after `LOG_RETENTION_DAYS`. `state.json` beside
  them holds what the dashboard shows.

---

## Prerequisites

On the machine that will run backups:

1. **Docker with Compose v2.**
   - **macOS:** Docker Desktop. Turn on *Start Docker Desktop when you sign
     in* (Settings → General) so backups resume after a reboot, and make sure
     **`/Volumes` is shared**: Settings → Resources → File Sharing. Without it
     the container sees no drives.
   - **Linux:** Docker Engine and the `docker compose` plugin. Drives are
     usually under `/mnt` or `/media`; set `HOST_VOLUMES_DIR` to match.
2. **git**, to clone this repo.
3. **The drives mounted** under one directory (`/Volumes` on a Mac): every
   source and every backup location a job uses.
4. **Each backup location created once by hand** (e.g.
   `mkdir /Volumes/internal-backup/Music`). jimbo-backup never creates it, so
   an unplugged drive can't be mistaken for an empty one.
5. **Somewhere always mounted for logs** (`LOG_DIR_HOST`).
6. **Internet at build time only.** The image build pulls `rsync`, a Postgres
   client and the dashboard's npm packages. Once built, nothing needs the
   internet: the dashboard ships its own fonts and the server uses only the Node
   standard library.

Only if a job dumps a database:

7. **The database's container running**, with its Docker network name and
   credentials. For Immich: its `immich_default` network and its `DB_PASSWORD`.

Optional:

- **Tailscale**, to open the dashboard away from home (see
  [`GUI_BIND`](#configuration-reference)).
- **Node 22**, only to work on the dashboard itself (see
  [How it fits together](#how-it-fits-together)).

Not needed on the host: rsync, Node, a Postgres client or cron — they're all
in the image, and the container schedules itself.

---

## Set up on a new machine

```bash
git clone git@github.com:ryanjpeterson/jimbo-backup.git
```

```bash
cd jimbo-backup && cp .env.example .env
```

1. In `.env`, set `HOST_VOLUMES_DIR`, `LOG_DIR_HOST` and the schedule. If a
   job will dump Immich's database, uncomment `COMPOSE_FILE` and set
   `DB_PASSWORD`.
2. Edit the files in `jobs/` for this machine's folders: change or delete the
   examples, or copy `jobs/example.sh.disabled` for new ones (see
   [Backup jobs](#backup-jobs)).
3. Create each backup location folder.
4. Build and start:

   ```bash
   docker compose up -d --build
   ```

5. Open `http://<this machine>:4343`. Settings should list your drives under
   *Mounted volumes*; if it's empty, Docker can't see `HOST_VOLUMES_DIR`.
6. Press *Back up* on one job to prove the whole path works now, rather than
   finding out at 3am.

---

## Backup jobs

A job is a bash file in `jobs/` named `<number>-<id>.sh`. The number sets the
run order and is dropped from the id: `20-immich-internal.sh` runs as
`immich-internal`. Files that don't end in `.sh` are ignored, which is how
`example.sh.disabled` stays out of the way.

```bash
# jobs/50-paperless-internal.sh
JOB_NAME="Paperless"
JOB_SOURCE="/Volumes/data/Paperless"
JOB_DEST="/Volumes/internal-backup/Paperless"
```

| Setting | Required | What it does |
|---|---|---|
| `JOB_NAME` | | What the dashboard calls it. Default: the id |
| `JOB_SOURCE` | yes | The folder to back up, as a host path |
| `JOB_DEST` | yes | Where the copy goes, as a host path. Must already exist |
| `JOB_REMOVABLE=1` | | A drive that isn't always plugged in: a missing backup location is *skipped*, not *failed* |
| `JOB_SCHEDULE=manual` | | Leave it out of scheduled runs; *Back up* still works |
| `JOB_RSYNC_FLAGS` | | rsync flags for this job only. Default: `RSYNC_FLAGS` |
| `before_sync()` | | A function run before copying |
| `after_sync()` | | A function run after a successful copy |

Paths under `HOST_VOLUMES_DIR` work as written, since that directory is
mounted into the container. A folder anywhere else needs its own `volumes:`
line in `docker-compose.yml`.

Jobs are read fresh every time, so a new or edited file shows up on the
dashboard's next refresh. A file with a mistake in it (a bash syntax error,
or no `JOB_SOURCE`) shows as *Can't run* with the reason. It never stops the
other jobs.

### When a folder can't be found

| What's missing | Result |
|---|---|
| The source, or the source is empty | **Failed**: "Source not found or empty: …". Nothing copied |
| The backup location | **Failed**: "Backup location not found: …". Nothing copied |
| The backup location, with `JOB_REMOVABLE=1` | **Skipped**: "drive not plugged in" |

Either way the run continues with the next job, the container keeps going, and
the reason is on the dashboard and in the job's log.

### Hooks: services with a database

Export the database into the source folder in `before_sync`, so the export is
copied with the files. Inside a hook, `SOURCE_PATH` and `DEST_PATH` are the
folders as the container sees them, and `log` writes to the job's log.

```bash
before_sync() {
    postgres_dump "${SOURCE_PATH}/db_dumps" immich_db 7
}
```

`postgres_dump <dir> <prefix> [keep]` (in `scripts/hooks.sh`) writes
`<prefix>_YYYY-MM-DD.dump` with `pg_dump -F c` and keeps the newest `keep`. It
connects with `DB_HOSTNAME`, `DB_USERNAME`, `DB_DATABASE_NAME` and
`DB_PASSWORD` from `.env`; for a different database, set `PG_HOST`, `PG_USER`,
`PG_DATABASE` and `PG_PASSWORD` in the job. The container must share a Docker
network with the database (see `docker-compose.immich.yml`).

If a hook fails, the files are **still copied**: a database hiccup mustn't
freeze the file backup. The run is marked failed with the hook's reason, and
older dumps stay in the backup. A hook reports its reason by setting
`HOOK_MESSAGE` and returning non-zero.

---

## Scheduling

| `BACKUP_INTERVAL` | Meaning |
|---|---|
| `daily` | every day at `BACKUP_TIME` |
| `weekly` | every `BACKUP_DAY` at `BACKUP_TIME` |
| `hourly` | every hour |
| `<N>h` | every N hours, e.g. `6h` |
| `<N>d` | every N days at `BACKUP_TIME`, e.g. `3d` |
| `off` | never on a schedule; *Back up* still works |

**Daily at 3am:** `BACKUP_INTERVAL=daily`, `BACKUP_TIME=03:00`.
**Weekly at 2am on Sundays:** `BACKUP_INTERVAL=weekly`, `BACKUP_TIME=02:00`,
`BACKUP_DAY=sunday`.

Apply a change with `docker compose up -d` (no rebuild). The dashboard and
`docker compose logs` both show the schedule in force.

Runs are anchored to the clock time, so a restart doesn't shift `daily` or
`weekly`. `<N>d`, and `<N>h` values that don't divide into 24, re-phase on a
restart. An unparseable interval is logged and retried hourly; the buttons keep
working. Times are in `TZ`.

---

## Configuration reference

Everything below lives in `.env`; `.env.example` has the annotated version.
The backups themselves are the files in `jobs/`.

| Variable | Default | Notes |
|---|---|---|
| `TZ` | `America/Toronto` | |
| `HOST_VOLUMES_DIR` | `/Volumes` | Where drives are mounted on the host |
| `LOG_DIR_HOST` | *(required)* | Logs, `state.json`, `theme.json` |
| `BACKUP_INTERVAL` | `daily` | See [Scheduling](#scheduling) |
| `BACKUP_TIME` | `03:00` | 24-hour `HH:MM` |
| `BACKUP_DAY` | `sunday` | For `weekly` |
| `RSYNC_FLAGS` | `-rtvh --delete --no-p --no-g --no-o` | Default for every job |
| `STALE_WARN_HOURS` | `48` | |
| `LOG_RETENTION_DAYS` | `30` | |
| `GUI_PORT` | `4343` | |
| `GUI_BIND` | `0.0.0.0` | `127.0.0.1` for this machine only. No authentication either way |
| `CONTAINER_NAME` | `jimbo-backup` | |
| `COMPOSE_FILE` | *(unset)* | `docker-compose.yml:docker-compose.immich.yml` to join Immich's network |
| `IMMICH_NETWORK` | `immich_default` | Used by the override above |
| `DB_HOSTNAME`, `DB_USERNAME`, `DB_DATABASE_NAME`, `DB_PASSWORD` | Immich's names | For `postgres_dump` |
| `IMMICH_DUMP_KEEP` | `7` | Read by the Immich jobs |
| `PG_MAJOR` | `17` | Postgres client in the image; newer dumps older servers fine |

**About the rsync flags.** `-t` keeps modification times, which is what lets
rsync skip unchanged files; without it everything is recopied every run.
`--no-p --no-g --no-o` are needed because Docker Desktop's file sharing can't
`chown`/`chmod` through a bind mount. On Linux, `-aH --delete` gives full
fidelity.

**Reaching the dashboard over Tailscale only.** Set `GUI_BIND=127.0.0.1` and
run `tailscale serve --bg 4343`. Don't bind a literal tailnet IP: if Docker
starts before Tailscale after a reboot, the container can't bind it and
restart-loops.

---

## The dashboard

`http://<host>:4343` — three tabs, a floating dock on phones.

**Home** — a one-line verdict, the schedule, then a section per destination
volume with a *Detected* / *Not detected* chip. Each backup row shows a status
dot (green backed up, yellow pulsing running, red failed, grey skipped or never
run), what the last run did, and — when that wasn't a success — how old the last
good copy is. Tap a row for its log; *Back up* runs it now. While a backup runs,
a banner says which, with *Watch* for its live log.

**Runs** — every run's log, newest first, grouped by day, filterable by backup.

**Settings** — the schedule; every job with its paths and options (removable,
manual only, runs a hook, or why it can't run); every mounted volume and whether
a backup uses it; and a link to the **jimbo-ui config** section (`/jimbo-ui`):
Theme (looks in light, mid or dark, colours, fonts, backdrop), Brand, the
Style guide, and About (the jimbo-ui version this app is on). There are no
accounts, so anyone who can open the dashboard can change the look.

"Detected" means the volume is listed in `HOST_VOLUMES_DIR`. The dashboard never
reads *inside* a drive on a timer — that would keep macOS from ejecting it.
The real folder checks happen in `backup.sh`, right before copying. The page
stops polling while its tab is in the background.

---

## Running a backup by hand

```bash
docker exec -it jimbo-backup /app/scripts/backup.sh music-internal
```

| Argument | Runs |
|---|---|
| `<job-id>` | that job |
| `scheduled` | every job except `JOB_SCHEDULE=manual` ones, in order |
| `all` | every job, in order |
| `--list` | nothing: prints the jobs as JSON |

| Exit code | Meaning |
|---|---|
| `0` | Every job succeeded or was skipped |
| `1` | At least one job failed — see its log |
| `2` | Bad arguments, or no job with that id |
| `3` | Another backup is running; nothing was started |

---

## Safety behaviour

Backups are **mirrors** (`--delete`): a file deleted from a source is deleted
from its backup on the next run. These guards exist because of that:

- **Empty or missing source → nothing copied.** An unplugged source drive (or
  one Docker can only see as an empty folder) can't mirror emptiness into the
  backup.
- **Missing backup location → nothing copied.** The folder must already exist,
  so an unplugged backup drive can't be mistaken for an empty one and filled on
  the boot disk.
- **One job's failure stays with that job.** Each job runs on its own, so a
  broken job file, a missing folder or a failed hook never stops the rest.
- **Interrupted runs are marked failed**, not left showing as running, the
  next time the container starts.
- **A failed hook doesn't block the files.** They're copied; the run is
  marked failed with the reason.

For a rollback window, add `--backup --backup-dir=../.trash/$(date +%F)` to a
job's `JOB_RSYNC_FLAGS`: deletions and overwrites are moved aside instead of
destroyed.

---

## Restoring Immich

The Immich jobs write dated dumps to `db_dumps/` inside the Immich folder, so
they're in every backup alongside the files. To restore the database:

```bash
docker cp immich_db_2026-09-07.dump immich_postgres:/tmp/
```

```bash
docker exec -it immich_postgres pg_restore --clean --if-exists -U postgres -d immich /tmp/immich_db_2026-09-07.dump
```

Then rsync the library files back the other way. **Use the dump and the files
from the same backup** — a mismatched pair leaves Immich pointing at assets it
can't find.

---

## Troubleshooting

**A job says "Source not found or empty" but the folder is there.**
Docker Desktop can lose sight of a drive that was ejected and mounted again
while the container ran: the container sees an empty folder. Recreate the
container:

```bash
docker compose up -d --force-recreate
```

Check what the container sees with
`docker exec jimbo-backup ls /host-volumes/<volume>/<folder>`.

**"Backup location not found".**
The drive isn't mounted, or the folder was never created. Create it once
(`mkdir /Volumes/<drive>/<folder>`). For a drive that's meant to come and go,
add `JOB_REMOVABLE=1`.

**Settings → Mounted volumes is empty.**
Docker can't see `HOST_VOLUMES_DIR`. On a Mac, add `/Volumes` under Docker
Desktop → Settings → Resources → File Sharing.

**A job shows "Can't run".**
Its file has a mistake; the dashboard says what. A bash syntax error is quoted
in that job's log.

**macOS won't eject a drive.**
Not the dashboard: it only lists `/Volumes`, never reads inside a drive. If a
backup isn't running, it's Docker Desktop's file sharing holding the volume.
`docker compose stop`, eject, `docker compose start`.

**`network immich_default declared as external, but could not be found`.**
`COMPOSE_FILE` includes the Immich override but this machine doesn't run
Immich (or its network has another name). Remove the `COMPOSE_FILE` line, or
fix `IMMICH_NETWORK` — check with
`docker inspect immich_postgres --format '{{json .NetworkSettings.Networks}}'`.

**`pg_dump: server version mismatch`.** Set `PG_MAJOR` to the server's major
version or higher in `.env`, then `docker compose up -d --build`.

**`could not translate host name`.** The container isn't on the database's
network: check `COMPOSE_FILE`, `IMMICH_NETWORK` and `DB_HOSTNAME`.

**A backup seems stuck.** See what holds the lock:
`docker exec jimbo-backup cat /logs/.lock/info.json`. A lock whose process is
gone clears itself on the next attempt and at container start.

**Is it healthy?** `docker compose ps` shows the healthcheck, which polls
`/api/health` (it touches no drives). `docker compose logs -f` shows the
schedule and each scheduled run.

---

## How it fits together

```
docker-compose.yml          the container; mounts HOST_VOLUMES_DIR, jobs/ and the log dir
docker-compose.immich.yml   optional: joins Immich's network for database dumps
Dockerfile                  stage 1 builds web/; stage 2 is Node + rsync + a Postgres client
.env.example                every setting, annotated (copy to .env — never committed)
jobs/                       one file per backup; README.md and example.sh.disabled
scripts/
  backup.sh                 runs jobs: checks folders, runs hooks, rsyncs, records state
  hooks.sh                  helpers for job hooks (postgres_dump)
  lib.sh                    logging, state.json, the lock, paths, job loading
  scheduler.sh              a sleep loop; no cron
  entrypoint.sh             scheduler in the background, dashboard in the foreground
app/server.js               Node standard library only: serves the dashboard and its API
web/                        the dashboard: React + Vite + Tailwind on jimbo.ui
jimbo-ui.json, docs/brand.md   the jimbo.ui version and this app's choices
```

`backup.sh` is the source of truth: it writes `state.json` and the logs, and
the dashboard only reads them. If the web server breaks, backups keep running,
and every backup can be run over SSH with the dashboard closed.

### Working on the dashboard

With the container running, on any machine with Node 22:

```bash
cd web && npm install && API_URL=http://<host>:4343 npm run dev
```

That serves the UI with hot reload and sends `/api` to the running dashboard.
The change reaches the container on the next `docker compose up -d --build`.
Files marked *Part of jimbo-ui (foundation)* come from jimbo.ui and aren't
edited here — see `docs/brand.md`. Keep `node_modules` off network shares and
backup drives: install in a local copy of `web/` if the project lives on one.

---

## Moving an existing install to job files

Installs from before job files backed up a fixed Music and Immich to an
internal and an external drive. To move one over:

1. Write job files for the same paths. The four in `jobs/` match that setup:
   check their paths against your old `MUSIC_SOURCE_HOST`, `IMMICH_SOURCE_HOST`,
   `INTERNAL_ROOT` and `EXTERNAL_ROOT`.
2. In `.env`: if you used Immich, add
   `COMPOSE_FILE=docker-compose.yml:docker-compose.immich.yml`.
   `MUSIC_SOURCE_HOST`, `IMMICH_SOURCE_HOST`, the `*_ROOT` and `*_DEST_*`
   variables and `EXTERNAL_BACKUP_*` are no longer read; delete them when you
   like. External backups now run straight after internal ones, in job order.
3. The service was renamed, so remove the old container before starting:

   ```bash
   docker compose down --remove-orphans
   ```

   ```bash
   docker compose up -d --build
   ```

History carries over: on start, `state.json` entries like `music:internal`
become the matching job ids (`music-internal`), so last-good-copy ages and
stale warnings survive.
