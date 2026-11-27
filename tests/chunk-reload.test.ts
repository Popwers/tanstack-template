import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
	isChunkLoadMessage,
	isMissingServerFunctionMessage,
	isStaleBuildError,
	RELOAD_COOLDOWN_MS,
	RELOAD_PARAM,
	RELOAD_STORAGE_KEY,
	type ReloadEnvironment,
	reloadOnce,
	withoutReloadParam,
} from '#/lib/chunk-reload';

/** A browser stand-in with an in-memory session storage; `replace` records the address it was sent to. */
function fakeBrowser(href: string, storedAt?: number) {
	const store = new Map<string, string>();
	if (storedAt !== undefined) {
		store.set(RELOAD_STORAGE_KEY, String(storedAt));
	}
	let clock = 1_800_000_000_000;
	const replace = vi.fn<(url: string) => void>();
	const environment: ReloadEnvironment = {
		href,
		now: () => clock,
		storage: {
			getItem: (key) => store.get(key) ?? null,
			setItem: (key, value) => void store.set(key, value),
		},
		replace,
	};
	return {
		environment,
		replace,
		store,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

/**
 * Failure modes: the reload loops when the chunk is really gone, the query the edge has no copy of is
 * missing or clobbers the page's own query, storage that throws (private mode) leaves a loop or a crash,
 * an unrelated error reloads the page.
 */
describe('reloadOnce', () => {
	it('reloads once with a query of its own, keeping the page query', () => {
		const browser = fakeBrowser('https://example.com/dashboard?tab=a');
		expect(reloadOnce(browser.environment)).toBe(true);
		const target = new URL(browser.replace.mock.calls[0]?.[0] ?? '');
		expect(target.pathname).toBe('/dashboard');
		expect(target.searchParams.get('tab')).toBe('a');
		expect(target.searchParams.get(RELOAD_PARAM)).toBe('1800000000000');
	});

	it('does not reload again while the first reload may still be the answer', () => {
		const browser = fakeBrowser('https://example.com/');
		expect(reloadOnce(browser.environment)).toBe(true);
		browser.advance(5_000);
		expect(reloadOnce(browser.environment)).toBe(false);
		browser.advance(RELOAD_COOLDOWN_MS - 5_001);
		expect(reloadOnce(browser.environment)).toBe(false);
		expect(browser.replace).toHaveBeenCalledTimes(1);
	});

	it('reloads again for a later deployment, past the cooldown', () => {
		const browser = fakeBrowser('https://example.com/');
		reloadOnce(browser.environment);
		browser.advance(RELOAD_COOLDOWN_MS);
		expect(reloadOnce(browser.environment)).toBe(true);
		expect(browser.replace).toHaveBeenCalledTimes(2);
	});

	it('does not reload when the session storage cannot be used', () => {
		const browser = fakeBrowser('https://example.com/');
		const blocked = vi.fn(() => {
			throw new Error('SecurityError');
		});
		const environment = { ...browser.environment, storage: { getItem: blocked, setItem: blocked } };
		expect(reloadOnce(environment)).toBe(false);
		expect(browser.replace).not.toHaveBeenCalled();
	});

	it('does not reload when the reload cannot be remembered', () => {
		const browser = fakeBrowser('https://example.com/');
		const full = vi.fn(() => {
			throw new Error('QuotaExceededError');
		});
		const environment = { ...browser.environment, storage: { getItem: () => null, setItem: full } };
		expect(reloadOnce(environment)).toBe(false);
		expect(browser.replace).not.toHaveBeenCalled();
	});

	it('treats a corrupt stored value as no earlier reload', () => {
		const browser = fakeBrowser('https://example.com/');
		browser.store.set(RELOAD_STORAGE_KEY, 'not a number');
		expect(reloadOnce(browser.environment)).toBe(true);
	});
});

describe('message matching', () => {
	it.each([
		'Failed to fetch dynamically imported module: https://example.com/assets/dashboard-DfK3.js',
		'error loading dynamically imported module',
		'Importing a module script failed.',
		'Unable to preload CSS for /assets/index-abc.css',
	])('recognises the failed file %s', (message) => {
		expect(isChunkLoadMessage(message)).toBe(true);
		expect(isStaleBuildError(new Error(message))).toBe(true);
	});

	it('recognises the missing server function the server answers', () => {
		expect(isMissingServerFunctionMessage('Server function info not found')).toBe(true);
		expect(isStaleBuildError(new Error('Server function info not found'))).toBe(true);
	});

	it.each(['Failed query: select 1', 'Network request failed', 'Server function failed', ''])(
		'ignores %j',
		(message) => {
			expect(isStaleBuildError(new Error(message))).toBe(false);
		},
	);
});

describe('withoutReloadParam', () => {
	it('drops only the reload query', () => {
		expect(withoutReloadParam('https://example.com/a?x=1&_r=1&y=2')).toBe(
			'https://example.com/a?x=1&y=2',
		);
		expect(withoutReloadParam('https://example.com/?_r=1')).toBe('https://example.com/');
	});

	it('leaves an address without it alone', () => {
		expect(withoutReloadParam('https://example.com/a?x=1')).toBeNull();
	});
});

interface FakeWindow extends EventTarget {
	location: { href: string; origin: string; replace: (url: string) => void };
	history: { state: null; replaceState: (state: null, title: string, url: string) => void };
	sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
	__TSR_ROUTER__?: { latestLocation: { href: string } };
}

/** A window for `installChunkReload`: the events it listens to, the address, the history and storage. */
function stubWindow(href: string, storage?: FakeWindow['sessionStorage']) {
	const store = new Map<string, string>();
	const replace = vi.fn<(url: string) => void>();
	const replaceState = vi.fn<(state: null, title: string, url: string) => void>();
	const fake: FakeWindow = Object.assign(new EventTarget(), {
		location: { href, origin: new URL(href).origin, replace },
		history: { state: null, replaceState },
		sessionStorage: storage ?? {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		},
	});
	vi.stubGlobal('window', fake);
	return { fake, replace, replaceState };
}

async function freshModule() {
	vi.resetModules();
	return import('#/lib/chunk-reload');
}

const navigating = () => true;
const idle = () => false;

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * Failure modes of the browser wiring: a failed hover preload reloads the page and takes a half-typed
 * form with it; a failed file during a navigation does not reload; the reload repeats on the second
 * failure; the router's own default (an error screen) is cancelled when no reload happens or kept when
 * the reload was refused; the reload goes to the page being left; the query stays in the address bar.
 */
describe('installChunkReload', () => {
	it('reloads once on a failed hashed file during a navigation and cancels the error screen', async () => {
		const { fake, replace } = stubWindow('https://example.com/dashboard');
		const { installChunkReload } = await freshModule();
		installChunkReload(navigating);

		const first = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(first);
		const second = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(second);

		expect(replace).toHaveBeenCalledTimes(1);
		expect(new URL(replace.mock.calls[0]?.[0] ?? '').searchParams.has(RELOAD_PARAM)).toBe(true);
		expect(first.defaultPrevented).toBe(true);
		expect(second.defaultPrevented).toBe(true);
	});

	it('does nothing for a failed preload while no navigation is in flight', async () => {
		const { fake, replace } = stubWindow('https://example.com/dashboard');
		const { installChunkReload } = await freshModule();
		installChunkReload(idle);

		const failure = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(failure);
		fake.dispatchEvent(
			Object.assign(new Event('unhandledrejection'), {
				reason: new Error('Failed to fetch dynamically imported module: /assets/a.js'),
			}),
		);

		expect(replace).not.toHaveBeenCalled();
		expect(failure.defaultPrevented).toBe(false);
	});

	it('reloads once, onto the clicked page, when the click follows a failed hover preload', async () => {
		const { fake, replace } = stubWindow('https://example.com/');
		const { installChunkReload } = await freshModule();
		let isNavigating = false;
		installChunkReload(() => isNavigating);

		const hover = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(hover);
		expect(replace).not.toHaveBeenCalled();

		isNavigating = true;
		fake.__TSR_ROUTER__ = { latestLocation: { href: '/clients?tab=a' } };
		const click = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(click);

		expect(replace).toHaveBeenCalledTimes(1);
		const target = new URL(replace.mock.calls[0]?.[0] ?? '');
		expect(target.pathname + target.searchParams.get('tab')).toBe('/clientsa');
		expect(target.searchParams.has(RELOAD_PARAM)).toBe(true);
		expect(click.defaultPrevented).toBe(true);
	});

	it('leaves the error to the router when a reload already failed to help', async () => {
		const { fake, replace } = stubWindow('https://example.com/dashboard');
		const { RELOAD_STORAGE_KEY: key, installChunkReload } = await freshModule();
		fake.sessionStorage.setItem(key, String(Date.now()));
		installChunkReload(navigating);

		const failure = new Event('vite:preloadError', { cancelable: true });
		fake.dispatchEvent(failure);

		expect(replace).not.toHaveBeenCalled();
		expect(failure.defaultPrevented).toBe(false);
	});

	it('does not loop and does not crash when the session storage is blocked', async () => {
		const blocked = () => {
			throw new Error('SecurityError');
		};
		const { fake, replace } = stubWindow('https://example.com/', { getItem: blocked, setItem: blocked });
		const { installChunkReload } = await freshModule();
		installChunkReload(navigating);

		const failure = new Event('vite:preloadError', { cancelable: true });
		expect(() => fake.dispatchEvent(failure)).not.toThrow();
		expect(replace).not.toHaveBeenCalled();
		expect(failure.defaultPrevented).toBe(false);
	});

	it('reloads on a dynamic import that rejected during a navigation, not on another rejection', async () => {
		const { fake, replace } = stubWindow('https://example.com/');
		const { installChunkReload } = await freshModule();
		installChunkReload(navigating);

		fake.dispatchEvent(
			Object.assign(new Event('unhandledrejection'), { reason: new Error('Failed query') }),
		);
		fake.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'a string' }));
		expect(replace).not.toHaveBeenCalled();

		fake.dispatchEvent(
			Object.assign(new Event('unhandledrejection'), {
				reason: new Error('Failed to fetch dynamically imported module: /assets/a.js'),
			}),
		);
		expect(replace).toHaveBeenCalledTimes(1);
	});

	it('removes the reload query from the address bar, keeping the rest', async () => {
		const { replaceState } = stubWindow('https://example.com/a?x=1&_r=1800000000000');
		const { installChunkReload } = await freshModule();
		installChunkReload(navigating);
		expect(replaceState).toHaveBeenCalledWith(null, '', 'https://example.com/a?x=1');
	});

	it('leaves an address without the query alone, and installs its listeners once', async () => {
		const { fake, replace, replaceState } = stubWindow('https://example.com/a?x=1');
		const { installChunkReload } = await freshModule();
		const remove = installChunkReload(navigating);
		expect(installChunkReload(navigating)).toBe(remove);
		expect(replaceState).not.toHaveBeenCalled();

		fake.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
		expect(replace).toHaveBeenCalledTimes(1);

		remove();
		fake.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
		expect(replace).toHaveBeenCalledTimes(1);
	});
});

describe('the stale-build notice', () => {
	it('is announced once, and its Recharger button reloads even within the cooldown', async () => {
		const { fake, replace } = stubWindow('https://example.com/form');
		const { announceStaleBuild, RELOAD_STORAGE_KEY: key, setStaleBuildNotifier } = await freshModule();
		fake.sessionStorage.setItem(key, String(Date.now()));
		const show = vi.fn<(message: string, reload: () => void) => void>();
		setStaleBuildNotifier(show);

		announceStaleBuild('save');
		announceStaleBuild('read');

		expect(show).toHaveBeenCalledTimes(1);
		show.mock.calls[0]?.[1]();
		expect(new URL(replace.mock.calls[0]?.[0] ?? '').searchParams.has(RELOAD_PARAM)).toBe(true);
	});

	it('does nothing, and does not throw, before the app registered a notifier', async () => {
		stubWindow('https://example.com/');
		const { announceStaleBuild } = await freshModule();
		expect(() => announceStaleBuild('save')).not.toThrow();
	});

	it('words a read without the sentence about the lost entry, and a save with it', async () => {
		const { STALE_BUILD_MESSAGE, STALE_BUILD_READ_MESSAGE, StaleBuildError } = await freshModule();
		expect(new StaleBuildError('read').message).toBe(STALE_BUILD_READ_MESSAGE);
		expect(new StaleBuildError('save').message).toBe(STALE_BUILD_MESSAGE);
		expect(STALE_BUILD_READ_MESSAGE).not.toContain('saisie');
		expect(STALE_BUILD_MESSAGE).toContain('saisie');
	});

	it('shows the notice once per page life, whatever the kinds and the number of failing calls', async () => {
		stubWindow('https://example.com/');
		const { announceStaleBuild, setStaleBuildNotifier } = await freshModule();
		const show = vi.fn<(message: string, reload: () => void) => void>();
		setStaleBuildNotifier(show);

		for (let call = 0; call < 10; call += 1) announceStaleBuild('read');
		announceStaleBuild('save');

		expect(show).toHaveBeenCalledTimes(1);
	});

	it('counts a StaleBuildError as coming from an older build, so a loader that hit it reloads', async () => {
		const { isStaleBuildError, StaleBuildError } = await freshModule();
		expect(isStaleBuildError(new StaleBuildError())).toBe(true);
	});
});

describe('isNavigationInFlight', () => {
	it('follows the predicate the router installed, and is false before and after', async () => {
		stubWindow('https://example.com/');
		const { installChunkReload, isNavigationInFlight } = await freshModule();
		expect(isNavigationInFlight()).toBe(false);
		let isNavigating = false;
		const remove = installChunkReload(() => isNavigating);
		expect(isNavigationInFlight()).toBe(false);
		isNavigating = true;
		expect(isNavigationInFlight()).toBe(true);
		remove();
		expect(isNavigationInFlight()).toBe(false);
	});
});
