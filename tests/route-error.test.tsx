import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import { RouteError } from '#/components/route-error';

/**
 * Failure modes covered:
 * - the error screen prints the thrown error (message naming a table, a path or a query) to the visitor;
 * - a route that throws leaves TanStack's raw English default instead of the app's French screen;
 * - the screen offers no way out: no retry, no link back home.
 */

const SECRET = 'relation "users" does not exist at /app/src/lib/db/schema.ts';

/** Render the page of a router whose `/boom` loader throws, as the server does. */
async function renderFailingPage(): Promise<string> {
	const root = createRootRoute({ component: Outlet });
	const boom = createRoute({
		getParentRoute: () => root,
		path: '/boom',
		loader: () => {
			throw new Error(SECRET);
		},
		component: () => <p>never rendered</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([boom]),
		history: createMemoryHistory({ initialEntries: ['/boom'] }),
		defaultErrorComponent: RouteError,
	});
	await router.load();
	return renderToString(<RouterProvider router={router} />);
}

describe('RouteError', () => {
	it('shows the friendly screen and never the thrown error', async () => {
		const html = await renderFailingPage();
		expect(html).toContain('Une erreur est survenue');
		expect(html).not.toContain('does not exist');
		expect(html).not.toContain('schema.ts');
		expect(html).not.toContain('never rendered');
	});

	it('offers a retry and a link back home', async () => {
		const html = await renderFailingPage();
		expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
		expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Retour à l’accueil<\/a>/);
	});
});
