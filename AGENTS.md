# Agent instructions

TanStack Start app on Nitro (bun preset), Postgres + Drizzle, Better Auth. UI copy is French, code and
comments English.

## Commands

Type `make` (the Makefile puts `./node_modules/.bin` first, so the repo's Vite+ wins). `make init` once,
`make dev` to work, `make verify` (the pre-push hook runs it, then e2e), `make e2e` for UI changes, `stack-conformity .`
(dotfiles) before production. Never `npm`/`npx`; `vp add`, `vpx`.

## Rules

- **Env**: read `process.env` only in `src/lib/server/env.ts` (zod). Add a variable there, in
  `.env.example` and in the DEPLOY.md table, with the same name.
- **Database**: Postgres only (postgres-js). Schema in `src/lib/db/schema.ts`; every change ships with a
  migration from `make db-generate NAME=<slug>`. Never `drizzle-kit push` against a shared database.
- **Auth**: Better Auth in `src/lib/auth.ts`; never import it from browser code (use
  `src/lib/auth-client.ts`). Public auth forms send a Turnstile token (`useCaptcha`, endpoint in
  `CAPTCHA_ENDPOINTS`); a siteverify outage answers 503 (`/api/auth/$`). Rate limits per client IP live in
  Postgres (`authRateLimitRules`). Protected routes check the session in `beforeLoad` through a server
  function; `tests/e2e/session-forgery.e2e.ts` proves a forged cookie opens neither.
- **Retention**: every period lives in `src/lib/retention.ts`, read by the privacy policy and the purges
  (`purge:retention`, daily). New personal data gets a constant, a purge and a line in the policy.
- **Files**: `src/lib/server/storage.ts` only. Keys are validated; the bucket is private, serve files
  through a session-checked route.
- **E-mail**: `sendEmail` in `src/lib/server/email.ts`; tests read `storage/e2e/_outbox`.
- **Legal**: identity and sub-processors in `src/content/legal/site.ts`. Fill the `[bracketed]`
  placeholders of `PROCESSORS`; keep `HOSTING` accurate (`stack-conformity` checks it).
- **UI**: shadcn primitives in `src/components/ui` (add with `vpx shadcn@latest add`), `cn` from npm
  `cn`. Fix every `shadcn/*` and `anti-slop/*` lint error; never suppress.
- **Tests**: e2e first (`tests/e2e/*.e2e.ts`, tag agent tests `agent`). Vitest only for logic e2e cannot
  reach cheaply; list the failure modes first.
- **Versions**: exact or caret ranges, never `latest`. Conventional commits.
