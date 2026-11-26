import { describe, expect, it, vi } from 'vite-plus/test';

import { drainBackgroundTasks, runInBackground } from '#/lib/server/background';

/**
 * Failure modes covered:
 * - shutdown stops waiting before a task (an auth e-mail) has finished, so the process exits mid-send;
 * - a failed task rejects the drain, so shutdown aborts and the other tasks are dropped;
 * - a task started while the drain is waiting (a request still in flight) is not waited for.
 */

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: Error) => void;
}

function deferred(): Deferred {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	return { promise, resolve: () => resolve(), reject };
}

/** @returns Whether `promise` has settled once every queued callback has run. */
async function isSettled(promise: Promise<void>): Promise<boolean> {
	let settled = false;
	const markSettled = () => {
		settled = true;
	};
	promise.then(markSettled, markSettled);
	await new Promise((resolve) => setTimeout(resolve, 10));
	return settled;
}

describe('background tasks', () => {
	it('the drain resolves only once every pending task has finished', async () => {
		const task = deferred();
		runInBackground('test', task.promise);

		const drained = drainBackgroundTasks();
		expect(await isSettled(drained)).toBe(false);

		task.resolve();
		await drained;
	});

	it('a failed task is logged and the drain still resolves', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const task = deferred();
		runInBackground('mail', task.promise);

		task.reject(new Error('transport down'));
		await expect(drainBackgroundTasks()).resolves.toBeUndefined();
		expect(log).toHaveBeenCalledWith('[mail] background task failed:', expect.any(Error));
	});

	it('a task started while draining is waited for too', async () => {
		const first = deferred();
		const second = deferred();
		runInBackground('test', first.promise);

		const drained = drainBackgroundTasks();
		runInBackground('test', second.promise);
		first.resolve();
		expect(await isSettled(drained)).toBe(false);

		second.resolve();
		await drained;
	});
});
