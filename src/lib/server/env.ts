import { z } from 'zod';

/**
 * Server-side environment, validated once at first use.
 *
 * Boundary rule: every `process.env` read of the server lives here, so a typo or a missing
 * production variable fails loudly instead of becoming `undefined` deep in a handler.
 */

/** Trimmed non-empty string, or `undefined` when the variable is absent or blank. */
const optionalString = z
	.string()
	.trim()
	.transform((value) => (value.length === 0 ? undefined : value))
	.optional();

const envSchema = z.object({
	NODE_ENV: z.string().default('development'),
	/** Port the server listens on (Nitro reads the same variable). */
	PORT: z.coerce.number().int().positive().default(3000),
	/** Set by TanStack Start while `vp build` prerenders pages. Never set at runtime. */
	TSS_PRERENDERING: z
		.string()
		.optional()
		.transform((value) => value === 'true'),

	DATABASE_URL: z.string().min(1),
	DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

	/** Required in every environment: `src/lib/auth.ts` stops the server when it is blank. */
	BETTER_AUTH_SECRET: optionalString,
	APP_URL: z.url().default('http://localhost:3000'),
	/** Extra allowed origins, comma-separated. */
	TRUSTED_ORIGINS: z
		.string()
		.default('')
		.transform((value) =>
			value
				.split(',')
				.map((origin) => origin.trim())
				.filter((origin) => origin.length > 0),
		),

	/** Disk fallback when R2 is not configured. */
	STORAGE_DIR: z.string().default('./storage'),
	CF_ENDPOINT: optionalString,
	CF_ACCESS_KEY_ID: optionalString,
	CF_ACCESS_SECRET: optionalString,
	CF_BUCKET: optionalString,

	/** Absent: e-mails go to Mailpit (`MAILPIT_URL`), else to `{STORAGE_DIR}/_outbox`. */
	RESEND_API_KEY: optionalString,
	MAILPIT_URL: optionalString,
	EMAIL_FROM: z.string().min(1).default('App <no-reply@example.com>'),
	EMAIL_REPLY_TO: optionalString,

	TURNSTILE_SITE_KEY: optionalString,
	TURNSTILE_SECRET_KEY: optionalString,
	/** e2e only: a stand-in for Cloudflare's siteverify (`tests/e2e/siteverify.ts`). Refused in production. */
	TURNSTILE_SITEVERIFY_URL: optionalString,

	SENTRY_DSN: optionalString,

	/** Cloudflare zone of APP_URL and a token limited to « Cache Purge » on it. Both, or the purge is off. */
	CLOUDFLARE_ZONE_ID: optionalString,
	CLOUDFLARE_API_TOKEN: optionalString,

	/** Self-hosted OpenPanel. Absent client id: no analytics. */
	OPENPANEL_API_URL: z.url().default('https://o.mystudio.digital/api'),
	OPENPANEL_CLIENT_ID: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validated server environment, parsed on first call and memoised.
 * @returns The typed environment.
 * @throws Error `INVALID_ENV` when a required variable is missing or malformed.
 */
export function env(): Env {
	if (cached !== null) return cached;
	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join(', ');
		throw new Error(`INVALID_ENV: ${details}`);
	}
	cached = parsed.data;
	return cached;
}

/** Drop the memoised environment so the next {@link env} call re-reads `process.env` (test seam). */
export function resetEnvCache(): void {
	cached = null;
}

/** @returns Whether `NODE_ENV` is `production`, where missing secrets are fatal. */
export function isProduction(): boolean {
	return env().NODE_ENV === 'production';
}

/** Where the public pages are purged after a deploy: Cloudflare with both CLOUDFLARE_* set, nowhere otherwise. */
export type EdgeCachePurge = { kind: 'cloudflare'; zoneId: string; apiToken: string } | { kind: 'off' };

/** @returns The post-deploy purge target. */
export function edgeCachePurge(): EdgeCachePurge {
	const { CLOUDFLARE_ZONE_ID: zoneId, CLOUDFLARE_API_TOKEN: apiToken } = env();
	return zoneId !== undefined && apiToken !== undefined
		? { kind: 'cloudflare', zoneId, apiToken }
		: { kind: 'off' };
}

/** @returns APP_URL without its trailing slash, the origin of every canonical URL. */
export function appOrigin(): string {
	return env().APP_URL.replace(/\/+$/, '');
}

/** @returns Whether this process is the build-time prerender server. */
export function isPrerendering(): boolean {
	return env().TSS_PRERENDERING;
}
