import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { edgeCachedUrls, purgeAfterDeploy, purgeCloudflareUrls, type Send } from '#/lib/server/edge-cache';
import { edgeCachePurge, resetEnvCache } from '#/lib/server/env';

/**
 * Failure modes covered:
 * - a page Cloudflare keeps is left out, or a URL doubles the slash of an APP_URL ending in one;
 * - more than 30 URLs go in one call and Cloudflare refuses them all;
 * - a refused or failed call throws into the boot plugin and crashes the server;
 * - the purge runs before the new server serves, so the edge refetches the old pages;
 * - a server that never serves keeps probing forever;
 * - half the CLOUDFLARE_* pair turns the purge on with an undefined zone or token.
 */

const ZONE = { kind: 'cloudflare', zoneId: 'zone_1', apiToken: 'token_1' } as const;
const NO_WAIT = { probeIntervalMs: 0, probes: 3, switchGraceMs: 0 };

interface SentCall {
	url: string;
	files: string[] | null;
	authorization: string | null;
}

/** A stand-in for fetch: records each call, answers with what `answer` returns. */
function fakeFetch(answer: (url: string) => Response | Promise<Response>) {
	const calls: SentCall[] = [];
	const send: Send = async (input, init) => {
		const request = new Request(input, init);
		const body: { files: string[] } | null = request.method === 'POST' ? await request.json() : null;
		calls.push({
			url: request.url,
			files: body?.files ?? null,
			authorization: request.headers.get('authorization'),
		});
		return answer(request.url);
	};
	return { send, calls };
}

afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

describe('edgeCachePurge', () => {
	function stub(values: Record<string, string>): void {
		vi.stubEnv('DATABASE_URL', 'postgres://test@localhost/test');
		for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
		resetEnvCache();
	}

	it('is on only with both the zone and the token', () => {
		stub({ CLOUDFLARE_ZONE_ID: 'zone_1', CLOUDFLARE_API_TOKEN: 'token_1' });
		expect(edgeCachePurge()).toEqual(ZONE);
		stub({ CLOUDFLARE_ZONE_ID: 'zone_1', CLOUDFLARE_API_TOKEN: '' });
		expect(edgeCachePurge()).toEqual({ kind: 'off' });
	});
});

describe('edgeCachedUrls', () => {
	it('lists every page Cloudflare keeps, on the APP_URL origin', () => {
		expect(edgeCachedUrls('https://example.com/')).toEqual([
			'https://example.com/',
			'https://example.com/confidentialite',
			'https://example.com/mentions-legales',
			'https://example.com/robots.txt',
			'https://example.com/sitemap.xml',
		]);
	});
});

describe('purgeCloudflareUrls', () => {
	it('sends at most 30 URLs per call, each once, with the zone token', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const { send, calls } = fakeFetch(() => Response.json({ success: true }));
		const urls = Array.from({ length: 65 }, (_, index) => `https://example.com/p${index}`);

		await purgeCloudflareUrls(ZONE, [...urls, urls[0] ?? ''], send);

		expect(calls.map((call) => call.files?.length)).toEqual([30, 30, 5]);
		expect(calls.flatMap((call) => call.files)).toEqual(urls);
		expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone_1/purge_cache');
		expect(calls[0]?.authorization).toBe('Bearer token_1');
	});

	it('logs a refused or failed call, never throws, and still sends the next batch', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		let call = 0;
		const { send, calls } = fakeFetch(() => {
			call += 1;
			if (call === 1) return new Response('{"success":false}', { status: 403 });
			throw new Error('network down');
		});
		const urls = Array.from({ length: 31 }, (_, index) => `https://example.com/p${index}`);

		await expect(purgeCloudflareUrls(ZONE, urls, send)).resolves.toBeUndefined();

		expect(calls).toHaveLength(2);
		expect(errors).toHaveBeenCalledWith(
			'[edge-cache] purge of 30 URL(s) refused (403):',
			'{"success":false}',
		);
		expect(errors).toHaveBeenCalledWith('[edge-cache] purge of 1 URL(s) failed:', expect.any(Error));
	});
});

describe('purgeAfterDeploy', () => {
	const input = (send: Send) => ({
		appUrl: 'https://example.com',
		healthUrl: 'http://127.0.0.1:3000/api/health',
		send,
	});

	it('purges the public pages only once the server answers its health check', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		let probes = 0;
		const { send, calls } = fakeFetch((url) => {
			if (url.endsWith('/api/health')) {
				probes += 1;
				return new Response(null, { status: probes < 2 ? 503 : 200 });
			}
			return Response.json({ success: true });
		});

		await purgeAfterDeploy(ZONE, input(send), NO_WAIT);

		expect(calls.map((call) => call.url)).toEqual([
			'http://127.0.0.1:3000/api/health',
			'http://127.0.0.1:3000/api/health',
			'https://api.cloudflare.com/client/v4/zones/zone_1/purge_cache',
		]);
		expect(calls[2]?.files).toEqual(edgeCachedUrls('https://example.com'));
	});

	it('gives up without purging when the server never serves', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { send, calls } = fakeFetch(() => {
			throw new Error('connection refused');
		});

		await expect(purgeAfterDeploy(ZONE, input(send), NO_WAIT)).resolves.toBeUndefined();

		expect(calls).toHaveLength(3);
		expect(errors).toHaveBeenCalledWith(
			'[edge-cache] the server never answered its health check: no purge',
		);
	});
});
