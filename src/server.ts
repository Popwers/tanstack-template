import './instrument.server';
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';
import handler, { createServerEntry } from '@tanstack/react-start/server-entry';

import { cacheHeaders, SECURITY_HEADERS } from '#/lib/http-headers';

/** Set the security headers and the cache headers of `#/lib/http-headers` on one response. */
function applyPolicy(request: Request, response: Response): void {
	for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
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
 * @returns The response with headers set.
 */
function withPolicyHeaders(request: Request, response: Response): Response {
	const copy = new Response(response.body, response);
	applyPolicy(request, copy);
	return copy;
}

/** Server fetch entry. `instrument.server` is imported first: bun does not pass Node `--import`. */
export default createServerEntry(
	wrapFetchWithSentry({
		async fetch(request: Request) {
			return withPolicyHeaders(request, await handler.fetch(request));
		},
	}),
);
