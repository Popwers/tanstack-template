import { describe, expect, it } from 'vite-plus/test';

import {
	cacheHeaders,
	contentSecurityPolicy,
	IMMUTABLE_CACHE_CONTROL,
	PRIVATE_CACHE_CONTROL,
	PUBLIC_PAGE_CACHE_CONTROL,
	PUBLIC_PAGE_CDN_CACHE_CONTROL,
	type ResponsePolicyInput,
} from '#/lib/http-headers';
import { robotsTxt, sitemapXml } from '#/lib/seo';

/**
 * Failure modes covered:
 * - a page rendered for a signed-in visitor, or one setting a cookie, is marked shareable and
 *   Cloudflare serves it to the next visitor;
 * - an app page gets CDN-Cache-Control at all, or a public page never gets it;
 * - a 404 under /assets/ is marked immutable;
 * - a route's own cache choice (robots.txt, sitemap.xml) is overwritten;
 * - the sitemap lists an app page, or robots.txt leaves the app open or omits the sitemap;
 * - the CSP lets an inline script run without the nonce, blocks Turnstile's script or iframe, drops
 *   an analytics or Sentry origin, or lets another site frame the app.
 */

const PRIVATE = { cacheControl: PRIVATE_CACHE_CONTROL, cdn: null };

function page(overrides: Partial<ResponsePolicyInput>): ResponsePolicyInput {
	return {
		pathname: '/',
		method: 'GET',
		status: 200,
		contentType: 'text/html; charset=utf-8',
		cacheControl: null,
		cookie: null,
		hasSetCookie: false,
		...overrides,
	};
}

describe('cacheHeaders', () => {
	it.each(['/', '/confidentialite', '/mentions-legales'])(
		'lets the edge keep %s for an anonymous visitor',
		(pathname) => {
			expect(cacheHeaders(page({ pathname }))).toEqual({
				cacheControl: PUBLIC_PAGE_CACHE_CONTROL,
				cdn: PUBLIC_PAGE_CDN_CACHE_CONTROL,
			});
		},
	);

	it('keeps a public page private for a signed-in visitor, over http or https', () => {
		expect(cacheHeaders(page({ cookie: 'a=1; better-auth.session_token=abc' }))).toEqual(PRIVATE);
		expect(cacheHeaders(page({ cookie: '__Secure-better-auth.session_token=abc' }))).toEqual(PRIVATE);
	});

	it('keeps private a page that sets a cookie, fails, or answers a POST', () => {
		expect(cacheHeaders(page({ hasSetCookie: true }))).toEqual(PRIVATE);
		expect(cacheHeaders(page({ status: 500 }))).toEqual(PRIVATE);
		expect(cacheHeaders(page({ method: 'POST' }))).toEqual(PRIVATE);
	});

	it.each(['/dashboard', '/sign-in', '/reset-password'])('never lets %s reach the edge', (pathname) => {
		expect(cacheHeaders(page({ pathname }))).toEqual(PRIVATE);
	});

	it('marks fingerprinted assets immutable, but not a missing one', () => {
		const asset = { pathname: '/assets/main-Ab12.js', contentType: 'text/javascript' };
		expect(cacheHeaders(page(asset))?.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(cacheHeaders(page({ ...asset, status: 404 }))).toEqual(PRIVATE);
	});

	it('keeps the cache choice of a non-HTML route, and makes the rest private', () => {
		const robots = {
			pathname: '/robots.txt',
			contentType: 'text/plain',
			cacheControl: 'public, max-age=3600',
		};
		expect(cacheHeaders(page(robots))).toBeNull();
		expect(cacheHeaders(page({ pathname: '/api/health', contentType: 'application/json' }))).toEqual(
			PRIVATE,
		);
	});
});

describe('contentSecurityPolicy', () => {
	const directives = (policy: string): Map<string, string[]> =>
		new Map(
			policy.split('; ').map((directive) => {
				const [name = '', ...values] = directive.split(' ');
				return [name, values];
			}),
		);
	const policy = directives(
		contentSecurityPolicy({ nonce: 'abc123', connectOrigins: ['https://o.example.com'] }),
	);

	it('runs scripts by nonce only, never inline or eval', () => {
		expect(policy.get('script-src')).toContain("'nonce-abc123'");
		expect(policy.get('script-src')).toContain("'strict-dynamic'");
		expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
		expect(policy.get('script-src')).not.toContain("'unsafe-eval'");
	});

	it('allows the Turnstile script and iframe', () => {
		expect(policy.get('script-src')).toContain('https://challenges.cloudflare.com');
		expect(policy.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
	});

	it('lets the browser post to the given origins and to its own', () => {
		expect(policy.get('connect-src')).toEqual(["'self'", 'https://o.example.com']);
		expect(
			directives(contentSecurityPolicy({ nonce: 'n', connectOrigins: [] })).get('connect-src'),
		).toEqual(["'self'"]);
	});

	it('refuses framing, plugins and foreign form targets', () => {
		expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
		expect(policy.get('object-src')).toEqual(["'none'"]);
		expect(policy.get('form-action')).toEqual(["'self'"]);
		expect(policy.get('base-uri')).toEqual(["'self'"]);
	});
});

describe('crawler files', () => {
	it('lists only the public pages in the sitemap, on the canonical origin', () => {
		const xml = sitemapXml('https://example.com');
		expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([
			'https://example.com/',
			'https://example.com/confidentialite',
			'https://example.com/mentions-legales',
		]);
	});

	it('closes the app and the API, and announces the sitemap', () => {
		const robots = robotsTxt('https://example.com');
		for (const path of ['/api/', '/dashboard', '/reset-password'])
			expect(robots).toContain(`Disallow: ${path}`);
		expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
	});
});
