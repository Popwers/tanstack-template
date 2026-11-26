import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createDeploymentPurge } from '#/lib/server/deployment-purge';

const DELAY = 120_000;

/**
 * Failure modes: a purge per request instead of per boot, the health check (no `cf-ray`) counting as
 * the traffic switch, the delayed purge firing after the server closed, a rejecting purge crashing the
 * boot or an unhandled rejection killing the process.
 */
describe('createDeploymentPurge', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('purges at boot, once after the first request through Cloudflare, once after the delay', () => {
		const purge = vi.fn<(reason: string) => Promise<void>>(async () => undefined);
		const plan = createDeploymentPurge({ purge, delayMs: DELAY });

		plan.start();
		expect(purge).toHaveBeenCalledTimes(1);

		plan.onRequest(new Headers());
		plan.onRequest(new Headers({ 'user-agent': 'curl/8 (Coolify health check)' }));
		expect(purge).toHaveBeenCalledTimes(1);

		plan.onRequest(new Headers({ 'cf-ray': 'a1b2c3-CDG' }));
		plan.onRequest(new Headers({ 'cf-ray': 'd4e5f6-MRS' }));
		plan.onRequest(new Headers({ 'cf-ray': 'g7h8i9-FRA' }));
		expect(purge).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(DELAY - 1);
		expect(purge).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1);
		expect(purge).toHaveBeenCalledTimes(3);
		vi.advanceTimersByTime(DELAY * 10);
		expect(purge.mock.calls.map(([reason]) => reason)).toEqual([
			'boot',
			'first request through Cloudflare',
			'120s after boot',
		]);
	});

	it('does not run the delayed purge once stopped', () => {
		const purge = vi.fn<(reason: string) => Promise<void>>(async () => undefined);
		const plan = createDeploymentPurge({ purge, delayMs: DELAY });
		plan.start();
		plan.stop();
		vi.advanceTimersByTime(DELAY * 2);
		expect(purge).toHaveBeenCalledTimes(1);
	});

	it('logs a purge that rejects and carries on', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const purge = vi.fn<(reason: string) => Promise<void>>().mockRejectedValue(new Error('offline'));
		const plan = createDeploymentPurge({ purge, delayMs: DELAY });

		expect(() => plan.start()).not.toThrow();
		plan.onRequest(new Headers({ 'cf-ray': 'x' }));
		await vi.advanceTimersByTimeAsync(DELAY);

		expect(purge).toHaveBeenCalledTimes(3);
		expect(logged).toHaveBeenCalledTimes(3);
	});
});
