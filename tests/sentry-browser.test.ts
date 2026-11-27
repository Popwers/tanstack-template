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
	vi.useRealTimers();
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

	it('reports again once the reloading window ended without the page leaving', async () => {
		vi.useFakeTimers();
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
		chunk.reloadNow();

		vi.advanceTimersByTime(chunk.RELOADING_WINDOW_MS);

		expect(sentry.beforeSendBrowser(event)).toEqual(event);
	});

	it('never reports a StaleBuildError, even after the window ended: the notice already told the visitor', async () => {
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/',
				origin: 'https://example.com',
				replace: () => undefined,
			},
			sessionStorage: { getItem: () => null, setItem: () => undefined },
		});
		const { chunk, sentry } = await freshBrowser();
		const stale = new chunk.StaleBuildError('read');
		const event = { exception: { values: [{ type: stale.name, value: stale.message }] } };

		expect(sentry.beforeSendBrowser(event)).toBeNull();
		expect(sentry.beforeSendBrowser({ exception: { values: [{ type: 'TypeError' }] } })).not.toBeNull();
	});
});
