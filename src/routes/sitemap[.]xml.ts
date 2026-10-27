import { createFileRoute } from '@tanstack/react-router';

import { SEO_FILE_CACHE_CONTROL, sitemapXml } from '#/lib/seo';
import { appOrigin } from '#/lib/server/env';

export const Route = createFileRoute('/sitemap.xml')({
	server: {
		handlers: {
			GET: () =>
				new Response(sitemapXml(appOrigin()), {
					headers: {
						'Content-Type': 'application/xml; charset=utf-8',
						'Cache-Control': SEO_FILE_CACHE_CONTROL,
					},
				}),
		},
	},
});
