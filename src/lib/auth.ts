import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { captcha } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { db, schema } from '#/lib/db';
import { SESSION_RETENTION_DAYS } from '#/lib/retention';
import { authIpAddressOptions } from '#/lib/server/client-ip';
import { actionEmail, sendEmail } from '#/lib/server/email';
import { env, isPrerendering } from '#/lib/server/env';
import { turnstileKeys, turnstileSiteVerifyUrl } from '#/lib/server/turnstile';

/** Auth endpoints that need a Turnstile token in `x-captcha-response`: every form open without an account. */
export const CAPTCHA_ENDPOINTS = ['/sign-up/email', '/sign-in/email', '/request-password-reset'];

/**
 * Per-route limits, per client IP: at most `max` requests per `window` seconds. Hardened beyond Better
 * Auth's defaults on the routes worth brute-forcing or abusing as a mail relay. A key must be a path
 * Better Auth really serves, or the default (100 per minute) applies silently.
 * @param isTestEnvironment - The e2e suite signs in from one IP far more often than a person would.
 * @returns The rules, keyed by path relative to `/api/auth`.
 */
export function authRateLimitRules(isTestEnvironment: boolean) {
	return {
		'/sign-in/email': { window: 60, max: isTestEnvironment ? 30 : 5 },
		'/sign-up/email': { window: 3600, max: 10 },
		// Both mail any address without a session: the default (3 per minute) allows 180 mails/hour/IP.
		'/request-password-reset': { window: 3600, max: 5 },
		'/send-verification-email': { window: 3600, max: 5 },
		'/reset-password': { window: 3600, max: 10 },
	};
}

/**
 * Better Auth's signing secret. A missing secret stops the server at boot, except in the build-time
 * prerender server, which signs nothing.
 * @returns The secret.
 * @throws Error when `BETTER_AUTH_SECRET` is blank.
 */
function resolveAuthSecret(): string {
	const secret = env().BETTER_AUTH_SECRET;
	if (secret) return secret;
	if (isPrerendering()) return 'prerender-build-only-never-used-at-runtime';
	throw new Error('BETTER_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32');
}

/**
 * Turnstile check on {@link CAPTCHA_ENDPOINTS}: 400 without a token, 403 for a rejected one, and 500 when
 * siteverify is unreachable, which `/api/auth/$` turns into 503.
 */
export const turnstile = captcha({
	provider: 'cloudflare-turnstile',
	secretKey: turnstileKeys().secretKey,
	endpoints: CAPTCHA_ENDPOINTS,
	siteVerifyURLOverride: turnstileSiteVerifyUrl(),
});

/**
 * Server auth instance: e-mail + password with mandatory verification, reset by e-mail (Resend),
 * Turnstile on sign-up, sign-in and reset request, rate limits per client IP.
 */
export const auth = betterAuth({
	secret: resolveAuthSecret(),
	baseURL: env().APP_URL,
	trustedOrigins: [env().APP_URL, ...env().TRUSTED_ORIGINS],
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	session: { expiresIn: SESSION_RETENTION_DAYS * 24 * 60 * 60 },
	// Stored in Postgres: counters survive a redeploy and hold across instances. `purge:retention`
	// deletes the idle rows, which Better Auth only prunes when another key rolls over.
	rateLimit: {
		enabled: true,
		storage: 'database',
		window: 60,
		max: 100,
		customRules: authRateLimitRules(env().NODE_ENV === 'test'),
	},
	advanced: { ipAddress: authIpAddressOptions },
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		minPasswordLength: 10,
		// A reset means the old password may be known to someone else: every other session ends.
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: 'Réinitialiser votre mot de passe',
				...actionEmail(
					'Réinitialiser votre mot de passe',
					'Ce lien est valable une heure. Ignorez cet e-mail si la demande ne vient pas de vous.',
					{ label: 'Choisir un nouveau mot de passe', url },
				),
			});
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendEmail({
				to: user.email,
				subject: 'Confirmez votre adresse e-mail',
				...actionEmail(
					'Confirmez votre adresse e-mail',
					'Un clic suffit pour activer votre compte.',
					{
						label: 'Confirmer mon adresse',
						url,
					},
				),
			});
		},
	},
	plugins: [
		// Public auth endpoints must carry a Turnstile token in `x-captcha-response`.
		turnstile,
		tanstackStartCookies(),
	],
});
