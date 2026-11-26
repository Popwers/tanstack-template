/**
 * Purge of the edge copies after a deployment. Cloudflare keeps a public page's HTML for minutes
 * (`CDN-Cache-Control`), and that HTML names the hashed files of the build that rendered it: once the
 * new container has replaced the old one, those files answer 404 and the page shows its error screen.
 * Three purges close it:
 *
 * - at boot, which drops what the previous build left;
 * - on the first request that came through Cloudflare, the proof that Coolify has moved the traffic
 *   to this container (its health check comes straight from the host, with no `cf-ray`): until then
 *   the old container could still answer and Cloudflare keep its HTML again right after the boot purge;
 * - once more after a delay, for a copy fetched from the old container while the switch was under way.
 *
 * Nothing waits on a purge: each runs in the background and a failed one is logged by the purge itself.
 */

/** What a deployment purge needs, injected so a test can drive it with a fake purge and clock. */
export interface DeploymentPurgeOptions {
	/** Drops the site's edge copies; must not throw (a throw is logged and dropped anyway). */
	purge: (reason: string) => Promise<void>;
	/** Wait before the last purge, long enough for the traffic switch to be over. */
	delayMs: number;
}

/** The handles of a running deployment purge. */
export interface DeploymentPurge {
	/** Purge now and arm the delayed purge. Call once, at boot. */
	start: () => void;
	/** Purge once, on the first request that carries `cf-ray`; every other request is a no-op. */
	onRequest: (headers: Headers) => void;
	/** Cancel the delayed purge (server closing). */
	stop: () => void;
}

/**
 * Plan the purges of one boot.
 * @param options - The purge and the delay.
 * @returns The handles; nothing runs until `start`.
 */
export function createDeploymentPurge(options: DeploymentPurgeOptions): DeploymentPurge {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hasSeenEdgeRequest = false;

	const run = (reason: string) => {
		options.purge(reason).catch((error: Error) => {
			console.error(`[edge-cache] deployment purge (${reason}) failed:`, error);
		});
	};

	return {
		start() {
			run('boot');
			timer = setTimeout(() => run(`${options.delayMs / 1000}s after boot`), options.delayMs);
			timer.unref();
		},
		onRequest(headers) {
			if (hasSeenEdgeRequest || !headers.has('cf-ray')) {
				return;
			}
			hasSeenEdgeRequest = true;
			run('first request through Cloudflare');
		},
		stop() {
			clearTimeout(timer);
		},
	};
}
