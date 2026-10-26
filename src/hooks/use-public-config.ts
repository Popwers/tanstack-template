import { getRouteApi } from '@tanstack/react-router';

const rootRoute = getRouteApi('__root__');

/**
 * Public browser config loaded once by the root route.
 * @returns Turnstile site key and OpenPanel settings.
 */
export function usePublicConfig() {
	return rootRoute.useLoaderData();
}
