# TanStack Start template

MyStudio standard for new web products: TanStack Start on Nitro (bun preset), Postgres + Drizzle, Better Auth
(e-mail + password, verification and reset by Resend, Turnstile), Cloudflare R2 storage with a disk fallback,
Sentry, OpenPanel, legal pages, a 50 MB Docker image that migrates at boot, a Postgres + uploads backup service,
e2e golden paths and semantic-release. Vite+ (`vp`) is the toolchain, Bun the package manager and runtime.

## Start a project

```bash
gh repo create <org>/<name> --private --template Popwers/tanstack-template --clone
cd <name>
make init   # .env with a fresh BETTER_AUTH_SECRET, deps, hooks, Postgres + Mailpit, migrations
make dev    # http://localhost:3000 — e-mails land in Mailpit at http://localhost:8025
```

Then:

1. Rename: `name` in `package.json`, `COMPOSE_PROJECT_NAME` in `.env.example`, `SITE` in
   `src/content/legal/site.ts` (name, domain, contact). Keep `PUBLISHER` and `HOSTING`.
2. Add product tables to `src/lib/db/schema.ts`, then `make db-generate NAME=<slug>`.
3. Provision the infrastructure with `/provision-project <name>` (Postgres role + db, R2 buckets,
   Cloudflare zone, Coolify app + backup), then follow [DEPLOY.md](DEPLOY.md).
4. `stack-conformity .` (from the dotfiles, on PATH) before production: it checks the repo against
   the standard and exits 1 on a required failure.

## Commands

| Command | What it does |
| --- | --- |
| `make init` | First run (idempotent) |
| `make dev` | Postgres + Mailpit, migrations, dev server on :3000 |
| `make check` / `make fix` | Lint + fmt + typecheck (`vp check`) / auto-fix |
| `make test` | Vitest (`vp test`) |
| `make e2e` | Golden paths against the production build, throwaway Postgres on :5439 |
| `make verify` | Check + tests + build |
| `make image` / `make image-run` | Build / run the production image against the dev database on :3002 |
| `make backup-image` | Build the backup service image |
| `make db-generate NAME=…` / `make db-migrate` / `make db-studio` | Drizzle |
| `make reset` | Stop the dev stack and wipe its volume |

## Git hooks

`make init` / `make install` run `vp config`, which points Git at `.vite-hooks/`. Pre-commit runs
`vp staged`. Pre-push runs `make verify`, then `vp run test:e2e:ci` when app paths changed; a push
touching only docs skips the gate. No workflow runs tests: GitHub Actions only releases. From a git
worktree, push with `git -c core.hooksPath="$PWD/.vite-hooks/_" push` so the gate runs.

## Layout

```
src/
  routes/                 file routes: home, auth screens, /dashboard (guarded), legal pages
  routes/api/health.ts    readiness probe (Docker, Coolify, e2e)
  routes/api/auth/$.ts    Better Auth handler
  routes/sitemap[.]xml.ts sitemap of PUBLIC_PAGES; robots[.]txt.ts announces it
  lib/http-headers.ts     security + cache headers set by src/server.ts (PUBLIC_PAGES edge-cached)
  lib/server/edge-cache.ts Cloudflare purge after each production boot (server/plugins/)
  lib/auth.ts             Better Auth server config (Resend e-mails, Turnstile captcha)
  lib/db/                 Drizzle schema + postgres-js client
  lib/server/env.ts       the only process.env reader (zod-validated)
  lib/server/storage.ts   R2 when CF_* are set, else STORAGE_DIR on disk
  lib/server/email.ts     Resend → Mailpit → storage/_outbox
  content/legal/          SITE, PUBLISHER (SAS MYSTUDIO.DIGITAL), HOSTING (Hetzner), legal texts
scripts/migrate.ts        migrations, bundled and run by docker-entrypoint.sh at every boot
backup/                   second Coolify app: pg_dump + uploads → R2 backups bucket
tests/                    *.test.ts (Vitest), e2e/*.e2e.ts (e2e)
tools/oxlint/anti-slop/   vendored lint plugin
```

## Stripe

Not bundled: most products start without payments. When one needs them, follow Zailes
(`src/lib/billing/`, `src/routes/api/stripe/webhook.ts`): add `stripe`, read `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` in `src/lib/server/env.ts`, verify the webhook signature on the raw body, keep a
keyless local mode, and forward webhooks with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
The skills `stripe-best-practices` and `stripe-docs` cover the API choices.

## License

MIT
