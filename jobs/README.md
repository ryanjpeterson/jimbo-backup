# Backup jobs

Each `.sh` file here is one backup: a source folder and a backup location.
The dashboard lists them, the nightly run goes through them in file-name order,
and each one can be run on its own.

## Adding one

1. Copy `example.sh.disabled` to `<number>-<name>.sh`, e.g.
   `50-paperless-internal.sh`. The number sets the order; the rest is the
   job's id (`paperless-internal`).
2. Set `JOB_NAME`, `JOB_SOURCE` and `JOB_DEST`, using paths as they are on the
   host (`/Volumes/…`).
3. Create the backup folder once. jimbo-backup never creates it, so an
   unplugged drive can't be mistaken for an empty one and filled on the boot
   disk.
4. Reload the dashboard. No restart or rebuild: jobs are read every time.

## When something can't be found

The job is marked **failed** with the reason ("Source not found or empty: …",
"Backup location not found: …"). Nothing is copied, and the jobs after it
still run. A job with `JOB_REMOVABLE=1` is **skipped** instead when its backup
location is missing, since that drive is expected to come and go.

A source has to exist *and* have something in it. With `--delete`, mirroring
an empty source would empty the backup, and an unplugged drive can look like an
empty folder.

## Services with a database

Export the database into the source folder in `before_sync()`, so the export is
copied with the files. `postgres_dump` (in `scripts/hooks.sh`) does Postgres;
see the Immich jobs. If the hook fails, the files are still copied and the run
is marked failed with the hook's reason.

## Paths

Paths under `HOST_VOLUMES_DIR` (default `/Volumes`) work as written: that
folder is mounted into the container. A path anywhere else needs its own
`volumes:` line in `docker-compose.yml`.
