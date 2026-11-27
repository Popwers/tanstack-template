import type { EdgeCachePurge } from '#/lib/server/env';

/**
 * Cloudflare keeps the public pages at the edge (`CDN-Cache-Control` of `#/lib/http-headers`, the
 * day of robots.txt and sitemap.xml). A deploy changes them, and their HTML names the hashed files of
 * the build that rendered it, which the new container no longer has: each production boot purges the
 * hostname's copies (`#/lib/server/deployment-purge`). Never throws: a refused or failed call is
 * logged and the pages wait for their TTL.
 */

/** The HTTP call the purge makes: `fetch` in production, a stand-in in tests. */
export type Send = (url: string, init?: RequestInit) => Promise<Response>;

/** Cloudflare zone and a token allowed to purge it. */
export type PurgeZone = Extract<EdgeCachePurge, { kind: 'cloudflare' }>;

/**
 * Drop everything Cloudflare keeps for a hostname: the public pages with any query string, robots.txt
 * and sitemap.xml. One call, allowed on every plan with the « Cache Purge » permission. The fingerprinted
 * assets served from the same hostname are fetched from the origin once more. Never throws.
 * @param zone - The zone and its purge token.
 * @param host - The hostname of `APP_URL`.
 * @param reason - Why, for the log (`boot`, `first request through Cloudflare`, ...).
 * @param send - `fetch`, replaced in tests.
 * @returns Whether Cloudflare accepted the call.
 */
export async function purgeEdgeHost(
	zone: PurgeZone,
	host: string,
	reason: string,
	send: Send = fetch,
): Promise<'purged' | 'failed'> {
	try {
		const response = await send(
			`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone.zoneId)}/purge_cache`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${zone.apiToken}`, 'content-type': 'application/json' },
				body: JSON.stringify({ hosts: [host] }),
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!response.ok) {
			console.error(
				`[edge-cache] purge of every cached page of ${host} refused (${response.status}):`,
				(await response.text()).slice(0, 300),
			);
			return 'failed';
		}
		console.info(`[edge-cache] purged every cached page of ${host} (${reason})`);
		return 'purged';
	} catch (error) {
		console.error(`[edge-cache] purge of every cached page of ${host} failed:`, error);
		return 'failed';
	}
}
