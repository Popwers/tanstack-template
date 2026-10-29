import { defineTask } from 'nitro/task';

import { db } from '#/lib/db';
import { purgeExpiredData } from '#/lib/server/retention-purge';

/** Daily purge of the expired personal data, scheduled by `scheduledTasks` in `vite.config.ts`. */
export default defineTask({
	meta: {
		name: 'purge:retention',
		description: 'Delete expired sessions and tokens, and rate-limit rows idle for 24 hours',
	},
	run: async () => {
		const deleted = await purgeExpiredData(db);
		console.info(
			`[purge:retention] deleted ${deleted.sessions} sessions, ${deleted.verifications} tokens, ${deleted.rateLimits} rate-limit rows`,
		);
		return { result: deleted };
	},
});
