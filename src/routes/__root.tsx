/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Analytics } from '#/components/analytics';
import { SiteFooter } from '#/components/site-footer';
import { SITE } from '#/content/legal/site';
import { PUBLIC_PAGES } from '#/lib/http-headers';
import { getPublicConfig } from '#/lib/server/session';

import appCss from '#/styles.css?url';

export const Route = createRootRoute({
	loader: () => getPublicConfig(),
	staleTime: Number.POSITIVE_INFINITY,
	head: ({ loaderData, matches }) => {
		const pathname = matches.at(-1)?.pathname ?? '/';
		// Canonical and og:url on the public pages only: the app behind sign-in is not indexed.
		const pageUrl =
			loaderData !== undefined && PUBLIC_PAGES.includes(pathname)
				? `${loaderData.appUrl}${pathname}`
				: undefined;
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title: SITE.name },
				{ name: 'description', content: SITE.description },
				{ property: 'og:site_name', content: SITE.name },
				{ property: 'og:title', content: SITE.name },
				{ property: 'og:description', content: SITE.description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:locale', content: 'fr_FR' },
				{ name: 'twitter:card', content: 'summary_large_image' },
				...(loaderData === undefined
					? []
					: [
							{ property: 'og:image', content: `${loaderData.appUrl}/og-image.png` },
							{ property: 'og:image:width', content: '1200' },
							{ property: 'og:image:height', content: '630' },
						]),
				...(pageUrl === undefined ? [] : [{ property: 'og:url', content: pageUrl }]),
			],
			links: [
				{ rel: 'stylesheet', href: appCss },
				{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
				...(pageUrl === undefined ? [] : [{ rel: 'canonical', href: pageUrl }]),
			],
		};
	},
	shellComponent: RootDocument,
	component: RootLayout,
	notFoundComponent: () => (
		<main className='mx-auto max-w-2xl px-4 py-24 text-center'>
			<h1 className='text-2xl font-semibold'>Page introuvable</h1>
			<Link to='/' className='mt-4 inline-block underline'>
				Retour à l’accueil
			</Link>
		</main>
	),
});

/** Layout of every page: header, outlet, legal footer, analytics. */
function RootLayout() {
	const config = Route.useLoaderData();
	return (
		<div className='flex min-h-screen flex-col'>
			<header className='border-b px-4 py-3'>
				<nav className='mx-auto flex max-w-5xl items-center justify-between'>
					<Link to='/' className='font-semibold'>
						{SITE.name}
					</Link>
					<Link to='/dashboard' className='text-sm hover:underline'>
						Mon espace
					</Link>
				</nav>
			</header>
			<div className='flex-1'>
				<Outlet />
			</div>
			<SiteFooter />
			<Analytics clientId={config.openpanelClientId} apiUrl={config.openpanelApiUrl} />
		</div>
	);
}

/**
 * HTML document shell.
 * @param props.children - The rendered app.
 * @returns The document.
 */
function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang='fr'>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
