import { createFileRoute } from '@tanstack/react-router';

import { robotsTxt, SEO_FILE_CACHE_CONTROL } from '#/lib/seo';
import { appOrigin } from '#/lib/server/env';

export const Route = createFileRoute('/robots.txt')({
	server: {
		handlers: {
			GET: () =>
				new Response(robotsTxt(appOrigin()), {
					headers: {
						'Content-Type': 'text/plain; charset=utf-8',
						'Cache-Control': SEO_FILE_CACHE_CONTROL,
					},
				}),
		},
	},
});
