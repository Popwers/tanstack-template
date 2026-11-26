import * as Sentry from '@sentry/tanstackstart-react';
import { definePlugin } from 'nitro';

import { drainBackgroundTasks } from '#/lib/server/background';

/**
 * Once the server stops taking requests (SIGTERM on a redeploy), wait for the background work (the
 * auth e-mails), then exit. The daily task's timer keeps the process alive after the server closes,
 * so without the exit the container waits to be killed, and a send still running is cut short.
 */
export default definePlugin((nitroApp) => {
	nitroApp.hooks.hook('close', async () => {
		await drainBackgroundTasks();
		if (!import.meta.env.PROD) return;
		await Sentry.flush(2000);
		process.exit(0);
	});
});
