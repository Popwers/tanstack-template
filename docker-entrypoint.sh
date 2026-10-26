#!/bin/sh
# Migrate the database, then hand off to the server. `set -e` aborts the boot on a failed
# migration, so the container never serves an unmigrated database.
set -e

if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
	echo "FATAL: BETTER_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32" >&2
	exit 1
fi

echo "→ Applying database migrations…"
bun dist-scripts/migrate.mjs

echo "→ Starting server on port ${PORT:-3000}…"
exec bun .output/server/index.mjs
