import { SENTRY_OPTIONS, shouldInitSentry } from '#/lib/sentry';

/**
 * Load and start the browser SDK after hydration, so it stays off the first-paint graph.
 * `VITE_SENTRY_DSN` is inlined at build time (Coolify build arg).
 */
export function initBrowserSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!shouldInitSentry(import.meta.env.PROD, dsn)) return;
	void import('@sentry/tanstackstart-react').then((Sentry) => Sentry.init({ dsn, ...SENTRY_OPTIONS }));
}
