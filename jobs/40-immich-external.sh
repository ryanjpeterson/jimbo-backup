# Immich → the external drive, when it's plugged in, with a database dump first.
JOB_NAME="Immich"
JOB_SOURCE="/Volumes/jimbos-sloppydrive/Immich"
JOB_DEST="/Volumes/external-backup/Immich"
JOB_REMOVABLE=1

before_sync() {
    postgres_dump "${SOURCE_PATH}/db_dumps" immich_db "${IMMICH_DUMP_KEEP:-7}"
}
