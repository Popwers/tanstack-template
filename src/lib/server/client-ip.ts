import type { BetterAuthAdvancedOptions } from 'better-auth';

/**
 * Cloudflare edge ranges, from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
 * (fetched 2026-10-29). A stale list only degrades to keying a new edge by its own address; it never
 * trusts a client.
 */
const CLOUDFLARE_RANGES = [
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'108.162.192.0/18',
	'190.93.240.0/20',
	'188.114.96.0/20',
	'197.234.240.0/22',
	'198.41.128.0/17',
	'162.158.0.0/15',
	'104.16.0.0/13',
	'104.24.0.0/14',
	'172.64.0.0/13',
	'131.0.72.0/22',
	'2400:cb00::/32',
	'2606:4700::/32',
	'2803:f800::/32',
	'2405:b500::/32',
	'2405:8100::/32',
	'2a06:98c0::/29',
	'2c0f:f248::/32',
];

/**
 * Better Auth `advanced.ipAddress`: the rate limiter walks `x-forwarded-for` from the right and skips
 * Cloudflare hops, so a client address is only taken from a hop a Cloudflare edge vouched for. Without it,
 * Better Auth finds no single trusted address behind Cloudflare + Traefik and puts every visitor in one
 * shared bucket per route.
 */
export const authIpAddressOptions = {
	ipAddressHeaders: ['x-forwarded-for'],
	trustedProxies: CLOUDFLARE_RANGES,
} satisfies NonNullable<BetterAuthAdvancedOptions['ipAddress']>;

/** Node's fetch requires `duplex` for a stream body; the DOM lib does not declare it yet. */
interface StreamingRequestInit extends RequestInit {
	duplex: 'half';
}

/**
 * Rebuild the `x-forwarded-for` chain Better Auth resolves the client from.
 *
 * - Behind Traefik, `x-forwarded-for` ends with the direct peer (a Cloudflare edge in production).
 *   `cf-connecting-ip` is prepended: Better Auth keys on the visitor when the peer is a Cloudflare edge,
 *   and on the peer itself when a client reaches the origin directly with a forged header.
 * - Without a proxy header (local server, e2e), the socket peer is the client.
 * @param request - The incoming auth request.
 * @param socketPeer - The TCP peer address, ignoring forwarded headers.
 * @returns The request with the rebuilt chain, or the original one when there is nothing to rebuild.
 */
export function withClientIpChain(request: Request, socketPeer: string | undefined): Request {
	const forwardedFor = request.headers.get('x-forwarded-for')?.trim();
	const cloudflareClientIp = request.headers.get('cf-connecting-ip')?.trim();
	const peer = socketPeer?.trim();

	const chain = forwardedFor
		? cloudflareClientIp
			? `${cloudflareClientIp}, ${forwardedFor}`
			: undefined
		: peer;
	if (!chain) return request;

	const headers = new Headers(request.headers);
	headers.set('x-forwarded-for', chain);
	// Rebuilt from public fields: `new Request(request)` reads native private slots that srvx's Node
	// request (the dev server) lacks even though it passes `instanceof Request`.
	const init: StreamingRequestInit = {
		method: request.method,
		headers,
		body: request.body,
		signal: request.signal,
		duplex: 'half',
	};
	return new Request(request.url, init);
}
