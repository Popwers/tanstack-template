import './instrument.server';
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';
import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

import { cacheHeaders, contentSecurityPolicy, SECURITY_HEADERS } from '#/lib/http-headers';
import { env } from '#/lib/server/env';

/** A fresh CSP nonce: 128 random bits, base64. */
function createNonce(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}

let connectOrigins: readonly string[] | null = null;

/** @returns The origins the browser posts to: OpenPanel when on, the browser Sentry DSN when set. */
function cspConnectOrigins(): readonly string[] {
	if (connectOrigins !== null) return connectOrigins;
	const { OPENPANEL_API_URL, OPENPANEL_CLIENT_ID } = env();
	const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
	connectOrigins = [
		...(OPENPANEL_CLIENT_ID === undefined ? [] : [new URL(OPENPANEL_API_URL).origin]),
		...(sentryDsn ? [new URL(sentryDsn).origin] : []),
	];
	return connectOrigins;
}

/** Set the security headers and the cache headers of `#/lib/http-headers` on one response. */
function applyPolicy(request: Request, response: Response, cspNonce: string): void {
	for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
	// Vite's dev server injects scripts without the nonce: the CSP applies to builds only.
	if (import.meta.env.PROD) {
		response.headers.set(
			'Content-Security-Policy',
			contentSecurityPolicy({ nonce: cspNonce, connectOrigins: cspConnectOrigins() }),
		);
	}
	const cache = cacheHeaders({
		pathname: new URL(request.url).pathname,
		method: request.method,
		status: response.status,
		contentType: response.headers.get('content-type'),
		cacheControl: response.headers.get('cache-control'),
		cookie: request.headers.get('cookie'),
		hasSetCookie: response.headers.has('set-cookie'),
	});
	if (cache === null) return;
	response.headers.set('Cache-Control', cache.cacheControl);
	if (cache.cdn === null) response.headers.delete('CDN-Cache-Control');
	else response.headers.set('CDN-Cache-Control', cache.cdn);
}

/**
 * Copy a response with its policy headers (a copy, since a redirect or a fetched body has immutable headers).
 * @param request - The request it answers.
 * @param response - Handler response.
 * @param cspNonce - The nonce the page's scripts were rendered with.
 * @returns The response with headers set.
 */
function withPolicyHeaders(request: Request, response: Response, cspNonce: string): Response {
	const copy = new Response(response.body, response);
	applyPolicy(request, copy, cspNonce);
	return copy;
}

/** Server fetch entry. `instrument.server` is imported first: bun does not pass Node `--import`. */
export default createServerEntry(
	wrapFetchWithSentry({
		async fetch(request: Request) {
			const cspNonce = createNonce();
			const response = await handler.fetch(request, { context: { cspNonce } });
			return withPolicyHeaders(request, response, cspNonce);
		},
	}),
);
