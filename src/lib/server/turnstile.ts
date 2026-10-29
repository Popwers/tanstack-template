import { env, isPrerendering, isProduction } from '#/lib/server/env';

/** The Turnstile widget the auth forms render and the server verifies tokens against. */
export interface TurnstileKeys {
	siteKey: string;
	secretKey: string;
}

/** Cloudflare's published always-pass test pair, used outside production only. */
export const TURNSTILE_TEST_KEYS: TurnstileKeys = {
	siteKey: '1x00000000000000000000AA',
	secretKey: '1x0000000000000000000000000000000AA',
};

/**
 * Resolve the Turnstile keys. Production needs both (the auth forms would stand unprotected otherwise);
 * elsewhere an absent pair falls back on the test keys. Half a pair is always a misconfiguration.
 * @returns The configured keys, or the test pair outside production.
 * @throws Error when only one key is set, or when production lacks them.
 */
export function turnstileKeys(): TurnstileKeys {
	const { TURNSTILE_SITE_KEY: siteKey, TURNSTILE_SECRET_KEY: secretKey } = env();
	if (siteKey !== undefined && secretKey !== undefined) return { siteKey, secretKey };
	if (siteKey === undefined && secretKey === undefined && (!isProduction() || isPrerendering())) {
		return TURNSTILE_TEST_KEYS;
	}
	throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be set (required in production).');
}

/**
 * Siteverify endpoint the captcha plugin calls: Cloudflare's own, unless the e2e suite points it at its
 * stand-in to simulate an outage or a rejected token.
 * @returns The override URL, or `undefined` for Cloudflare's endpoint.
 * @throws Error when production sets `TURNSTILE_SITEVERIFY_URL`: tokens would be checked by another host.
 */
export function turnstileSiteVerifyUrl(): string | undefined {
	const url = env().TURNSTILE_SITEVERIFY_URL;
	if (url !== undefined && isProduction()) {
		throw new Error('TURNSTILE_SITEVERIFY_URL is an e2e seam: never set it in production.');
	}
	return url;
}
