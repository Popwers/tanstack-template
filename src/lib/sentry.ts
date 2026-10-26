/**
 * Sentry runs in production builds only, and only when a DSN is set.
 * @param isProduction - Whether this is a production runtime.
 * @param dsn - Candidate DSN (`SENTRY_DSN` on the server, `VITE_SENTRY_DSN` inlined in the browser).
 * @returns Whether to initialise the SDK.
 */
export function shouldInitSentry(isProduction: boolean, dsn: string | undefined): dsn is string {
	return isProduction && dsn !== undefined && dsn.trim().length > 0;
}

/** Shared SDK options: no PII, light tracing. */
export const SENTRY_OPTIONS = {
	sendDefaultPii: false,
	tracesSampleRate: 0.1,
	environment: 'production',
} as const;
