/**
 * Headers the server entry sets on every response: the security headers and the cache policy.
 * Pure, so the policy is tested without a server.
 */

/**
 * Pages the same for every anonymous visitor, which Cloudflare may keep (DEPLOY.md: cache rule).
 * The edge serves one CSP nonce to everyone for the TTL, so these pages must never render user input.
 */
export const PUBLIC_PAGES: readonly string[] = ['/', '/confidentialite', '/mentions-legales'];

/** A shared cache keeps the page five minutes; browsers always revalidate. */
export const PUBLIC_PAGE_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
export const PUBLIC_PAGE_CDN_CACHE_CONTROL = 'max-age=300, stale-while-revalidate=60';
/** Everything rendered for a signed-in visitor, and every API answer: never stored anywhere. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';
/** Vite's fingerprinted build files: a new deploy ships new names. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Better Auth's session cookie (`__Secure-` prefixed over https), the one the Cloudflare rule bypasses on. */
const SESSION_COOKIE = 'better-auth.session_token';

/** Headers every response carries; the per-request CSP comes from {@link contentSecurityPolicy}. */
export const SECURITY_HEADERS: ReadonlyArray<[string, string]> = [
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	['X-Frame-Options', 'DENY'],
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/** Turnstile's script and iframe origin. */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** What one response's CSP allows beyond the app's own origin. */
export interface CspSources {
	/** Fresh per response; TanStack sets it on every script it renders (router `ssr.nonce`). */
	nonce: string;
	/** Origins the browser posts to: the OpenPanel ingest, the Sentry DSN host. */
	connectOrigins: readonly string[];
}

/**
 * Content-Security-Policy of one response. Scripts run only with the nonce; `'strict-dynamic'` lets
 * those scripts load the rest (Vite chunks, Turnstile's api.js). Inline styles stay allowed: React
 * `style` props and Turnstile's widget set them.
 * @param sources - The response's nonce and the extra origins the browser calls.
 * @returns The header value.
 */
export function contentSecurityPolicy({ nonce, connectOrigins }: CspSources): string {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		["connect-src 'self'", ...connectOrigins].join(' '),
		`frame-src ${TURNSTILE_ORIGIN}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
	].join('; ');
}

/** One response as the policy sees it. */
export interface ResponsePolicyInput {
	pathname: string;
	method: string;
	status: number;
	contentType: string | null;
	/** The `Cache-Control` a route chose, if any. */
	cacheControl: string | null;
	/** The request's `Cookie` header. */
	cookie: string | null;
	hasSetCookie: boolean;
}

/** The cache headers to set: `cdn` `null` removes `CDN-Cache-Control`; `null` keeps the route's. */
export type CacheHeaders = { cacheControl: string; cdn: string | null } | null;

function isHtml(contentType: string | null): boolean {
	return contentType?.toLowerCase().startsWith('text/html') === true;
}

/**
 * Whether the request carries a Better Auth session.
 * @param cookie - The request's `Cookie` header.
 * @returns True when a session cookie is present.
 */
export function hasSessionCookie(cookie: string | null): boolean {
	return cookie !== null && cookie.includes(SESSION_COOKIE);
}

/**
 * Cache policy of one response. A public page rendered for an anonymous visitor, without a cookie
 * to set, may be shared by Cloudflare; any other page is private, so « Retour » after signing out
 * never shows a cached page. Fingerprinted assets are immutable (never a 404). API answers stay
 * private unless the route chose otherwise.
 * @param input - The request and response facts.
 * @returns The headers to set, or `null` to keep what the route set.
 */
export function cacheHeaders(input: ResponsePolicyInput): CacheHeaders {
	if (input.pathname.startsWith('/assets/') && input.status === 200) {
		return { cacheControl: IMMUTABLE_CACHE_CONTROL, cdn: null };
	}
	if (isHtml(input.contentType)) {
		const isShareable =
			PUBLIC_PAGES.includes(input.pathname) &&
			(input.method === 'GET' || input.method === 'HEAD') &&
			input.status === 200 &&
			!hasSessionCookie(input.cookie) &&
			!input.hasSetCookie;
		return isShareable
			? { cacheControl: PUBLIC_PAGE_CACHE_CONTROL, cdn: PUBLIC_PAGE_CDN_CACHE_CONTROL }
			: { cacheControl: PRIVATE_CACHE_CONTROL, cdn: null };
	}
	if (input.cacheControl !== null) return null;
	return { cacheControl: PRIVATE_CACHE_CONTROL, cdn: null };
}
