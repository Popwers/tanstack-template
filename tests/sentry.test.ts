import type { Event } from '@sentry/tanstackstart-react';
import { describe, expect, it } from 'vite-plus/test';

import {
	createTracesSampler,
	DEFAULT_TRACES_SAMPLE_RATE,
	parseTracesSampleRate,
	scrubEventTokens,
	scrubTokens,
} from '#/lib/sentry';

/**
 * Failure modes covered:
 * - a verification or reset token reaches Sentry through a query param (`?token=`), the reset link's
 *   path segment, or any of the event's URL carriers (request, transaction, breadcrumbs, spans, trace);
 * - scrubbing mangles the rest of the URL (other params, the path);
 * - a blank or malformed `SENTRY_TRACES_SAMPLE_RATE` raises the rate above the shared quota, or NaN;
 * - health probes are traced, or a parent's sampling decision is overridden.
 */

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-token-value';

describe('scrubTokens', () => {
	it.each([
		[
			`https://app.test/api/auth/verify-email?token=${TOKEN}&callbackURL=%2Fdashboard`,
			'https://app.test/api/auth/verify-email?token=[Filtered]&callbackURL=%2Fdashboard',
		],
		[`/reset-password?token=${TOKEN}`, '/reset-password?token=[Filtered]'],
		[
			`/api/auth/reset-password/${TOKEN}?callbackURL=%2Freset-password`,
			'/api/auth/reset-password/[Filtered]?callbackURL=%2Freset-password',
		],
		[`token=${TOKEN}&page=2`, 'token=[Filtered]&page=2'],
		[
			`/cb?access_token=${TOKEN}#refreshToken=${TOKEN}`,
			'/cb?access_token=[Filtered]#refreshToken=[Filtered]',
		],
		['/dashboard?page=2', '/dashboard?page=2'],
	])('scrubs %s', (input, expected) => {
		expect(scrubTokens(input)).toBe(expected);
	});
});

describe('scrubEventTokens', () => {
	it('removes the token from every URL an event carries', () => {
		const url = `https://app.test/reset-password?token=${TOKEN}`;
		const event: Event = {
			transaction: `/reset-password?token=${TOKEN}`,
			request: { url, query_string: `token=${TOKEN}` },
			breadcrumbs: [
				{ category: 'navigation', data: { from: '/', to: `/reset-password?token=${TOKEN}` } },
				{ category: 'fetch', message: `GET ${url}`, data: { url } },
			],
			spans: [
				{
					span_id: '1',
					trace_id: '2',
					start_timestamp: 0,
					status: 'ok',
					description: `GET ${url}`,
					data: { 'url.full': url, 'url.query': `?token=${TOKEN}`, 'http.method': 'GET' },
				},
			],
			contexts: { trace: { span_id: '1', trace_id: '2', data: { 'http.url': url } } },
		};
		const scrubbed = JSON.stringify(scrubEventTokens(event));
		expect(scrubbed).not.toContain(TOKEN);
		expect(scrubbed).toContain('/reset-password?token=[Filtered]');
		expect(scrubbed).toContain('"http.method":"GET"');
	});

	it('drops a structured query string whole', () => {
		const event: Event = { request: { query_string: [['token', TOKEN]] } };
		expect(scrubEventTokens(event).request?.query_string).toBe('[Filtered]');
	});
});

describe('parseTracesSampleRate', () => {
	it.each([
		[undefined, DEFAULT_TRACES_SAMPLE_RATE],
		['', DEFAULT_TRACES_SAMPLE_RATE],
		['abc', DEFAULT_TRACES_SAMPLE_RATE],
		['1.5', DEFAULT_TRACES_SAMPLE_RATE],
		['-0.1', DEFAULT_TRACES_SAMPLE_RATE],
		['0.05', 0.05],
		['0', 0],
	])('reads %s as %s', (value, rate) => {
		expect(parseTracesSampleRate(value)).toBe(rate);
	});
});

describe('createTracesSampler', () => {
	const sample = createTracesSampler(0.1);

	it('never traces the health probe', () => {
		expect(
			sample({ name: 'GET', attributes: { 'url.path': '/api/health' }, parentSampled: undefined }),
		).toBe(0);
		expect(sample({ name: 'GET /api/health', attributes: {}, parentSampled: true })).toBe(0);
	});

	it("inherits the parent's decision", () => {
		expect(sample({ name: 'GET /', attributes: {}, parentSampled: true })).toBe(true);
		expect(sample({ name: 'GET /', attributes: {}, parentSampled: false })).toBe(false);
	});

	it('samples other traces at the configured rate', () => {
		expect(sample({ name: 'GET /dashboard', attributes: {}, parentSampled: undefined })).toBe(0.1);
	});
});
