# Immich → the internal backup drive, with a database dump first.
JOB_NAME="Immich"
JOB_SOURCE="/Volumes/jimbos-sloppydrive/Immich"
JOB_DEST="/Volumes/internal-backup/Immich"

# Dump Immich's Postgres into the Immich folder, so the dump is copied with the
# photos. Keeps the newest IMMICH_DUMP_KEEP dumps (default 7).
before_sync() {
    postgres_dump "${SOURCE_PATH}/db_dumps" immich_db "${IMMICH_DUMP_KEEP:-7}"
}
