#!/usr/bin/env bash
# Backs up PostgreSQL (pg_dump custom format) and the uploads (tar.gz) to
# Cloudflare R2. Both files share the same UTC timestamp:
#   <prefix>db-<ts>.dump
#   <prefix>uploads-<ts>.tar.gz
# The prefix (BACKUP_KEY_PREFIX) lets one R2 lifecycle rule expire only the backups
# (e.g. expire objects under `backup-` after 30 days) without touching app files.
#
# Expected variables:
#   POSTGRES_HOST, POSTGRES_PORT (default 5432), POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   CF_ENDPOINT, CF_ACCESS_KEY_ID, CF_ACCESS_SECRET, CF_BUCKET   (not needed in local mode)
#   BACKUP_KEY_PREFIX (default "backup-")
#   UPLOADS_DIR       (default "/data/uploads", mounted read-only)
#   UPLOADS_BUCKET    (R2 mode only: archive s3://<bucket>/uploads/ instead of UPLOADS_DIR)
#   BACKUP_LOCAL_DIR  (test mode: copy the files there instead of uploading to R2)
set -euo pipefail

require() {
	local name="$1"
	if [ -z "${!name:-}" ]; then
		echo "[backup] $name is missing" >&2
		exit 1
	fi
}

DB_FILE=""
UPLOADS_FILE=""
SYNC_DIR=""

on_exit() {
	local exit_code=$?
	rm -f "$DB_FILE" "$UPLOADS_FILE"
	if [ -n "$SYNC_DIR" ]; then
		rm -rf "$SYNC_DIR"
	fi
	[ "$exit_code" -eq 0 ] && return
	# No email alert (deliberate): failures are logged loudly, Coolify exposes the
	# container logs. The original exit code is preserved so supercronic counts the failure.
	echo "[backup] FAILED (exit $exit_code) - see the logs above" >&2
	exit "$exit_code"
}

trap on_exit EXIT

LOCAL_DIR="${BACKUP_LOCAL_DIR:-}"
UPLOADS_BUCKET="${UPLOADS_BUCKET:-}"

require POSTGRES_HOST
require POSTGRES_USER
require POSTGRES_PASSWORD
require POSTGRES_DB
if [ -z "$LOCAL_DIR" ]; then
	require CF_ENDPOINT
	require CF_ACCESS_KEY_ID
	require CF_ACCESS_SECRET
	require CF_BUCKET
elif [ -n "$UPLOADS_BUCKET" ]; then
	echo "[backup] UPLOADS_BUCKET needs the R2 mode: unset BACKUP_LOCAL_DIR" >&2
	exit 1
fi

PORT="${POSTGRES_PORT:-5432}"
PREFIX="${BACKUP_KEY_PREFIX:-backup-}"
UPLOADS_DIR="${UPLOADS_DIR:-/data/uploads}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DB_KEY="${PREFIX}db-${TS}.dump"
UPLOADS_KEY="${PREFIX}uploads-${TS}.tar.gz"
DB_FILE="/tmp/${DB_KEY}"
UPLOADS_FILE="/tmp/${UPLOADS_KEY}"

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

# Publishes one file under the given key: R2 upload, or a plain copy in local test mode.
publish() {
	local file="$1" key="$2"
	if [ -n "$LOCAL_DIR" ]; then
		mkdir -p "$LOCAL_DIR" || return 1
		cp "$file" "${LOCAL_DIR}/${key}" || return 1
		echo "[backup] copied ${LOCAL_DIR}/${key}"
		return 0
	fi
	# `--checksum-algorithm CRC32` avoids an aws-cli v2 regression that sends
	# x-amz-sdk-checksum-algorithm, which R2 rejects.
	r2 s3 cp "$file" "s3://${CF_BUCKET}/${key}" --checksum-algorithm CRC32 --no-progress || return 1
	echo "[backup] uploaded s3://${CF_BUCKET}/${key}"
}

if [ -n "$LOCAL_DIR" ]; then
	echo "[backup] $TS  LOCAL test mode -> $LOCAL_DIR"
else
	echo "[backup] $TS  -> R2 (bucket=$CF_BUCKET prefix=$PREFIX)"
fi

# 1. Database. Custom format (-F c) is already compressed: no extra gzip.
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump \
	--host="$POSTGRES_HOST" \
	--port="$PORT" \
	--username="$POSTGRES_USER" \
	--format=custom \
	--no-owner \
	--no-privileges \
	--file="$DB_FILE" \
	"$POSTGRES_DB"
unset PGPASSWORD

echo "[backup] dump ok ($(du -h "$DB_FILE" | cut -f1))"
publish "$DB_FILE" "$DB_KEY"
rm -f "$DB_FILE"

# 2. Uploads. Never fails the run: the database dump above is already safe.
# The bucket is first copied to a temp dir so the archive has the same layout whatever
# the source, and restore.sh does not need to know where it came from.
backup_uploads() {
	local dir="$UPLOADS_DIR" source="$UPLOADS_DIR"
	if [ -n "$UPLOADS_BUCKET" ]; then
		source="s3://${UPLOADS_BUCKET}/"
		SYNC_DIR=$(mktemp -d) || return 1
		dir="$SYNC_DIR"
		# --only-show-errors hides the warnings behind aws's exit 2 (a file skipped), so keep the code.
		local code=0
		r2 s3 sync "$source" "$dir" --only-show-errors || code=$?
		if [ "$code" -ne 0 ]; then
			echo "[backup] uploads sync from $source failed (aws exit $code)" >&2
			return 1
		fi
	elif [ ! -d "$dir" ]; then
		echo "[backup] uploads skipped: $dir does not exist"
		return 0
	fi
	if [ -z "$(find "$dir" -type f -print -quit 2>/dev/null)" ]; then
		echo "[backup] uploads skipped: $source is empty"
		return 0
	fi
	tar -czf "$UPLOADS_FILE" -C "$dir" . || return 1
	echo "[backup] uploads archive ok ($(du -h "$UPLOADS_FILE" | cut -f1))"
	publish "$UPLOADS_FILE" "$UPLOADS_KEY" || return 1
}

if ! backup_uploads; then
	echo "[backup] WARNING: uploads backup failed, the database backup is intact" >&2
fi

echo "[backup] done ($TS)"
