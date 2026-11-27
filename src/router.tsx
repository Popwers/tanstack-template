import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';

import { RouteError } from '#/components/route-error';
import { installChunkReload } from '#/lib/chunk-reload';

import { routeTree } from './routeTree.gen';

/**
 * Router factory, called on the server and in the browser. On the server it carries the request's CSP
 * nonce (`src/server.ts`) onto every script it renders; the browser reads it back from the page.
 * @returns The configured router.
 */
export function getRouter() {
	if (!import.meta.env.SSR) {
		// Before the router reads the address: the reload query is dropped from it first.
		installChunkReload(() => router.state.status === 'pending');
	}
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		// Inside the root layout for a child route's error, so the header and footer stay.
		defaultErrorComponent: RouteError,
		ssr: { nonce: getGlobalStartContext()?.cspNonce },
	});
	return router;
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
