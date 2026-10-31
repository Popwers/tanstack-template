import { PUBLIC_PAGES } from '#/lib/http-headers';
import type { EdgeCachePurge } from '#/lib/server/env';

/**
 * Cloudflare keeps the public pages at the edge (`CDN-Cache-Control` of `#/lib/http-headers`, the
 * day of robots.txt and sitemap.xml). A deploy changes them, so each production boot purges them by
 * URL once the new server serves. Never throws: a refused or failed call is logged and the pages
 * wait for their TTL.
 */

/** Most URLs one purge call takes on the Free, Pro and Business plans. */
const URLS_PER_PURGE = 30;

/** The paths Cloudflare may hold: the shareable pages and the crawler files. */
const EDGE_CACHED_PATHS: readonly string[] = [...PUBLIC_PAGES, '/robots.txt', '/sitemap.xml'];

/** The HTTP call the purge makes: `fetch` in production, a stand-in in tests. */
export type Send = (url: string, init?: RequestInit) => Promise<Response>;

/** Cloudflare zone and a token allowed to purge it. */
export type PurgeZone = Extract<EdgeCachePurge, { kind: 'cloudflare' }>;

/**
 * The absolute URLs Cloudflare keys its copies of the public pages by.
 * @param appUrl - Public origin (APP_URL), trailing slash or not.
 * @returns One URL per edge-cached path.
 */
export function edgeCachedUrls(appUrl: string): string[] {
	const origin = appUrl.replace(/\/+$/, '');
	return EDGE_CACHED_PATHS.map((path) => origin + path);
}

/** One purge call: its outcome is logged, a failure never reaches the caller. */
async function purgeBatch(zone: PurgeZone, files: readonly string[], send: Send): Promise<void> {
	try {
		const response = await send(
			`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone.zoneId)}/purge_cache`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${zone.apiToken}`, 'content-type': 'application/json' },
				body: JSON.stringify({ files }),
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (response.ok) {
			console.info(`[edge-cache] purged ${files.length} URL(s)`);
		} else {
			console.error(
				`[edge-cache] purge of ${files.length} URL(s) refused (${response.status}):`,
				(await response.text()).slice(0, 300),
			);
		}
	} catch (error) {
		console.error(`[edge-cache] purge of ${files.length} URL(s) failed:`, error);
	}
}

/**
 * Ask Cloudflare to drop these URLs from the zone's cache, 30 per call. The calls are independent
 * and go out together: one that fails does not hold back the others.
 * @param zone - The zone and its purge token.
 * @param urls - Absolute URLs.
 * @param send - `fetch`, replaced in tests.
 */
export async function purgeCloudflareUrls(
	zone: PurgeZone,
	urls: readonly string[],
	send: Send = fetch,
): Promise<void> {
	const unique = [...new Set(urls)];
	const batches: string[][] = [];
	for (let start = 0; start < unique.length; start += URLS_PER_PURGE) {
		batches.push(unique.slice(start, start + URLS_PER_PURGE));
	}
	await Promise.all(batches.map((files) => purgeBatch(zone, files, send)));
}

/** How the post-deploy purge waits for the new server. */
export interface DeployPurgeTiming {
	/** Between two probes of the local health check. */
	probeIntervalMs: number;
	/** Probes before giving up: a server that never serves has nothing new to show. */
	probes: number;
	/**
	 * After the first healthy probe. Coolify moves traffic once Docker's health check passes (30 s
	 * interval): a purge before that would let Cloudflare refetch the old container's pages.
	 */
	switchGraceMs: number;
}

const DEPLOY_PURGE_TIMING: DeployPurgeTiming = { probeIntervalMs: 2_000, probes: 60, switchGraceMs: 60_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Purge the public pages once this server answers its health check and traffic has moved to it.
 * Never throws.
 * @param zone - The zone and its purge token.
 * @param input - Public origin, the local health URL, and `fetch` (replaced in tests).
 * @param timing - How long to wait (shortened in tests).
 */
export async function purgeAfterDeploy(
	zone: PurgeZone,
	input: { appUrl: string; healthUrl: string; send?: Send },
	timing: DeployPurgeTiming = DEPLOY_PURGE_TIMING,
): Promise<void> {
	const send = input.send ?? fetch;
	for (let probe = 0; probe < timing.probes; probe += 1) {
		const isServing = await send(input.healthUrl, { signal: AbortSignal.timeout(5_000) }).then(
			(response) => response.ok,
			() => false,
		);
		if (isServing) {
			await sleep(timing.switchGraceMs);
			await purgeCloudflareUrls(zone, edgeCachedUrls(input.appUrl), send);
			return;
		}
		await sleep(timing.probeIntervalMs);
	}
	console.error('[edge-cache] the server never answered its health check: no purge');
}
