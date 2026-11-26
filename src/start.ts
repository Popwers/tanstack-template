import { isNotFound, isRedirect } from '@tanstack/react-router';
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';

import { PublicError } from '#/lib/public-error';

/** What the browser gets when a server function fails unexpectedly. */
const UNEXPECTED_ERROR_MESSAGE = 'Une erreur est survenue. Réessayez dans un instant.';

/** Server functions are same-origin RPC: refuse cross-site calls. API routes keep their own checks. */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === 'serverFn',
});

/**
 * An unexpected error can name a table, a query and its parameters: the browser gets a generic
 * message, the server log and Sentry get the error. Redirects, not-found, thrown responses and
 * {@link PublicError} pass through.
 */
const hideUnexpectedErrors = createMiddleware({ type: 'function' }).server(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (
			isRedirect(error) ||
			isNotFound(error) ||
			error instanceof Response ||
			error instanceof PublicError
		) {
			throw error;
		}
		console.error('[server fn] unexpected error:', error);
		const Sentry = await import('@sentry/tanstackstart-react');
		Sentry.captureException(error);
		throw new Error(UNEXPECTED_ERROR_MESSAGE);
	}
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware],
	functionMiddleware: [hideUnexpectedErrors],
}));

declare module '@tanstack/react-start' {
	interface Register {
		/** Set per request by `src/server.ts`; the router renders its scripts with it. */
		server: { requestContext: { cspNonce: string } };
	}
}
