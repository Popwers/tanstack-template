#!/usr/bin/env bash
# Restores a backup produced by backup.sh.
#
# Usage: restore.sh <db-dump-key> [uploads-key]
#   <db-dump-key>   e.g. backup-db-20260101T233000Z.dump
#   [uploads-key]   e.g. backup-uploads-20260101T233000Z.tar.gz (optional)
#
# Explicit target required (nothing is restored by default):
#   database: DATABASE_URL_RESTORE (postgres://...), or POSTGRES_HOST + POSTGRES_USER +
#             POSTGRES_PASSWORD + POSTGRES_DB (+ POSTGRES_PORT, default 5432)
#   uploads:  RESTORE_UPLOADS_DIR, or RESTORE_UPLOADS_BUCKET (R2 mode only, objects go
#             under s3://<bucket>/): exactly one when an uploads key is given
# Source: R2 (CF_ENDPOINT, CF_ACCESS_KEY_ID, CF_ACCESS_SECRET, CF_BUCKET), or the
# directory BACKUP_LOCAL_DIR in local test mode.
#
# The restore runs `pg_restore --clean --if-exists`: it DROPS and recreates the objects
# of the dump in the target database. Uploads are extracted over RESTORE_UPLOADS_DIR or
# copied into RESTORE_UPLOADS_BUCKET (existing files with the same name are overwritten,
# others are left untouched).
set -euo pipefail

usage() {
	echo "usage: restore.sh <db-dump-key> [uploads-key]" >&2
	exit 2
}

fail() {
	echo "[restore] $*" >&2
	exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
DB_KEY="$1"
UPLOADS_KEY="${2:-}"

# Keys are flat file names: refuse anything that could escape the work/local dir.
for key in "$DB_KEY" "$UPLOADS_KEY"; do
	case "$key" in
		*/*|..*) fail "invalid key: '$key'" ;;
	esac
done

LOCAL_DIR="${BACKUP_LOCAL_DIR:-}"
TARGET_URL="${DATABASE_URL_RESTORE:-}"

# --- Target checks (before downloading anything) ---
if [ -z "$TARGET_URL" ]; then
	for name in POSTGRES_HOST POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
		[ -n "${!name:-}" ] || fail "no restore target: set DATABASE_URL_RESTORE, or $name and the other POSTGRES_* variables"
	done
fi
RESTORE_DIR="${RESTORE_UPLOADS_DIR:-}"
RESTORE_BUCKET="${RESTORE_UPLOADS_BUCKET:-}"
if [ -n "$UPLOADS_KEY" ]; then
	if [ -z "$RESTORE_DIR" ] && [ -z "$RESTORE_BUCKET" ]; then
		fail "an uploads key was given: set RESTORE_UPLOADS_DIR or RESTORE_UPLOADS_BUCKET"
	fi
	if [ -n "$RESTORE_DIR" ] && [ -n "$RESTORE_BUCKET" ]; then
		fail "set RESTORE_UPLOADS_DIR or RESTORE_UPLOADS_BUCKET, not both"
	fi
	if [ -n "$RESTORE_BUCKET" ] && [ -n "$LOCAL_DIR" ]; then
		fail "RESTORE_UPLOADS_BUCKET needs the R2 mode: unset BACKUP_LOCAL_DIR"
	fi
fi
if [ -z "$LOCAL_DIR" ]; then
	for name in CF_ENDPOINT CF_ACCESS_KEY_ID CF_ACCESS_SECRET CF_BUCKET; do
		[ -n "${!name:-}" ] || fail "$name is missing (or set BACKUP_LOCAL_DIR for local mode)"
	done
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Runs one aws command against R2. Credentials are scoped to a subshell so they never
# linger in this script's environment.
r2() {
	(
		export AWS_ACCESS_KEY_ID="$CF_ACCESS_KEY_ID"
		export AWS_SECRET_ACCESS_KEY="$CF_ACCESS_SECRET"
		export AWS_DEFAULT_REGION=auto
		aws "$@" --endpoint-url "$CF_ENDPOINT"
	)
}

# Copies/downloads one backup file into $WORK_DIR and prints nothing.
fetch() {
	local key="$1"
	if [ -n "$LOCAL_DIR" ]; then
		[ -f "${LOCAL_DIR}/${key}" ] || fail "not found: ${LOCAL_DIR}/${key}"
		cp "${LOCAL_DIR}/${key}" "${WORK_DIR}/${key}"
		return 0
	fi
	r2 s3 cp "s3://${CF_BUCKET}/${key}" "${WORK_DIR}/${key}" --no-progress \
		|| fail "download failed: ${key}"
}

# --- Database ---
echo "[restore] fetching $DB_KEY"
fetch "$DB_KEY"
if [ -n "$TARGET_URL" ]; then
	echo "[restore] pg_restore -> DATABASE_URL_RESTORE"
	pg_restore --clean --if-exists --no-owner --no-privileges \
		--dbname="$TARGET_URL" "${WORK_DIR}/${DB_KEY}"
else
	echo "[restore] pg_restore -> ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
	PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --no-owner --no-privileges \
		--host="$POSTGRES_HOST" --port="${POSTGRES_PORT:-5432}" \
		--username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
		"${WORK_DIR}/${DB_KEY}"
fi
echo "[restore] database restored"

# --- Uploads ---
if [ -n "$UPLOADS_KEY" ]; then
	echo "[restore] fetching $UPLOADS_KEY"
	fetch "$UPLOADS_KEY"
	if [ -n "$RESTORE_DIR" ]; then
		mkdir -p "$RESTORE_DIR"
		tar -xzf "${WORK_DIR}/${UPLOADS_KEY}" -C "$RESTORE_DIR"
		echo "[restore] uploads extracted to $RESTORE_DIR"
	else
		mkdir "${WORK_DIR}/uploads"
		tar -xzf "${WORK_DIR}/${UPLOADS_KEY}" -C "${WORK_DIR}/uploads"
		# `cp --recursive`, not `sync`: sync skips an object of the same size whose copy in
		# the bucket is newer than the archived file, so a same-name file would not always be
		# overwritten. CRC32: same R2 checksum workaround as backup.sh.
		r2 s3 cp "${WORK_DIR}/uploads" "s3://${RESTORE_BUCKET}/" --recursive \
			--checksum-algorithm CRC32 --no-progress \
			|| fail "upload to s3://${RESTORE_BUCKET}/ failed"
		echo "[restore] uploads copied to s3://${RESTORE_BUCKET}/"
	fi
fi

echo "[restore] done"
