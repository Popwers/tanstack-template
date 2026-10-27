import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';

import { routeTree } from './routeTree.gen';

/**
 * Router factory, called on the server and in the browser. On the server it carries the request's CSP
 * nonce (`src/server.ts`) onto every script it renders; the browser reads it back from the page.
 * @returns The configured router.
 */
export function getRouter() {
	return createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		ssr: { nonce: getGlobalStartContext()?.cspNonce },
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
