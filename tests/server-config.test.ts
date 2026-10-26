import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { resetEnvCache } from '#/lib/server/env';
import { assertSafeKey } from '#/lib/server/storage';
import { TURNSTILE_TEST_KEYS, turnstileKeys } from '#/lib/server/turnstile';

/**
 * Failure modes covered:
 * - a storage key that escapes STORAGE_DIR (traversal, absolute, empty segment) reaches the disk;
 * - production boots with no Turnstile keys, or with half a pair, leaving auth forms unprotected;
 * - dev falls over without Turnstile keys instead of using Cloudflare's test pair.
 */

afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvCache();
});

/** Stub the env and drop the memoised copy. */
function stubEnv(values: Record<string, string>): void {
	vi.stubEnv('DATABASE_URL', 'postgres://test@localhost/test');
	for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
	resetEnvCache();
}

describe('assertSafeKey', () => {
	it.each(['avatars/user-1.png', 'exports/2026/report_1.pdf', 'file'])('accepts %s', (key) => {
		expect(assertSafeKey(key)).toBe(key);
	});

	it.each(['../etc/passwd', '/abs/path', 'a//b', 'a/./b', 'a/../b', '', 'a/b.tar.gz', 'a\\b'])(
		'refuses %s',
		(key) => {
			expect(() => assertSafeKey(key)).toThrow('INVALID_STORAGE_PATH');
		},
	);
});

describe('turnstileKeys', () => {
	it('falls back on the test pair outside production', () => {
		stubEnv({ NODE_ENV: 'development', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
		expect(turnstileKeys()).toEqual(TURNSTILE_TEST_KEYS);
	});

	it('refuses to run production without keys', () => {
		stubEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
		expect(() => turnstileKeys()).toThrow(/must both be set/);
	});

	it('refuses half a pair in any environment', () => {
		stubEnv({ NODE_ENV: 'development', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: '' });
		expect(() => turnstileKeys()).toThrow(/must both be set/);
	});

	it('returns the configured pair', () => {
		stubEnv({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' });
		expect(turnstileKeys()).toEqual({ siteKey: 'site', secretKey: 'secret' });
	});
});
