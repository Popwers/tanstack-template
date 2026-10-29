import { TURNSTILE_TEST_KEYS } from '#/lib/server/turnstile';

import { E2E_SITEVERIFY_PORT } from './isolation';

/**
 * Stand-in for Cloudflare's Turnstile siteverify, so the suite can simulate what the test keys cannot:
 * an outage and a rejected token. Any other token passes with the test secret, as Cloudflare's own
 * siteverify does. `serve.sh` starts it before the app and kills it on exit.
 */

/** A token siteverify rejects (`success: false`): the server must answer 403. */
export const REJECTED_TOKEN = 'e2e-rejected-token';

/** A token whose check finds siteverify down (503 from Cloudflare): the server must answer 503. */
export const OUTAGE_TOKEN = 'e2e-siteverify-outage';

/** The request body Better Auth sends. */
interface SiteverifyRequest {
	secret?: string;
	response?: string;
}

/**
 * Answer one siteverify call.
 * @param request - The captcha plugin's request.
 * @returns Cloudflare's response for that token.
 */
async function siteverify(request: Request): Promise<Response> {
	const { secret, response: token }: SiteverifyRequest = await request.json();
	if (token === OUTAGE_TOKEN) return new Response('upstream unavailable', { status: 503 });
	if (token === REJECTED_TOKEN || secret !== TURNSTILE_TEST_KEYS.secretKey) {
		return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
	}
	return Response.json({ success: true, 'error-codes': [], hostname: 'localhost' });
}

if (import.meta.main) {
	Bun.serve({ hostname: '127.0.0.1', port: E2E_SITEVERIFY_PORT, fetch: siteverify });
	console.info(`[siteverify] listening on 127.0.0.1:${E2E_SITEVERIFY_PORT}`);
}
