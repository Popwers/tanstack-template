#!/usr/bin/env bash
# App under test (`e2e.config.ts` runs it as `app.command`): build, throwaway Postgres, migrate, serve.
# The runner stops the process group with SIGTERM; the trap removes the database and kills the server
# without waiting on it.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$PWD/node_modules/.bin:$PATH"

server=""
cleanup() {
	bash tests/e2e/db.sh down
	if [ -n "$server" ]; then
		kill -KILL "$server" 2>/dev/null || true
	fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

NODE_ENV=production bun --bun vp build
bash tests/e2e/db.sh up
NODE_ENV=test bun .output/server/index.mjs &
server=$!
wait "$server"
