import './instrument.server';
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';
import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

/** Headers every response carries. CSP is left to the product (Turnstile and OpenPanel need entries). */
const SECURITY_HEADERS: Array<[string, string]> = [
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	['X-Frame-Options', 'DENY'],
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/**
 * Copy a response with the security headers set.
 * @param response - Handler response.
 * @returns The response with headers added.
 */
function withSecurityHeaders(response: Response): Response {
	const secured = new Response(response.body, response);
	for (const [name, value] of SECURITY_HEADERS) secured.headers.set(name, value);
	return secured;
}

/** Server fetch entry. `instrument.server` is imported first: bun does not pass Node `--import`. */
export default createServerEntry(
	wrapFetchWithSentry({
		async fetch(request: Request) {
			return withSecurityHeaders(await handler.fetch(request));
		},
	}),
);
