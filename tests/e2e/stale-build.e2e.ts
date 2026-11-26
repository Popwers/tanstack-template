import http from 'node:http';

import { type Browser, test } from '@e2e-dev/web';
/**
 * A visitor holds a page from before a deployment: a hashed file it names is gone, or the server function
 * it calls no longer exists. How that can end badly, and the step that catches it:
 *
 * - the page never opens and the error screen stays up, because nothing reloads it;
 * - the page reloads to the same address, so a cache that kept the old HTML serves it again;
 * - the reload repeats forever when the file is really gone;
 * - the server answers a stale function id with an error the log and Sentry report as a server fault.
 */
import { expect } from 'e2e';

import { E2E_BASE_URL } from './isolation';

const signInChunk = /\/assets\/sign-in-[\w-]+\.js$/;
const serverFunctions = /\/_serverFn\//;
const reloadedAddress = /[?&]_r=\d+/;
const missingFunction = 'Server function info not found';

/**
 * Forgets the reloads an earlier test or run left in the tab's session storage (the app's own and the
 * router's), which would make the next failure look like a repeat.
 */
async function forgetEarlierReloads(browser: Browser): Promise<void> {
	await browser.evaluate(() => {
		const earlier = Object.keys(sessionStorage).filter(
			(key) => key === 'chunk-reload-at' || key.startsWith('tanstack_router_reload:'),
		);
		for (const key of earlier) {
			sessionStorage.removeItem(key);
		}
		return earlier.length;
	});
}

/** Waits until React has hydrated the page: a click before it follows the link as a plain navigation. */
async function waitUntilHydrated(browser: Browser): Promise<void> {
	await expect
		.poll(() =>
			browser.evaluate(() =>
				Object.keys(document.querySelector('main a') ?? {}).some((key) =>
					key.startsWith('__reactProps'),
				),
			),
		)
		.toBe(true);
}

test('a file that fails to load reloads the page once, to an address the edge has no copy of', async ({
	app,
	screen,
	browser,
}) => {
	const reloads: string[] = [];
	await browser.route(reloadedAddress, async (route) => {
		reloads.push(route.request.url);
		await route.fallback();
	});
	await browser.route(signInChunk, async (route) => {
		if (reloads.length === 0) {
			await route.abort();
			return;
		}
		await route.fallback();
	});
	await app.open('/');
	await waitUntilHydrated(browser);
	await forgetEarlierReloads(browser);

	await screen.getByRole('link', 'Se connecter').tap();

	await expect.poll(() => reloads.length).toBe(1);
	await expect(browser).toHaveURL(/\/sign-in$/);
	await expect(screen.getByRole('textbox', 'E-mail')).toBeVisible();
	await expect(screen.getByText('Une erreur est survenue')).toHaveCount(0);
	expect(reloads).toHaveLength(1);
});

test('a file still missing after a reload is not reloaded again: the error screen stays', async ({
	app,
	screen,
	browser,
}) => {
	const reloads: string[] = [];
	await browser.route(reloadedAddress, async (route) => {
		reloads.push(route.request.url);
		await route.fallback();
	});
	await browser.route(signInChunk, async (route) => {
		await route.abort();
	});
	await app.open('/');
	await forgetEarlierReloads(browser);
	const reloadedAt = await browser.evaluate(() => {
		const now = String(Date.now());
		sessionStorage.setItem('chunk-reload-at', now);
		return now;
	});

	await app.open('/sign-in');
	await expect(screen.getByRole('heading', 'Une erreur est survenue')).toBeVisible();

	const secondFailure = await browser.evaluate(() => {
		const failure = new Event('vite:preloadError', { cancelable: true });
		window.dispatchEvent(failure);
		return {
			isLeftToTheRouter: !failure.defaultPrevented,
			reloadedAt: sessionStorage.getItem('chunk-reload-at'),
			address: window.location.pathname + window.location.search,
		};
	});
	expect(secondFailure).toEqual({ isLeftToTheRouter: true, reloadedAt, address: '/sign-in' });
	expect(reloads).toHaveLength(0);
});

test('a call to a server function the new build removed reloads the page once instead of failing', async ({
	app,
	browser,
}) => {
	const reloads: string[] = [];
	await browser.route(reloadedAddress, async (route) => {
		reloads.push(route.request.url);
		await route.fallback();
	});
	await browser.route(serverFunctions, async (route) => {
		if (reloads.length === 0) {
			await route.fulfill({
				status: 404,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
				body: missingFunction,
			});
			return;
		}
		await route.fallback();
	});
	await app.open('/');
	await waitUntilHydrated(browser);
	await forgetEarlierReloads(browser);

	await browser.evaluate(() => {
		void window.__TSR_ROUTER__?.navigate({ to: '/dashboard' });
		return true;
	});

	await expect.poll(() => reloads.length).toBe(1);
	await expect(browser).toHaveURL(/\/sign-in$/);
	expect(reloads).toHaveLength(1);
});

test('the server answers a function id it does not have with a short 404, never a server fault', async ({
	app,
	browser,
}) => {
	await app.open('/');
	const answer = await browser.evaluate(async () => {
		const response = await fetch('/_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk', {
			headers: { 'x-tsr-serverfn': 'true' },
		});
		return {
			status: response.status,
			body: await response.text(),
			cache: response.headers.get('cache-control'),
		};
	});
	expect(answer).toEqual({ status: 404, body: missingFunction, cache: 'private, no-store' });
});

/**
 * Posts to a server function and returns the status the server answers on the headers alone, as it does
 * for a body it refuses unread. The body is never sent: a client writing megabytes into a connection the
 * server closes gets EPIPE instead of the status.
 */
function statusOfPost(headers: Record<string, string>, body?: string): Promise<number> {
	const url = new URL('/_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk', E2E_BASE_URL);
	return new Promise((resolve, reject) => {
		const request = http.request(url, { method: 'POST', headers }, (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
			request.destroy();
		});
		request.on('error', reject);
		if (body !== undefined) {
			request.end(body);
		}
	});
}

test('a server function body with no declared length is refused 411 and an oversized one 413', async () => {
	const base = { 'x-tsr-serverfn': 'true', 'content-type': 'application/json' };
	const noLength = await statusOfPost({ ...base, 'transfer-encoding': 'chunked' }, '{}');
	const tooLarge = await statusOfPost({ ...base, 'content-length': String(2 * 1024 * 1024 + 1) });
	const garbled = await statusOfPost({ ...base, 'content-length': 'abc' });

	expect({ noLength, tooLarge, garbled }).toEqual({ noLength: 411, tooLarge: 413, garbled: 411 });
});
