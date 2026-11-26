import { definePlugin } from 'nitro';

import { createDeploymentPurge } from '#/lib/server/deployment-purge';
import { purgeEdgeHost } from '#/lib/server/edge-cache';
import { appOrigin, edgeCachePurge, isPrerendering, isProduction } from '#/lib/server/env';

/** Long enough for Coolify to move the traffic after the new container passes its health check. */
const DELAYED_PURGE_MS = 120_000;

/**
 * Each production boot is a deploy: purge Cloudflare's copies of the public pages at boot, on the first
 * request that came through Cloudflare, and once more 120 s after boot (`#/lib/server/deployment-purge`).
 * Off without CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN, and outside production.
 */
export default definePlugin((nitroApp) => {
	if (!isProduction() || isPrerendering()) return;
	const target = edgeCachePurge();
	if (target.kind === 'off') {
		console.info(
			'[edge-cache] deployment purge off: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN is not set',
		);
		return;
	}
	const host = new URL(appOrigin()).hostname;
	const deploymentPurge = createDeploymentPurge({
		purge: async (reason) => {
			await purgeEdgeHost(target, host, reason);
		},
		delayMs: DELAYED_PURGE_MS,
	});
	deploymentPurge.start();
	nitroApp.hooks.hook('request', (event) => deploymentPurge.onRequest(event.req.headers));
	nitroApp.hooks.hook('close', deploymentPurge.stop);
});
