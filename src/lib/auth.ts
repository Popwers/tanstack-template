import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { captcha } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { db, schema } from '#/lib/db';
import { actionEmail, sendEmail } from '#/lib/server/email';
import { env, isPrerendering } from '#/lib/server/env';
import { turnstileKeys } from '#/lib/server/turnstile';

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
 * Server auth instance: e-mail + password with mandatory verification, reset by e-mail (Resend),
 * Turnstile on sign-up, sign-in and reset request.
 */
export const auth = betterAuth({
	secret: resolveAuthSecret(),
	baseURL: env().APP_URL,
	trustedOrigins: [env().APP_URL, ...env().TRUSTED_ORIGINS],
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		minPasswordLength: 10,
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
		captcha({ provider: 'cloudflare-turnstile', secretKey: turnstileKeys().secretKey }),
		tanstackStartCookies(),
	],
});
