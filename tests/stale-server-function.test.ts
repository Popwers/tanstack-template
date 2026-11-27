import type { AnyFunctionMiddleware } from '@tanstack/react-start';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { isMissingServerFunction } from '#/lib/middleware/stale-server-function';

/**
 * Failure modes: any server-function error is turned into a 404 (a real failure hidden), the message Start
 * throws is no longer matched after a Start upgrade (the stale tab ends on an error screen and in Sentry
 * again). Whether the request is a server function is Start's own `handlerType`, not a path test here.
 */
describe('isMissingServerFunction', () => {
	it('matches the error Start throws for an unknown id', () => {
		expect(
			isMissingServerFunction(new Error('Server function info not found for eyJmaWxlIjoiL3NyYy9saWIv')),
		).toBe(true);
	});

	it('ignores another failure of a server function', () => {
		expect(isMissingServerFunction(new Error('relation "users" does not exist'))).toBe(false);
		expect(isMissingServerFunction(new Error('Server function module not resolved for abc'))).toBe(false);
	});
});

interface ClientCall {
	method: 'GET' | 'POST';
	next: () => Promise<string>;
}

type ClientHandle = (call: ClientCall) => Promise<string>;

function clientHandleOf(middleware: AnyFunctionMiddleware): ClientHandle {
	const { client } = middleware.options;
	if (client === undefined) throw new Error('the middleware has no client callback');
	// SAFETY: `client` is the callback registered by `reloadOnMissingServerFunction`; it reads only `method` and `next`.
	return client as never;
}

async function freshClient(isNavigating = false) {
	vi.resetModules();
	const chunk = await import('#/lib/chunk-reload');
	const { reloadOnMissingServerFunction } = await import('#/lib/middleware/stale-server-function');
	const state = { isNavigating };
	chunk.installChunkReload(() => state.isNavigating);
	return { chunk, state, handle: clientHandleOf(reloadOnMissingServerFunction) };
}

function stubWindow() {
	const replace = vi.fn<(url: string) => void>();
	const store = new Map<string, string>();
	vi.stubGlobal(
		'window',
		Object.assign(new EventTarget(), {
			location: { href: 'https://example.com/form', origin: 'https://example.com', replace },
			history: { state: null, replaceState: () => undefined },
			sessionStorage: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => void store.set(key, value),
			},
		}),
	);
	return { replace, store };
}

const missing = () => Promise.reject(new Error('Server function info not found'));

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * Failure modes of the browser side: a save reloads the page and the typed text is gone with no word; a
 * read does not reload; the notice is shown twice or not at all; a stale save after a reload already
 * happened reloads again; an error that is not a stale build is swallowed or rewritten.
 */
describe('reloadOnMissingServerFunction', () => {
	it('reloads a stale read made during a navigation once, and keeps the call pending', async () => {
		const { replace } = stubWindow();
		const { handle } = await freshClient(true);

		const outcome = await Promise.race([
			handle({ method: 'GET', next: missing }),
			new Promise<string>((resolve) => queueMicrotask(() => resolve('pending'))),
		]);

		expect(outcome).toBe('pending');
		expect(replace).toHaveBeenCalledTimes(1);
	});

	it('does not reload a stale read made outside a navigation: it rejects and shows the read notice once', async () => {
		const { replace } = stubWindow();
		const { chunk, handle } = await freshClient(false);
		const show = vi.fn<(message: string, reload: () => void) => void>();
		chunk.setStaleBuildNotifier(show);

		await expect(handle({ method: 'GET', next: missing })).rejects.toBeInstanceOf(chunk.StaleBuildError);

		expect(replace).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledTimes(1);
		expect(show.mock.calls[0]?.[0]).toBe(chunk.STALE_BUILD_READ_MESSAGE);
	});

	it('shows one notice for ten parallel stale reads', async () => {
		stubWindow();
		const { chunk, handle } = await freshClient(false);
		const show = vi.fn<(message: string, reload: () => void) => void>();
		chunk.setStaleBuildNotifier(show);

		const calls = Array.from({ length: 10 }, () => handle({ method: 'GET', next: missing }));
		const outcomes = await Promise.allSettled(calls);

		expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
		expect(show).toHaveBeenCalledTimes(1);
	});

	it('does not reload a stale save: it rejects with StaleBuildError and shows the notice once', async () => {
		const { replace } = stubWindow();
		const { chunk, handle } = await freshClient();
		const show = vi.fn<(message: string, reload: () => void) => void>();
		chunk.setStaleBuildNotifier(show);

		await expect(handle({ method: 'POST', next: missing })).rejects.toBeInstanceOf(chunk.StaleBuildError);
		await expect(handle({ method: 'POST', next: missing })).rejects.toBeInstanceOf(chunk.StaleBuildError);

		expect(replace).not.toHaveBeenCalled();
		expect(show).toHaveBeenCalledTimes(1);
		expect(show.mock.calls[0]?.[0]).toContain('Rechargez la page');
	});

	it('treats a stale save the same after a reload already happened', async () => {
		const { replace, store } = stubWindow();
		const { chunk, handle } = await freshClient();
		store.set(chunk.RELOAD_STORAGE_KEY, String(Date.now()));
		chunk.setStaleBuildNotifier(() => undefined);

		await expect(handle({ method: 'POST', next: missing })).rejects.toBeInstanceOf(chunk.StaleBuildError);
		expect(replace).not.toHaveBeenCalled();
	});

	it('hands a stale read made during a navigation to the caller when its reload is refused', async () => {
		const { replace, store } = stubWindow();
		const { chunk, handle } = await freshClient(true);
		store.set(chunk.RELOAD_STORAGE_KEY, String(Date.now()));

		await expect(handle({ method: 'GET', next: missing })).rejects.toThrow(
			'Server function info not found',
		);
		expect(replace).not.toHaveBeenCalled();
	});

	it('leaves any other error and any success untouched', async () => {
		stubWindow();
		const { chunk, handle } = await freshClient();
		const show = vi.fn<(message: string, reload: () => void) => void>();
		chunk.setStaleBuildNotifier(show);
		const failure = new Error('Une erreur est survenue.');

		await expect(handle({ method: 'POST', next: () => Promise.reject(failure) })).rejects.toBe(failure);
		await expect(handle({ method: 'POST', next: async () => 'saved' })).resolves.toBe('saved');
		expect(show).not.toHaveBeenCalled();
	});
});
