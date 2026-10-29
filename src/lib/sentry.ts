import type { Event, init } from '@sentry/tanstackstart-react';

/** `Sentry.init` options of the installed SDK (browser and server share them). */
type SentryInitOptions = Parameters<typeof init>[0];

/** Fields of the sampling context the traces sampler reads. */
export type TraceSamplingInput = Pick<
	Parameters<NonNullable<SentryInitOptions['tracesSampler']>>[0],
	'name' | 'attributes' | 'parentSampled'
>;

/**
 * Sentry runs in production builds only, and only when a DSN is set.
 * @param isProduction - Whether this is a production runtime.
 * @param dsn - Candidate DSN (`SENTRY_DSN` on the server, `VITE_SENTRY_DSN` inlined in the browser).
 * @returns Whether to initialise the SDK.
 */
export function shouldInitSentry(isProduction: boolean, dsn: string | undefined): dsn is string {
	return isProduction && dsn !== undefined && dsn.trim().length > 0;
}

/**
 * Trace rate when `SENTRY_TRACES_SAMPLE_RATE` is unset. The Sentry quota is shared by the whole
 * organization: one app tracing at a higher rate rate-limits every other project.
 */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Read a trace rate from the environment. Sentry starts before the server validates its env and the
 * browser cannot refuse to boot, so a blank, non-numeric or out-of-range value falls back to the default.
 * @param value - Raw `SENTRY_TRACES_SAMPLE_RATE` (`VITE_SENTRY_TRACES_SAMPLE_RATE` in the browser).
 * @returns A rate in `[0, 1]`.
 */
export function parseTracesSampleRate(value: string | undefined): number {
	if (value === undefined || value.trim().length === 0) return DEFAULT_TRACES_SAMPLE_RATE;
	const rate = Number(value);
	return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_TRACES_SAMPLE_RATE;
}

/**
 * Health probes (every 30 s from Docker) are never traced, a parent's decision is inherited, any other
 * trace is kept at `rate`. At span start an `http.server` span is only named after its method, so the
 * path comes from the `url.path` attribute.
 * @param rate - Rate in `[0, 1]` for traces without a parent decision.
 * @returns The `tracesSampler`.
 */
export function createTracesSampler(rate: number): (context: TraceSamplingInput) => number | boolean {
	return (context) => {
		if (context.attributes?.['url.path'] === '/api/health' || context.name.includes('/api/health'))
			return 0;
		if (context.parentSampled !== undefined) return context.parentSampled;
		return rate;
	};
}

/** What replaces a token in a URL sent to Sentry. */
const FILTERED = '[Filtered]';

/** A query parameter whose name holds `token` (`token`, `access_token`…), its value captured for removal. */
const TOKEN_QUERY_PARAM = /(^|[?&#;])([^=&#?/\s]*token[^=&#?/\s]*=)[^&#\s]*/gi;

/** Better Auth's reset link carries its token as a path segment: `/api/auth/reset-password/<token>`. */
const TOKEN_PATH_SEGMENT = /(\/reset-password\/)[^/?#\s]+/gi;

/**
 * Remove the tokens of a URL, a query string or any text holding one.
 * @param text - URL or text.
 * @returns The text with every token value replaced by `[Filtered]`.
 */
export function scrubTokens(text: string): string {
	return text.replace(TOKEN_QUERY_PARAM, `$1$2${FILTERED}`).replace(TOKEN_PATH_SEGMENT, `$1${FILTERED}`);
}

/** Span or trace attributes as Sentry serializes them. */
type SpanData = NonNullable<NonNullable<Event['spans']>[number]['data']>;

/** Span attributes that hold a URL or its query. */
const URL_ATTRIBUTES = ['url', 'url.full', 'url.query', 'http.url', 'http.query', 'http.target'];

/** Scrub the URL attributes of one span, in place. */
function scrubSpanData(data: SpanData | undefined): void {
	if (data === undefined) return;
	for (const name of URL_ATTRIBUTES) {
		const value = data[name];
		if (isString(value)) data[name] = scrubTokens(value);
	}
}

/** @returns Whether `value` is a string. */
function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * `beforeSend` / `beforeSendTransaction`: drop every token from the URLs of an event (request, transaction
 * name, breadcrumbs, spans), so a verification or reset link never reaches Sentry.
 * @param event - The event or transaction, edited in place.
 * @returns The same event.
 */
export function scrubEventTokens<TEvent extends Event>(event: TEvent): TEvent {
	const { request } = event;
	if (request?.url !== undefined) request.url = scrubTokens(request.url);
	if (isString(request?.query_string)) request.query_string = scrubTokens(request.query_string);
	else if (request?.query_string !== undefined) request.query_string = FILTERED;
	if (event.transaction !== undefined) event.transaction = scrubTokens(event.transaction);
	for (const breadcrumb of event.breadcrumbs ?? []) {
		if (breadcrumb.message !== undefined) breadcrumb.message = scrubTokens(breadcrumb.message);
		scrubSpanData(breadcrumb.data);
		for (const name of ['from', 'to']) {
			const value = breadcrumb.data?.[name];
			if (breadcrumb.data !== undefined && isString(value)) breadcrumb.data[name] = scrubTokens(value);
		}
	}
	for (const span of event.spans ?? []) {
		span.description = span.description === undefined ? undefined : scrubTokens(span.description);
		scrubSpanData(span.data);
	}
	scrubSpanData(event.contexts?.trace?.data);
	return event;
}

/**
 * What the SDK collects. Sentry 11 dropped `sendDefaultPii` and collects cookies, bodies, headers and the
 * user's IP unless told otherwise: the privacy policy promises errors without IP address nor typed content.
 */
export const SENTRY_DATA_COLLECTION = {
	userInfo: false,
	cookies: false,
	httpHeaders: { request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }, response: false },
	httpBodies: [],
	urlQueryParams: { deny: ['token'] },
	databaseQueryData: false,
	stackFrameVariables: false,
} satisfies SentryInitOptions['dataCollection'];

/**
 * Shared SDK options: no personal data, env-driven light tracing, tokens scrubbed from every URL.
 * @param tracesSampleRate - Rate in `[0, 1]`, read from the env by the caller.
 * @returns The options both SDKs pass to `Sentry.init` besides the DSN.
 */
export function sentryOptions(tracesSampleRate: number) {
	return {
		dataCollection: SENTRY_DATA_COLLECTION,
		environment: 'production',
		tracesSampler: createTracesSampler(tracesSampleRate),
		beforeSend: scrubEventTokens,
		beforeSendTransaction: scrubEventTokens,
	} satisfies SentryInitOptions;
}
