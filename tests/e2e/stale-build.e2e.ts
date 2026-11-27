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
const signUpChunk = /\/assets\/sign-up-[\w-]+\.js$/;
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

/**
 * Records in session storage (which survives the reload) whether the error screen was ever on the page:
 * a continuous observation, so the flash between the click and the new page cannot slip between two reads.
 */
async function watchForErrorScreen(browser: Browser): Promise<void> {
	await browser.evaluate(() => {
		sessionStorage.removeItem('error-screen-seen');
		new MutationObserver(() => {
			if (document.body.textContent?.includes('Une erreur est survenue') === true) {
				sessionStorage.setItem('error-screen-seen', '1');
			}
		}).observe(document.body, { childList: true, subtree: true, characterData: true });
		return true;
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

	await watchForErrorScreen(browser);

	await screen.getByRole('link', 'Se connecter').tap();

	await expect.poll(() => reloads.length).toBe(1);
	await expect(browser).toHaveURL(/\/sign-in$/);
	await expect(screen.getByRole('textbox', 'E-mail')).toBeVisible();
	await expect(screen.getByText('Une erreur est survenue')).toHaveCount(0);
	expect(reloads).toHaveLength(1);
	expect(await browser.evaluate(() => sessionStorage.getItem('error-screen-seen'))).toBeNull();
});

test('a failed hover preload does not reload the page: the typed text stays', async ({
	app,
	screen,
	browser,
}) => {
	const reloads: string[] = [];
	const chunkRequests: string[] = [];
	await browser.route(reloadedAddress, async (route) => {
		reloads.push(route.request.url);
		await route.fallback();
	});
	await browser.route(signUpChunk, async (route) => {
		chunkRequests.push(route.request.url);
		await route.abort();
	});
	await app.open('/sign-in');
	await waitUntilHydrated(browser);
	await forgetEarlierReloads(browser);
	await screen.getByRole('textbox', 'E-mail').fill('ada@example.test');

	await screen.getByRole('link', 'Créer un compte').hover();

	await expect.poll(() => chunkRequests.length).toBeGreaterThan(0);
	expect(reloads).toHaveLength(0);
	await expect(browser).toHaveURL(/\/sign-in$/);
	const typed = await browser.evaluate(
		() => document.querySelector<HTMLInputElement>('input[name=email]')?.value ?? null,
	);
	expect(typed).toBe('ada@example.test');
});

test('a stale read made by a hover preload keeps the typed text and shows the notice; the click then reloads once', async ({
	app,
	screen,
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
	await browser.setViewport({ width: 375, height: 667 });
	await app.open('/sign-in');
	await waitUntilHydrated(browser);
	await forgetEarlierReloads(browser);
	await screen.getByRole('textbox', 'E-mail').fill('ada@example.test');

	await screen.getByRole('link', 'Mon espace').hover();

	await expect(screen.getByText(/Rechargez la page pour continuer\./)).toBeVisible();
	await expect(screen.getByRole('button', 'Recharger')).toBeVisible();
	expect(reloads).toHaveLength(0);
	await expect(browser).toHaveURL(/\/sign-in$/);
	const typed = await browser.evaluate(
		() => document.querySelector<HTMLInputElement>('input[name=email]')?.value ?? null,
	);
	expect(typed).toBe('ada@example.test');
	const isSubmitReachable = await browser.evaluate(() => {
		const submit = document.querySelector<HTMLButtonElement>('form button[type=submit]');
		if (submit === null) return false;
		submit.scrollIntoView({ block: 'center' });
		const box = submit.getBoundingClientRect();
		return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === submit;
	});
	expect(isSubmitReachable, 'the form’s submit button under the notice, at 375 px').toBe(true);

	await screen.getByRole('button', 'Fermer').tap();
	await expect(screen.getByRole('button', 'Recharger')).toHaveCount(0);

	await screen.getByRole('link', 'Mon espace').tap();

	await expect.poll(() => reloads.length).toBe(1);
	expect(reloads[0]).toContain('/dashboard');
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
 * Posts to a server function path as written (Node's client does not normalise `path`) and returns the
 * status the server answers on the headers alone, as it does for a body it refuses unread. The body is
 * never sent: a client writing megabytes into a connection the server closes gets EPIPE instead of the
 * status. The headers are flushed by hand: Node holds them back until the first write otherwise.
 */
function statusOfPost(
	baseUrl: string,
	path: string,
	headers: Record<string, string>,
	body?: string,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = http.request(baseUrl, { method: 'POST', headers, path }, (response) => {
			response.resume();
			resolve(response.statusCode ?? 0);
			request.destroy();
		});
		request.on('error', reject);
		if (body === undefined) {
			request.flushHeaders();
		} else {
			request.end(body);
		}
	});
}

/** A same-origin browser call: without `Sec-Fetch-Site` the CSRF middleware, first in the chain, answers 403 before the size guard. */
const jsonCall = {
	'x-tsr-serverfn': 'true',
	'content-type': 'application/json',
	'sec-fetch-site': 'same-origin',
};
const oversized = { ...jsonCall, 'content-length': String(2 * 1024 * 1024 + 1) };

/** Forms of the path that the router may still resolve to a server function while the literal prefix is gone. */
const spelledPaths = [
	'/_serverFn%2FZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk',
	'//_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk',
	'/_SERVERFN/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk',
	'/x/../_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk',
	'/_serverFn/%5A%47%56%73%5A%58%52%6C%5A%47%45%74',
];

test('a server function body with no declared length is refused 411 and an oversized one 413', async () => {
	const path = '/_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk';
	const noLength = await statusOfPost(
		E2E_BASE_URL,
		path,
		{ ...jsonCall, 'transfer-encoding': 'chunked' },
		'{}',
	);
	const tooLarge = await statusOfPost(E2E_BASE_URL, path, oversized);

	expect({ noLength, tooLarge }).toEqual({ noLength: 411, tooLarge: 413 });
});

test('no spelling of the server function path skips the size limit: the answer comes before any body', async () => {
	for (const path of spelledPaths) {
		const status = await statusOfPost(E2E_BASE_URL, path, oversized);
		expect([413, 404, 308, 400], path).toContain(status);
	}
});

test('a server function call from another site is refused 403 before anything else', async () => {
	const path = '/_serverFn/ZGVsZXRlZC1pbi10aGUtbmV3LWJ1aWxk';
	const crossSite = { ...jsonCall, 'sec-fetch-site': 'cross-site' };
	const foreignOrigin = {
		'x-tsr-serverfn': 'true',
		origin: 'https://evil.example',
	};

	expect({
		crossSite: await statusOfPost(E2E_BASE_URL, path, crossSite, '{}'),
		foreignOrigin: await statusOfPost(E2E_BASE_URL, path, foreignOrigin, '{}'),
	}).toEqual({ crossSite: 403, foreignOrigin: 403 });
});
