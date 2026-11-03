import { afterAll, vi } from 'vite-plus/test';

import { resetEnvCache } from '#/lib/server/env';

// Without isolation a worker runs several files on one module registry: what a file stubbed, mocked
// or cached (the parsed environment, fake timers) must not reach the next one. Registered before the
// file's own hooks, so this runs after its teardown.
afterAll(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	resetEnvCache();
	vi.resetModules();
});
