import { createMiddleware } from '@tanstack/react-start';

import {
	announceStaleBuild,
	isMissingServerFunctionMessage,
	isNavigationInFlight,
	MISSING_SERVER_FUNCTION_MESSAGE,
	reloadNow,
	StaleBuildError,
} from '#/lib/chunk-reload';

/**
 * Whether a server-function request failed because its id is unknown to this build.
 * @param error - What the pipeline threw (Start throws `Server function info not found for <id>`).
 * @returns `true` for a stale tab calling a function a newer build removed or renamed.
 */
export function isMissingServerFunction(error: Error): boolean {
	return error.message.startsWith(MISSING_SERVER_FUNCTION_MESSAGE);
}

/**
 * A tab left open across a deployment calls a server function id the new build no longer has. That is no
 * server fault: it answers 404 with a short text instead of letting the error reach the log and Sentry,
 * and the tab reloads (`reloadOnMissingServerFunction`). The id is not echoed.
 */
export const answerMissingServerFunction = createMiddleware().server(async ({ handlerType, next }) => {
	try {
		return await next();
	} catch (error) {
		if (handlerType === 'serverFn' && error instanceof Error && isMissingServerFunction(error)) {
			return new Response(MISSING_SERVER_FUNCTION_MESSAGE, {
				status: 404,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
		}
		throw error;
	}
});

/**
 * Browser side, on that answer. A read (GET) made during a navigation reloads the page once to a fresh
 * address and stays pending until the page leaves, so no error screen flashes; when the reload is refused
 * (one already happened a moment ago) the error goes on to the caller. A read made outside a navigation
 * (the router preloads on hover, a query refetches) is never reloaded away, the visitor's typed text
 * would vanish: it rejects with a `StaleBuildError` and the app shows its notice once. The click that
 * follows fails again inside a navigation, which reloads. Any other call changes data: same, with the
 * save variant of the notice; the form stays on screen. A refused save called from a route loader still
 * reaches the route error boundary, which reloads.
 */
export const reloadOnMissingServerFunction = createMiddleware({ type: 'function' }).client(
	async ({ method, next }) => {
		try {
			return await next();
		} catch (error) {
			if (!(error instanceof Error) || !isMissingServerFunctionMessage(error.message)) {
				throw error;
			}
			if (method === 'GET' && isNavigationInFlight()) {
				if (reloadNow()) {
					return new Promise<never>(() => {});
				}
				throw error;
			}
			const kind = method === 'GET' ? 'read' : 'save';
			announceStaleBuild(kind);
			throw new StaleBuildError(kind);
		}
	},
);
