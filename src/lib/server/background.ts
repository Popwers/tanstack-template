declare global {
	/**
	 * Work started after a response and not finished yet. On `globalThis`: the app's server bundle
	 * starts tasks and the Nitro bundle drains them, and each bundle has its own copy of this module.
	 */
	var backgroundTasks: Set<Promise<void>> | undefined;
}

const pending = (globalThis.backgroundTasks ??= new Set());

/**
 * Run work after the response without awaiting it, tracked so a shutdown waits for it
 * ({@link drainBackgroundTasks}). A failure is logged, never thrown at the caller.
 * @param label - Logged with a failure.
 * @param task - The work, already started.
 */
export function runInBackground(label: string, task: Promise<unknown>): void {
	const tracked: Promise<void> = task
		.then(
			() => undefined,
			(error: Error) => console.error(`[${label}] background task failed:`, error),
		)
		.finally(() => pending.delete(tracked));
	pending.add(tracked);
}

/** @returns Once every background task has settled, including the ones started while waiting. */
export async function drainBackgroundTasks(): Promise<void> {
	while (pending.size > 0) await Promise.all(pending);
}
