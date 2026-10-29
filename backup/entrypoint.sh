#!/usr/bin/env bash
# Backup container bootstrap:
#  - picks the supercronic binary matching the CPU architecture
#  - writes the crontab from $BACKUP_CRON
#  - starts supercronic (foreground, logs on stdout)
set -euo pipefail

# One-shot mode: `docker compose run --rm backup --once` runs a backup right away
# then exits. Handy to test the whole chain by hand.
if [ "${1:-}" = "--once" ]; then
	exec /opt/backup/backup.sh
fi

ARCH=$(uname -m)
case "$ARCH" in
	x86_64|amd64)
		SC=/usr/local/bin/supercronic-amd64
		;;
	aarch64|arm64)
		SC=/usr/local/bin/supercronic
		;;
	*)
		echo "[backup] unsupported architecture: $ARCH" >&2
		exit 1
		;;
esac

# The default is hardcoded here (not only in docker-compose.yml) because env values
# passed through compose sometimes lose their trailing `*`, giving a 4-field crontab
# that supercronic rejects at startup. The format is validated as well.
DEFAULT_CRON='30 23 * * *'
CRON="${BACKUP_CRON:-}"
if [ -z "$CRON" ]; then
	CRON="$DEFAULT_CRON"
fi

# A standard crontab has 5 fields (min h dom mon dow). supercronic also accepts 6
# (leading seconds). Anything else is rejected explicitly.
fields=$(echo "$CRON" | awk '{print NF}')
if [ "$fields" != "5" ] && [ "$fields" != "6" ]; then
	echo "[backup] invalid BACKUP_CRON ($fields fields instead of 5): '$CRON'" >&2
	echo "[backup] falling back to the default schedule: '$DEFAULT_CRON'" >&2
	CRON="$DEFAULT_CRON"
fi

# backup.sh declares this schedule to its Sentry cron monitor (supercronic passes its env on).
export BACKUP_SCHEDULE="$CRON"

CRONFILE=/tmp/crontab
echo "$CRON /opt/backup/backup.sh" > "$CRONFILE"

echo "[backup] starting supercronic ($ARCH) with schedule: $CRON (UTC)"
exec "$SC" "$CRONFILE"
