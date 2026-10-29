#!/usr/bin/env bash
# Backs up PostgreSQL (pg_dump custom format) and the uploads (tar.gz) to
# Cloudflare R2. Both files share the same UTC timestamp:
#   <prefix>db-<ts>.dump
#   <prefix>uploads-<ts>.tar.gz
# The prefix (BACKUP_KEY_PREFIX) lets one R2 lifecycle rule expire only the backups
# (objects under `backup-` expire after 3 days, DEPLOY.md §4) without touching app files.
#
# A failed run sends one alert email (send_alert below): with a 3-day retention, three silent
# failures would leave nothing to restore.
#
# Expected variables:
#   POSTGRES_HOST, POSTGRES_PORT (default 5432), POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   CF_ENDPOINT, CF_ACCESS_KEY_ID, CF_ACCESS_SECRET, CF_BUCKET   (not needed in local mode)
#   BACKUP_KEY_PREFIX (default "backup-")
#   UPLOADS_DIR       (default "/data/uploads", mounted read-only)
#   UPLOADS_BUCKET    (R2 mode only: archive the whole s3://<bucket>/ instead of UPLOADS_DIR)
#   BACKUP_LOCAL_DIR  (test mode: copy the files there instead of uploading to R2)
#
# Failure alert (one email per failed run, through Resend; unset = log line only):
#   RESEND_API_KEY, BACKUP_ALERT_EMAIL_TO (comma-separated for several recipients)
#   BACKUP_ALERT_EMAIL_FROM (falls back to EMAIL_FROM): a sender on a domain the key may send from;
#                     its display name (`Name <address>`) names the project in the subject
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

# --- Failure alert: one email per failed run ---
# The first failed step sends one email to BACKUP_ALERT_EMAIL_TO through Resend. Best effort: without
# RESEND_API_KEY, BACKUP_ALERT_EMAIL_TO or a sender it only logs a line, and a Resend outage never
# changes the backup's outcome. The key never reaches the log or the process list.
STEP="configuration"
ALERT_SENT=0

# Sends the failure email for the given step. Always returns 0.
send_alert() {
	local step="$1" detail="$2"
	[ "$ALERT_SENT" -eq 0 ] || return 0
	ALERT_SENT=1
	local to="${BACKUP_ALERT_EMAIL_TO:-}" from="${BACKUP_ALERT_EMAIL_FROM:-${EMAIL_FROM:-}}"
	if [ -z "${RESEND_API_KEY:-}" ] || [ -z "$to" ] || [ -z "$from" ]; then
		echo "[backup] alert email skipped: RESEND_API_KEY, BACKUP_ALERT_EMAIL_TO or BACKUP_ALERT_EMAIL_FROM is unset" >&2
		return 0
	fi
	# The project is the sender's display name (`App <no-reply@app.fr>`), else the sender's domain.
	local project="" addr="$from"
	if [[ "$from" == *"<"* ]]; then
		project="${from%%<*}"
		addr="${from##*<}"
		addr="${addr%%>*}"
	fi
	project="${project//\"/}"
	project="${project%"${project##*[![:space:]]}"}"
	project="${project#"${project%%[![:space:]]*}"}"
	[ -n "$project" ] || project="${addr##*@}"
	local now text payload
	now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	text=$(printf 'The backup of %s failed.\n\nStep: %s\nDate (UTC): %s\n%s\n\nThe details are in the log of the backup container on Coolify.' \
		"$project" "$step" "$now" "$detail")
	payload=$(jq -n --arg from "$from" --arg to "$to" --arg subject "[$project] Backup failed: $step" --arg text "$text" \
		'{from: $from, to: [$to | split(",")[] | gsub("^ +| +$"; "") | select(. != "")], subject: $subject, text: $text}') || {
		echo "[backup] WARNING: alert email not sent (jq failed)" >&2
		return 0
	}
	# The key goes in through curl's stdin config. The idempotency key keeps a retried request to
	# one email.
	if printf 'header = "Authorization: Bearer %s"\n' "$RESEND_API_KEY" | curl --config - -fsS \
		--max-time 15 --retry 2 -o /dev/null -X POST https://api.resend.com/emails \
		-H 'Content-Type: application/json' -H "Idempotency-Key: backup-${now}" \
		--data "$payload"; then
		echo "[backup] alert email sent ($step)" >&2
	else
		echo "[backup] WARNING: alert email not sent (Resend unreachable or refused)" >&2
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
		return
	fi
	# The original exit code is preserved so supercronic counts the failure too.
	echo "[backup] FAILED (exit $exit_code) - see the logs above" >&2
	send_alert "$STEP" "Exit code: $exit_code"
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
STEP="database dump"
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
STEP="database upload"
publish "$DB_FILE" "$DB_KEY"
rm -f "$DB_FILE"

# 2. Uploads. The database dump above is already safe whatever happens here, but a failed
# archive still fails the run, so the alert email reports it. The bucket is first copied to a temp
# dir so the archive has the same layout whatever the source, and restore.sh does not need to know
# where it came from.
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

STEP="uploads archive"
if ! backup_uploads; then
	echo "[backup] uploads backup failed, the database backup is intact" >&2
	exit 1
fi

echo "[backup] done ($TS)"
