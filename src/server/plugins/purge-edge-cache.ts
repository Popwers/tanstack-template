import { definePlugin } from 'nitro';

import { purgeAfterDeploy } from '#/lib/server/edge-cache';
import { appOrigin, edgeCachePurge, env, isPrerendering, isProduction } from '#/lib/server/env';

/**
 * Each production boot is a deploy: purge the public pages from Cloudflare in the background, once
 * the server serves. Off without CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN, and outside production.
 */
export default definePlugin(() => {
	if (!isProduction() || isPrerendering()) return;
	const target = edgeCachePurge();
	if (target.kind === 'off') return;
	void purgeAfterDeploy(target, {
		appUrl: appOrigin(),
		healthUrl: `http://127.0.0.1:${env().PORT}/api/health`,
	});
});
