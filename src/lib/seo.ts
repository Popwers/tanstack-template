import { PUBLIC_PAGES } from '#/lib/http-headers';

/** Routes no crawler needs: the app behind sign-in, the auth screens, the API. */
const DISALLOWED = [
	'/api/',
	'/_serverFn/',
	'/dashboard',
	'/sign-in',
	'/sign-up',
	'/forgot-password',
	'/reset-password',
];

/** A day for browsers and Cloudflare alike: these files change with a deploy only. */
export const SEO_FILE_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/**
 * robots.txt: every public page open, the app and the API closed, the sitemap announced.
 * @param appUrl - Canonical origin, without a trailing slash.
 * @returns The file's text.
 */
export function robotsTxt(appUrl: string): string {
	return [
		'User-agent: *',
		'Allow: /',
		...DISALLOWED.map((path) => `Disallow: ${path}`),
		'',
		`Sitemap: ${appUrl}/sitemap.xml`,
		'',
	].join('\n');
}

/**
 * sitemap.xml of the public pages.
 * @param appUrl - Canonical origin, without a trailing slash.
 * @returns The XML document.
 */
export function sitemapXml(appUrl: string): string {
	const urls = PUBLIC_PAGES.map((path) => `\t<url><loc>${appUrl}${path}</loc></url>`).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
