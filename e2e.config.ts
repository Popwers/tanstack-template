import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';
import { grok } from 'e2e/oauth/grok';

import { E2E_BASE_URL, E2E_DB_PORT, E2E_PORT } from './tests/e2e/isolation';

/**
 * Golden paths against the production build. `tests/e2e/serve.sh` builds the app, starts a throwaway
 * Postgres (`db.sh`), migrates it and serves `.output`; e-mails land in `storage/e2e/_outbox`.
 * Its EXIT trap removes the database without waiting on the server.
 */
export default {
	targets: [
		{
			engine: web({
				locale: 'fr-FR',
				initScripts: [{ path: 'tests/e2e/page-errors.js' }],
			}),
			app: {
				url: E2E_BASE_URL,
				readyUrl: `${E2E_BASE_URL}/api/health`,
				command: {
					executable: 'bash',
					args: ['tests/e2e/serve.sh'],
					startupTimeout: 300_000,
					reuseExisting: process.env.E2E_REUSE_SERVER === '1',
					log: '.e2e/logs/app.log',
					env: {
						PORT: String(E2E_PORT),
						HOST: '127.0.0.1',
						APP_URL: E2E_BASE_URL,
						DATABASE_URL: `postgres://app:app@127.0.0.1:${E2E_DB_PORT}/app`,
						E2E_DB_PORT: String(E2E_DB_PORT),
						BETTER_AUTH_SECRET: 'e2e-only-secret-never-used-outside-e2e',
						STORAGE_DIR: 'storage/e2e',
						RESEND_API_KEY: '',
						MAILPIT_URL: '',
						CF_ENDPOINT: '',
						SENTRY_DSN: '',
						VITE_SENTRY_DSN: '',
						OPENPANEL_CLIENT_ID: '',
						TURNSTILE_SITE_KEY: '',
						TURNSTILE_SECRET_KEY: '',
					},
				},
			},
		},
	],
	tests: 'tests/e2e/**/*.e2e.ts',
	retries: 0,
	trace: 'retain-on-failure',
	// SuperGrok: sign in once with `bunx e2e login spacexai`. Tag agent tests `agent` (CI excludes them).
	agents: {
		default: {
			model: grok('grok-4.7'),
			system: 'You are a thorough QA agent. Verify every outcome on screen.',
		},
	},
} satisfies E2EConfig;
