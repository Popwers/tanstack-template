#!/usr/bin/env bash
# Backs up PostgreSQL (pg_dump custom format) and the uploads (tar.gz) to
# Cloudflare R2. Both files share the same UTC timestamp:
#   <prefix>db-<ts>.dump
#   <prefix>uploads-<ts>.tar.gz
# The prefix (BACKUP_KEY_PREFIX) lets one R2 lifecycle rule expire only the backups
# (objects under `backup-` expire after 3 days, DEPLOY.md §4) without touching app files.
#
# Each run checks in to a Sentry cron monitor (in_progress, then ok or error): a failed run opens
# an issue, and a run that never starts is reported as missed. With a 3-day retention, three silent
# failures would leave nothing to restore. The check-in is best effort and never fails the backup.
#
# Expected variables:
#   POSTGRES_HOST, POSTGRES_PORT (default 5432), POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   CF_ENDPOINT, CF_ACCESS_KEY_ID, CF_ACCESS_SECRET, CF_BUCKET   (not needed in local mode)
#   BACKUP_KEY_PREFIX (default "backup-")
#   UPLOADS_DIR       (default "/data/uploads", mounted read-only)
#   UPLOADS_BUCKET    (R2 mode only: archive the whole s3://<bucket>/ instead of UPLOADS_DIR)
#   BACKUP_LOCAL_DIR  (test mode: copy the files there instead of uploading to R2)
#   SENTRY_DSN        (optional: the cron monitor's project; unset, no check-in)
#   SENTRY_MONITOR_SLUG (default "backup")
#   BACKUP_SCHEDULE   (set by entrypoint.sh: the crontab the monitor expects)
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

# --- Sentry cron monitor ---
# The DSN https://<public-key>@<host>/<project-id> gives the check-in endpoint
# https://<host>/api/<project-id>/cron/<slug>/<public-key>/.
MONITOR_URL=""
if [[ "${SENTRY_DSN:-}" =~ ^(https?)://([^:@/]+)(:[^@/]*)?@([^/]+)/(.*/)?([0-9]+)/?$ ]]; then
	MONITOR_URL="${BASH_REMATCH[1]}://${BASH_REMATCH[4]}/api/${BASH_REMATCH[6]}/cron/${SENTRY_MONITOR_SLUG:-backup}/${BASH_REMATCH[2]}/"
elif [ -n "${SENTRY_DSN:-}" ]; then
	echo "[backup] WARNING: SENTRY_DSN is not a DSN, no cron check-in" >&2
fi
CHECK_IN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date -u +%s)

# Sends one check-in. Never fails: a Sentry outage must not cost a backup.
check_in() {
	local status="$1"
	[ -n "$MONITOR_URL" ] || return 0
	local url="${MONITOR_URL}?check_in_id=${CHECK_IN_ID}&status=${status}"
	local body=""
	# The first check-in creates or updates the monitor with the schedule supercronic runs
	# (5-field crontab only: Sentry has no seconds field). Missed after 30 min, failed after 2 h.
	if [ "$status" = "in_progress" ] && [ "$(echo "${BACKUP_SCHEDULE:-}" | awk '{print NF}')" = "5" ]; then
		body=$(printf '{"monitor_config":{"schedule":{"type":"crontab","value":"%s"},"checkin_margin":30,"max_runtime":120,"timezone":"UTC","failure_issue_threshold":1,"recovery_threshold":1}}' "$BACKUP_SCHEDULE")
	fi
	if [ -n "$body" ]; then
		curl -fsS -m 10 -o /dev/null -X POST -H 'Content-Type: application/json' --data "$body" "$url" \
			|| echo "[backup] WARNING: Sentry check-in ($status) failed" >&2
	else
		curl -fsS -m 10 -o /dev/null "$url" || echo "[backup] WARNING: Sentry check-in ($status) failed" >&2
	fi
	return 0
}

on_exit() {
	local exit_code=$?
	rm -f "$DB_FILE" "$UPLOADS_FILE"
	if [ -n "$SYNC_DIR" ]; then
		rm -rf "$SYNC_DIR"
	fi
	if [ "$exit_code" -eq 0 ]; then
		check_in ok
		return
	fi
	# The error check-in opens a Sentry issue (the alert). The original exit code is
	# preserved so supercronic counts the failure too.
	check_in error
	echo "[backup] FAILED (exit $exit_code) - see the logs above" >&2
	exit "$exit_code"
}

trap on_exit EXIT
check_in in_progress

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

# 2. Uploads. The database dump above is already safe whatever happens here, but a failed
# archive still fails the run, so the monitor reports it. The bucket is first copied to a temp dir so the archive has the same layout whatever
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
	echo "[backup] uploads backup failed, the database backup is intact" >&2
	exit 1
fi

echo "[backup] done ($TS)"
