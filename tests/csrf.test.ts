import type { AnyRequestMiddleware } from '@tanstack/react-start';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { resetEnvCache } from '#/lib/server/env';
import { startInstance } from '#/start';

/**
 * Failure modes: a custom `src/start.ts` turns off Start's own CSRF check, so a cross-site call to a
 * server function runs with the visitor's cookie. The first request middleware must refuse a cross-site
 * call (`Sec-Fetch-Site`, or a foreign `Origin` without it) with 403, and let a same-origin one through.
 * Behind the proxy the server sees `http://` while the browser sends `https://`: a browser with no
 * `Sec-Fetch-Site` (Safari before 16.4) must compare against the public origin (`APP_URL`, `TRUSTED_ORIGINS`),
 * or every call from it is refused.
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
	const request = new Request('http://app.example.com/_serverFn/abc', { method: 'POST', headers });
	const response = await serverHandlerOf(first)(contextFor(request, 'serverFn', '/_serverFn/abc'));
	return statusOf(response);
}

beforeEach(() => {
	vi.stubEnv('DATABASE_URL', 'postgres://test@localhost/test');
	vi.stubEnv('APP_URL', 'https://app.example.com');
	vi.stubEnv('TRUSTED_ORIGINS', 'https://www.example.com');
	resetEnvCache();
});

afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('the first request middleware of the start instance', () => {
	it('refuses a cross-site server function call with 403', async () => {
		expect(await callFirstMiddleware({ 'sec-fetch-site': 'cross-site' })).toBe(403);
		expect(await callFirstMiddleware({ origin: 'https://evil.example' })).toBe(403);
		expect(await callFirstMiddleware({ referer: 'https://evil.example/page' })).toBe(403);
	});

	it('lets a modern same-origin call through', async () => {
		expect(await callFirstMiddleware({ 'sec-fetch-site': 'same-origin' })).toBe(200);
	});

	it('lets a browser without Sec-Fetch-Site through when its Origin is the public one, behind a http:// request', async () => {
		expect(await callFirstMiddleware({ origin: 'https://app.example.com' })).toBe(200);
		expect(await callFirstMiddleware({ origin: 'https://www.example.com' })).toBe(200);
		expect(await callFirstMiddleware({ referer: 'https://app.example.com/dashboard' })).toBe(200);
	});

	it('refuses a call with no Sec-Fetch-Site, no Origin and no Referer', async () => {
		expect(await callFirstMiddleware({})).toBe(403);
	});
});
