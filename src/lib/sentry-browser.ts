import { isPageReloading } from '#/lib/chunk-reload';
import { parseTracesSampleRate, scrubEventTokens, sentryOptions, shouldInitSentry } from '#/lib/sentry';

/**
 * `beforeSend` of the browser SDK: nothing is reported while the page is reloading onto a fresh build (the
 * error it still throws on the way out is not a bug), otherwise the shared scrub.
 * @param event - The event the SDK is about to send.
 * @returns The scrubbed event, or `null` to drop it.
 */
export function beforeSendBrowser<TEvent extends Parameters<typeof scrubEventTokens>[0]>(
	event: TEvent,
): TEvent | null {
	return isPageReloading() ? null : scrubEventTokens(event);
}

/**
 * Load and start the browser SDK after hydration, so it stays off the first-paint graph.
 * `VITE_SENTRY_DSN` and `VITE_SENTRY_TRACES_SAMPLE_RATE` are inlined at build time (Coolify build args).
 */
export function initBrowserSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!shouldInitSentry(import.meta.env.PROD, dsn)) return;
	const options = sentryOptions(parseTracesSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE));
	void import('@sentry/tanstackstart-react').then((Sentry) =>
		Sentry.init({ dsn, ...options, beforeSend: beforeSendBrowser }),
	);
}
