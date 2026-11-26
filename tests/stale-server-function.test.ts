import { describe, expect, it } from 'vite-plus/test';

import { isMissingServerFunction } from '#/lib/middleware/stale-server-function';

/**
 * Failure modes: any server-function error is turned into a 404 (a real failure hidden), the message Start
 * throws is no longer matched after a Start upgrade (the stale tab ends on an error screen and in Sentry
 * again). Whether the request is a server function is Start's own `handlerType`, not a path test here.
 */
describe('isMissingServerFunction', () => {
	it('matches the error Start throws for an unknown id', () => {
		expect(
			isMissingServerFunction(new Error('Server function info not found for eyJmaWxlIjoiL3NyYy9saWIv')),
		).toBe(true);
	});

	it('ignores another failure of a server function', () => {
		expect(isMissingServerFunction(new Error('relation "users" does not exist'))).toBe(false);
		expect(isMissingServerFunction(new Error('Server function module not resolved for abc'))).toBe(false);
	});
});
