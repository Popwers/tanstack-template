#!/usr/bin/env bash
# Throwaway Postgres for the e2e suite (tmpfs, fresh every run).
#   bash tests/e2e/db.sh up    # container on 127.0.0.1:$E2E_DB_PORT (5439), migrated
#   bash tests/e2e/db.sh down  # remove it
set -euo pipefail
cd "$(dirname "$0")/../.."

container="${E2E_DB_CONTAINER:-$(basename "$PWD")-e2e-db}"
port="${E2E_DB_PORT:-5439}"
export DATABASE_URL="postgres://app:app@127.0.0.1:${port}/app"

case "${1:-}" in
up)
	rm -rf storage/e2e
	docker rm -f "$container" >/dev/null 2>&1 || true
	docker run -d --name "$container" \
		-e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app \
		-p "127.0.0.1:${port}:5432" --tmpfs /var/lib/postgresql \
		postgres:18-alpine >/dev/null
	for _ in $(seq 1 60); do
		if docker exec "$container" pg_isready -U app -d app -h 127.0.0.1 >/dev/null 2>&1; then
			break
		fi
		sleep 0.5
	done
	bun scripts/migrate.ts
	;;
down)
	docker rm -f "$container" >/dev/null 2>&1 || true
	;;
*)
	echo "usage: bash tests/e2e/db.sh up|down" >&2
	exit 1
	;;
esac
