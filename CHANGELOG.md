# Changelog

## 2026-10-31 — jimbo-ui 0.8.1

- Updated to jimbo-ui 0.8.1: full screen on phones. The backdrop is a fixed
  layer the height of the screen and the page is at least the screen's
  height, so it no longer stops short of the bottom; the shell, sheets, the
  image viewer and the theme save bar use the safe-area variables
  (`--safe-top` and friends) instead of `env()`.

## 2026-10-30 — jimbo-ui 0.8.0

- Updated to jimbo-ui 0.8.0. Brand & theme and the Style guide are now one
  **jimbo-ui config** section at `/jimbo-ui` (Theme, Brand, Style guide,
  About), linked from Settings; the old `/admin/brand` and `/admin/style`
  pages are gone. The Theme tab shows every look in light, mid or dark, adds a
  Games category, and has 21 backdrops with contrast and saturation sliders,
  which the server now saves.
- `jimbo-ui.json` gains `"auth": "none"` and records a `KeyValue` override:
  the kit's version draws a stray line inside etched lists, so this app keeps
  its own until jimbo-ui fixes it.
- Running dots use the kit's `LIVE` instead of this app's own copy of it.

## 2026-10-30 — jimbo-backup

- **Renamed jimbo-backup** (header text `jimbo.backup`, container
  `jimbo-backup`), with nothing tied to one machine.
- **One file per backup.** Backups are now job files in `jobs/`, each naming
  a source folder and a backup location, with optional `before_sync` /
  `after_sync` hooks. Adding a service is adding a file; no rebuild.
- **Missing folders are per-job errors.** A missing or empty source, or a
  missing backup location, marks that job failed with the reason (or skipped,
  for `JOB_REMOVABLE=1`) and the next job runs. A broken job file shows as
  *Can't run* without stopping the others. The runner never creates a backup
  location.
- **`postgres_dump`** in `scripts/hooks.sh`: the Immich database dump, made
  reusable for any Postgres-backed service.
- **One schedule** (`BACKUP_INTERVAL` / `BACKUP_TIME` / `BACKUP_DAY`) runs every
  job in order; `JOB_SCHEDULE=manual` leaves one out. `EXTERNAL_BACKUP_*` and
  the fixed source and destination variables are gone.
- **Portable compose.** Paths reach the container through the
  `HOST_VOLUMES_DIR` mount; Immich's network moved to the optional
  `docker-compose.immich.yml`, so the container starts on machines without
  Immich.
- **Dashboard:** backups grouped by destination volume; Settings lists every
  job and every mounted volume; Runs filters by backup. Manual-only and
  removable jobs aren't flagged stale.
- `state.json` history carries over from the old `<set>:<dest>` keys.
- README: prerequisites and setup for other machines.

## 2026-10-30

- Updated to jimbo-ui 0.7.0: flat fills and circles, less glass, softer
  corners instead of pills, stronger borders and etched row dividers, and no
  dots above page titles. The Brand page gains template categories and search,
  vibrancy and contrast sliders, backdrops, a *Type* section and *Share this
  look* (export and import); the server stores the new theme fields.
- A running backup's dot pulses, so it can't be mistaken for a finished one
  when the theme's accent is yellow.
- The dashboard moved to jimbo.ui (React, Vite and Tailwind in `web/`, built in
  the Dockerfile's first stage); the old hand-written page is gone.
