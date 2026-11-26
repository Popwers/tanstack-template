import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { purgeEdgeHost, type Send } from '#/lib/server/edge-cache';
import { edgeCachePurge, resetEnvCache } from '#/lib/server/env';

/**
 * Failure modes covered:
 * - the purge names a URL list instead of the hostname, so a page with a query string stays cached;
 * - a refused or failed call throws into the boot plugin and crashes the server;
 * - half the CLOUDFLARE_* pair turns the purge on with an undefined zone or token.
 */

const ZONE = { kind: 'cloudflare', zoneId: 'zone_1', apiToken: 'token_1' } as const;

interface SentCall {
	url: string;
	body: { hosts: string[] };
	authorization: string | null;
}

/** A stand-in for fetch: records each call, answers with what `answer` returns. */
function fakeFetch(answer: () => Response | Promise<Response>) {
	const calls: SentCall[] = [];
	const send: Send = async (input, init) => {
		const request = new Request(input, init);
		calls.push({
			url: request.url,
			body: await request.json(),
			authorization: request.headers.get('authorization'),
		});
		return answer();
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

describe('purgeEdgeHost', () => {
	it('purges the hostname with the zone token', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const { send, calls } = fakeFetch(() => Response.json({ success: true }));

		expect(await purgeEdgeHost(ZONE, 'example.com', 'boot', send)).toBe('purged');

		expect(calls).toEqual([
			{
				url: 'https://api.cloudflare.com/client/v4/zones/zone_1/purge_cache',
				body: { hosts: ['example.com'] },
				authorization: 'Bearer token_1',
			},
		]);
		expect(info).toHaveBeenCalledWith('[edge-cache] purged every cached page of example.com (boot)');
	});

	it('logs a refusal and an unreachable API without throwing', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refused = fakeFetch(() => new Response('forbidden', { status: 403 }));
		expect(await purgeEdgeHost(ZONE, 'example.com', 'boot', refused.send)).toBe('failed');
		const offline: Send = async () => {
			throw new TypeError('fetch failed');
		};
		expect(await purgeEdgeHost(ZONE, 'example.com', 'boot', offline)).toBe('failed');
		expect(logged).toHaveBeenCalledTimes(2);
	});
});
