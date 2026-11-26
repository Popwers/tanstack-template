import { createMiddleware } from '@tanstack/react-start';

import {
	isMissingServerFunctionMessage,
	MISSING_SERVER_FUNCTION_MESSAGE,
	reloadNow,
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
 * Browser side: on that answer, reload the page once to a fresh address and keep the call pending until
 * the page leaves, so no error screen or toast flashes. When the reload is refused (one already happened
 * a moment ago) the error goes on to the caller as any other.
 */
export const reloadOnMissingServerFunction = createMiddleware({ type: 'function' }).client(
	async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof Error && isMissingServerFunctionMessage(error.message) && reloadNow()) {
				return new Promise<never>(() => {});
			}
			throw error;
		}
	},
);
