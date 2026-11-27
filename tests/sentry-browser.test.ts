import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

/**
 * Failure modes: a normal deployment still reports a TypeError per stale tab (the page throws while the
 * reload loads), or the guard hides every event once and for all instead of only while reloading.
 */
async function freshBrowser() {
	vi.resetModules();
	const chunk = await import('#/lib/chunk-reload');
	const sentry = await import('#/lib/sentry-browser');
	return { chunk, sentry };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('beforeSendBrowser', () => {
	it('keeps an event while no reload is under way and drops it once one started', async () => {
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/',
				origin: 'https://example.com',
				replace: () => undefined,
			},
			sessionStorage: { getItem: () => null, setItem: () => undefined },
		});
		const { chunk, sentry } = await freshBrowser();
		const event = { message: 'a real error' };

		expect(sentry.beforeSendBrowser(event)).toEqual(event);
		chunk.reloadNow();
		expect(sentry.beforeSendBrowser(event)).toBeNull();
	});
});
