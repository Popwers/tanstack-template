import { describe, expect, it } from 'vite-plus/test';

import { isMissingServerFunction } from '#/lib/middleware/stale-server-function';

/**
 * Failure modes: any server-function error is turned into a 404 (a real failure hidden), the missing id of
 * an ordinary route request is answered like a stale tab, the message Start throws is no longer matched
 * after a Start upgrade (the stale tab ends on an error screen and in Sentry again).
 */
describe('isMissingServerFunction', () => {
	const missing = new Error('Server function info not found for eyJmaWxlIjoiL3NyYy9saWIv');

	it('matches the error Start throws for an unknown id on a server-function path', () => {
		expect(isMissingServerFunction('/_serverFn/eyJmaWxlIjoiL3NyYy9saWIv', missing)).toBe(true);
	});

	it('ignores another failure of a server function', () => {
		expect(isMissingServerFunction('/_serverFn/abc', new Error('relation "users" does not exist'))).toBe(
			false,
		);
		expect(
			isMissingServerFunction('/_serverFn/abc', new Error('Server function module not resolved')),
		).toBe(false);
	});

	it('ignores the same message outside the server-function path', () => {
		expect(isMissingServerFunction('/dashboard', missing)).toBe(false);
	});
});
