#!/usr/bin/env bash
# App under test (`e2e.config.ts` runs it as `app.command`): build, throwaway Postgres, migrate, the
# Turnstile siteverify stand-in, serve. The runner stops the process group with SIGTERM; the trap removes
# the database and kills both servers without waiting on them.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$PWD/node_modules/.bin:$PATH"

server=""
siteverify=""
cleanup() {
	bash tests/e2e/db.sh down
	for pid in "$server" "$siteverify"; do
		if [ -n "$pid" ]; then
			kill -KILL "$pid" 2>/dev/null || true
		fi
	done
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

NODE_ENV=production bun --bun vp build
bash tests/e2e/db.sh up
bun tests/e2e/siteverify.ts &
siteverify=$!
NODE_ENV=test bun .output/server/index.mjs &
server=$!
wait "$server"
