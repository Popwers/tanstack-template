import { parseTracesSampleRate, sentryOptions, shouldInitSentry } from '#/lib/sentry';

/**
 * Load and start the browser SDK after hydration, so it stays off the first-paint graph.
 * `VITE_SENTRY_DSN` and `VITE_SENTRY_TRACES_SAMPLE_RATE` are inlined at build time (Coolify build args).
 */
export function initBrowserSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!shouldInitSentry(import.meta.env.PROD, dsn)) return;
	const options = sentryOptions(parseTracesSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE));
	void import('@sentry/tanstackstart-react').then((Sentry) => Sentry.init({ dsn, ...options }));
}
