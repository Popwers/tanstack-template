import type { AnyRequestMiddleware } from '@tanstack/react-start';
import { describe, expect, it } from 'vite-plus/test';

import { startInstance } from '#/start';

/**
 * Failure modes: a custom `src/start.ts` turns off Start's own CSRF check, so a cross-site call to a
 * server function runs with the visitor's cookie. The first request middleware must refuse a cross-site
 * call (`Sec-Fetch-Site`, or a foreign `Origin` without it) with 403, and let a same-origin one through.
 */

interface ServerContext {
	request: Request;
	handlerType: 'serverFn' | 'router';
	pathname: string;
	next: () => Promise<Response>;
}

type Handle = (context: ServerContext) => Promise<Response>;

function serverHandlerOf(middleware: AnyRequestMiddleware): Handle {
	const { server } = middleware.options;
	if (server === undefined) throw new Error('the middleware has no server callback');
	// SAFETY: `server` is the callback `createCsrfMiddleware` registered; it reads only these four fields.
	return server as never;
}

/** What Start passes a request middleware; `next` answers `ran`, so a pass-through is told from a refusal. */
function contextFor(request: Request, handlerType: 'serverFn' | 'router', pathname: string): ServerContext {
	return { request, handlerType, pathname, next: async () => new Response('ran') };
}

/** The status of a refusal (403) or of the call that went through to `next` (200). */
function statusOf(result: Response): number {
	return result.status;
}

async function callFirstMiddleware(headers: Record<string, string>): Promise<number> {
	const options = await startInstance.getOptions();
	const first = options.requestMiddleware?.[0];
	if (first === undefined) throw new Error('no request middleware');
	const request = new Request('https://app.example.com/_serverFn/abc', { method: 'POST', headers });
	const response = await serverHandlerOf(first)(contextFor(request, 'serverFn', '/_serverFn/abc'));
	return statusOf(response);
}

describe('the first request middleware of the start instance', () => {
	it('refuses a cross-site server function call with 403', async () => {
		expect(await callFirstMiddleware({ 'sec-fetch-site': 'cross-site' })).toBe(403);
		expect(await callFirstMiddleware({ origin: 'https://evil.example' })).toBe(403);
	});

	it('lets a same-origin call through', async () => {
		expect(await callFirstMiddleware({ 'sec-fetch-site': 'same-origin' })).toBe(200);
		expect(await callFirstMiddleware({ origin: 'https://app.example.com' })).toBe(200);
	});
});
