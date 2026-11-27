import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

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

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('RouteError', () => {
	it('renders nothing while the page is reloading: the error screen would only flash', async () => {
		vi.resetModules();
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/boom',
				origin: 'https://example.com',
				replace: () => undefined,
			},
			sessionStorage: { getItem: () => null, setItem: () => undefined },
		});
		const { reloadNow } = await import('#/lib/chunk-reload');
		const { RouteError: Reloading } = await import('#/components/route-error');
		expect(reloadNow()).toBe(true);

		const root = createRootRoute({ component: Outlet });
		const boom = createRoute({
			getParentRoute: () => root,
			path: '/boom',
			loader: () => {
				throw new TypeError("Cannot read properties of undefined (reading 'component')");
			},
			component: () => <p>never rendered</p>,
		});
		const router = createRouter({
			routeTree: root.addChildren([boom]),
			history: createMemoryHistory({ initialEntries: ['/boom'] }),
			defaultErrorComponent: Reloading,
		});
		await router.load();

		expect(renderToString(<RouterProvider router={router} />)).not.toContain('Une erreur est survenue');
	});

	it('shows the screen again once the reloading window ended without the page leaving', async () => {
		vi.useFakeTimers();
		vi.resetModules();
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/boom',
				origin: 'https://example.com',
				replace: () => undefined,
			},
			sessionStorage: { getItem: () => null, setItem: () => undefined },
		});
		const chunk = await import('#/lib/chunk-reload');
		const { RouteError: Window } = await import('#/components/route-error');
		chunk.reloadNow();
		vi.advanceTimersByTime(chunk.RELOADING_WINDOW_MS);

		const root = createRootRoute({ component: Outlet });
		const boom = createRoute({
			getParentRoute: () => root,
			path: '/boom',
			loader: () => {
				throw new Error('a real error');
			},
			component: () => <p>never rendered</p>,
		});
		const router = createRouter({
			routeTree: root.addChildren([boom]),
			history: createMemoryHistory({ initialEntries: ['/boom'] }),
			defaultErrorComponent: Window,
		});
		await router.load();

		expect(renderToString(<RouterProvider router={router} />)).toContain('Une erreur est survenue');
	});

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
