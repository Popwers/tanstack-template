import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vite-plus/test';

import {
	RELOAD_COOLDOWN_MS,
	RELOAD_PARAM,
	RELOAD_STORAGE_KEY,
	type PageReloadState,
} from '#/lib/chunk-reload';
import { ENTRY_RECOVERY_SCRIPT } from '#/lib/entry-recovery';

/** A failed element as the capture listener sees it. */
interface FailedNode {
	tagName: string;
	src?: string;
	href?: string;
}

type Listener = (event: { target: FailedNode }) => void;

/** The page the inline script runs in: its address, clock, session storage and the shared reload state. */
interface FakePage {
	location: { href: string; origin: string; replace: (url: string) => void };
	sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
	__chunkReload?: PageReloadState;
}

const NOW = 1_800_000_000_000;

/**
 * Runs the script in a fake page at `href`.
 * @param storedAt - When an earlier reload of this tab happened, as the session storage holds it.
 * @param storage - A storage that replaces the in-memory one (a blocked one, in private mode).
 * @param resources - The resource timings the browser holds when the script runs.
 */
function load(
	href: string,
	storedAt?: number,
	storage?: FakePage['sessionStorage'],
	resources: { name: string; responseStatus: number }[] = [],
) {
	const store = new Map<string, string>();
	if (storedAt !== undefined) store.set(RELOAD_STORAGE_KEY, String(storedAt));
	const replaced: string[] = [];
	const listeners: Listener[] = [];
	const page: FakePage = {
		location: { href, origin: new URL(href).origin, replace: (url) => void replaced.push(url) },
		sessionStorage: storage ?? {
			getItem: (key) => store.get(key) ?? null,
			setItem: (key, value) => void store.set(key, value),
		},
	};
	const context = {
		...page,
		window: page,
		URL,
		Date: { now: () => NOW },
		performance: { getEntriesByType: (type: string) => (type === 'resource' ? resources : []) },
		addEventListener: (type: string, listener: Listener, capture: boolean) => {
			if (type === 'error' && capture) listeners.push(listener);
		},
	};
	context.window = context;
	runInNewContext(ENTRY_RECOVERY_SCRIPT, context);
	return {
		replaced,
		store,
		state: () => context.__chunkReload,
		startBundle: () => {
			Object.assign(context.__chunkReload ?? {}, { isBundleRunning: true });
		},
		fail: (node: FailedNode) => {
			for (const listener of listeners) listener({ target: node });
		},
	};
}

const entry = { tagName: 'SCRIPT', src: 'https://example.com/assets/index-B8ITjU2L.js' };

/**
 * Failure modes: a page whose entry script is gone stays inert because no bundled code runs to recover;
 * the reload gets the same edge copy back (no fresh query); the reload loops when the file is really gone;
 * the script and the bundle each reload once (two mechanisms racing, or a marker of their own each);
 * the script reloads a hydrated page for a failed hover preload and takes a half-typed form with it;
 * an image, a file outside `/assets/` or another origin's script reloads the page.
 */
describe('ENTRY_RECOVERY_SCRIPT', () => {
	it('reloads once, with the bundle’s query, when the entry script fails, keeping the page query', () => {
		const page = load('https://example.com/sorties?type=stage#liste');

		page.fail(entry);
		page.fail({ tagName: 'LINK', href: 'https://example.com/assets/vendor-react-D9dFF5lv.js' });

		expect(page.replaced).toHaveLength(1);
		const next = new URL(page.replaced[0] ?? '');
		expect(next.pathname + next.search + next.hash).toBe(
			`/sorties?type=stage&${RELOAD_PARAM}=${NOW}#liste`,
		);
	});

	it('writes the same marker the bundle reads, and records the start of the shared reloading window', () => {
		const page = load('https://example.com/');
		page.fail({ tagName: 'LINK', href: 'https://example.com/assets/styles-nFFx7RBD.css' });
		expect(page.store.get(RELOAD_STORAGE_KEY)).toBe(String(NOW));
		expect(page.state()?.startedAt).toBe(NOW);
	});

	it('does not reload when the bundle or the script already did within the cooldown: no loop', () => {
		const recent = load('https://example.com/', NOW - RELOAD_COOLDOWN_MS + 1);
		recent.fail(entry);
		expect(recent.replaced).toEqual([]);

		const later = load('https://example.com/', NOW - RELOAD_COOLDOWN_MS);
		later.fail(entry);
		expect(later.replaced).toHaveLength(1);
	});

	it('reloads for an /assets/ file that already failed before the script ran, and only for that', () => {
		const failedEarly = load('https://example.com/', undefined, undefined, [
			{ name: 'https://example.com/assets/logo-a1.svg', responseStatus: 200 },
			{ name: 'https://example.com/assets/vendor-react-D9dFF5lv.js', responseStatus: 404 },
		]);
		expect(failedEarly.replaced).toHaveLength(1);

		const fine = load('https://example.com/', undefined, undefined, [
			{ name: 'https://example.com/api/health', responseStatus: 500 },
			{ name: 'https://example.com/assets/index-B8ITjU2L.js', responseStatus: 200 },
			{ name: 'https://example.com/assets/index-B8ITjU2L.js', responseStatus: 0 },
		]);
		expect(fine.replaced).toEqual([]);
	});

	it('leaves every failure to the bundle once it runs', () => {
		const page = load('https://example.com/');
		page.startBundle();
		page.fail({ tagName: 'LINK', href: 'https://example.com/assets/sign-up-DqF3NEde.js' });
		expect(page.replaced).toEqual([]);
	});

	it('ignores images, files outside /assets/ and other origins', () => {
		const page = load('https://example.com/');
		page.fail({ tagName: 'IMG', src: 'https://example.com/assets/logo.png' });
		page.fail({ tagName: 'SCRIPT', src: 'https://example.com/op1.js' });
		page.fail({ tagName: 'SCRIPT', src: 'https://challenges.cloudflare.com/assets/api.js' });
		page.fail({ tagName: 'SCRIPT' });
		expect(page.replaced).toEqual([]);
	});

	it('does not reload, and does not throw, when the session storage is blocked', () => {
		const blocked = () => {
			throw new Error('SecurityError');
		};
		const page = load('https://example.com/', undefined, { getItem: blocked, setItem: blocked });
		expect(() => page.fail(entry)).not.toThrow();
		expect(page.replaced).toEqual([]);
	});
});
