import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

/**
 * Router factory, called on the server and in the browser.
 * @returns The configured router.
 */
export function getRouter() {
	return createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
