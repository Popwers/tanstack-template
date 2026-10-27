import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/** Server functions are same-origin RPC: refuse cross-site calls. API routes keep their own checks. */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === 'serverFn',
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware],
}));

declare module '@tanstack/react-start' {
	interface Register {
		/** Set per request by `src/server.ts`; the router renders its scripts with it. */
		server: { requestContext: { cspNonce: string } };
	}
}
