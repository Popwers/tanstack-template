# syntax=docker/dockerfile:1.7
# Production image (TanStack Start + Nitro bun preset).
#   deps   → full dependencies (vite-plus and plugins are devDependencies)
#   build  → Nitro bundle (.output) + the migrate script bundled into a standalone .mjs
#   runner → popwers/mini-bun, no node_modules outside .output: everything else is bundled.
# The entrypoint migrates the database, then starts the server.

ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
	bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
ENV NODE_ENV=production \
	NITRO_PRESET=bun
# Coolify build args, all optional. SENTRY_AUTH_TOKEN uploads source maps; SOURCE_COMMIT ("Include
# Source Commit in Build") names the release; VITE_SENTRY_DSN is inlined in the browser bundle.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_PROJECT
ARG SOURCE_COMMIT
ARG VITE_SENTRY_DSN
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
	SENTRY_PROJECT=$SENTRY_PROJECT \
	SENTRY_RELEASE=$SOURCE_COMMIT \
	VITE_SENTRY_DSN=$VITE_SENTRY_DSN
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Never ship source maps, even when the upload was skipped.
RUN bun run build \
	&& find .output -type f -name '*.map' -delete \
	&& bun build scripts/migrate.ts --target bun --outfile dist-scripts/migrate.mjs

FROM popwers/mini-bun:latest AS runner
WORKDIR /home/bun/app
ENV NODE_ENV=production \
	PORT=3000 \
	STORAGE_DIR=/home/bun/app/storage

COPY --chown=bun:bun --from=build /app/.output ./.output
COPY --chown=bun:bun --from=build /app/dist-scripts ./dist-scripts
COPY --chown=bun:bun drizzle ./drizzle
COPY --chown=bun:bun docker-entrypoint.sh ./

# Disk fallback for uploads when R2 is not configured (mount a volume there). Run unprivileged.
RUN chmod +x docker-entrypoint.sh \
	&& mkdir -p storage \
	&& chown bun:bun storage
USER bun

EXPOSE 3000
# Bun-native probe: no curl/wget in the minimal image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["./docker-entrypoint.sh"]
