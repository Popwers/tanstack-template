.DEFAULT_GOAL := help

MAKEFLAGS += --no-print-directory

# The repo's own Vite+ (the global `vp` can be older than the repo needs).
export PATH := $(CURDIR)/node_modules/.bin:$(PATH)

IMAGE := $(notdir $(CURDIR))

.PHONY: help init install hooks check fix dev build start test e2e verify \
	up down reset logs db-generate db-migrate db-studio image image-run backup-image clean

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_\-]+:.*##/ {printf "  %-14s %s\n", $$1, $$2} END {printf "\n"}' $(MAKEFILE_LIST)

init: ## First run: .env with a fresh secret, deps, hooks, Postgres, migrations
	@test -f .env || (cp .env.example .env && sed -i.bak "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$$(openssl rand -base64 32)#" .env && rm -f .env.bak && echo "Created .env")
	@bun install
	@$(MAKE) hooks
	@docker compose up -d --wait
	@bun scripts/migrate.ts
	@echo "Ready: make dev → http://localhost:3000 (Mailpit http://localhost:8025)"

install: ## Install dependencies and Git hooks
	@vp install
	@$(MAKE) hooks

hooks: ## (Re)install Git hooks (vp config)
	@vp config >/dev/null
	@echo "Hooks installed (.vite-hooks/: pre-commit vp staged, pre-push verify + e2e)"

check: ## lint + fmt + typecheck
	@vp check

fix: ## Auto-fix lint + fmt
	@vp check --fix

dev: ## Postgres + Mailpit (docker), migrations, then the dev server on :3000
	@docker compose up -d --wait
	@bun scripts/migrate.ts
	@vp run dev

build: ## Production build (.output, Nitro bun preset)
	@vp run build

start: ## Run the built server
	@vp run start

test: ## Vitest suite
	@vp test run

e2e: ## e2e golden paths (builds, throwaway Postgres on :5439, app on :3011)
	@vp run test:e2e

verify: ## Full gate: check + tests + build (the pre-push hook runs it)
	@vp check
	@vp test run
	@vp run build

up: ## Start Postgres + Mailpit
	@docker compose up -d --wait

down: ## Stop the dev stack (keeps the volume)
	@docker compose down

reset: ## Stop the dev stack AND wipe the database volume
	@docker compose down -v

logs: ## Tail the dev stack logs
	@docker compose logs -f

db-generate: ## Generate a Drizzle migration from the schema (NAME=<slug>)
	@bun --bun drizzle-kit generate $(if $(NAME),--name $(NAME),)

db-migrate: ## Apply pending migrations
	@bun scripts/migrate.ts

db-studio: ## Open Drizzle Studio
	@vp run db:studio

image: ## Build the production Docker image
	@docker build -t $(IMAGE) .

image-run: image ## Run the production image against the dev database on :3002
	@docker run --rm -p 3002:3000 \
		-e DATABASE_URL="$$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/localhost/host.docker.internal/')" \
		-e BETTER_AUTH_SECRET="$$(openssl rand -base64 32)" \
		-e APP_URL=http://localhost:3002 \
		-e TURNSTILE_SITE_KEY=1x00000000000000000000AA -e TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
		$(IMAGE)

backup-image: ## Build the backup service image
	@docker build -t $(IMAGE)-backup backup

clean: ## Remove node_modules, build outputs and caches
	@rm -rf node_modules .output .tanstack .nitro .cache dist-scripts tsconfig.tsbuildinfo
