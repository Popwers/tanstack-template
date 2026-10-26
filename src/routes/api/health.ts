import { createFileRoute } from '@tanstack/react-router';
import { sql } from 'drizzle-orm';

import { db } from '#/lib/db';

/** JSON response helper. */
function json(body: { status: string; db: string }, status: number): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Liveness/readiness probe used by Docker HEALTHCHECK, Coolify and e2e: 200 when Postgres answers
 * `SELECT 1`, 503 otherwise.
 */
export const Route = createFileRoute('/api/health')({
	server: {
		handlers: {
			GET: async () => {
				try {
					await db.execute(sql`SELECT 1`);
					return json({ status: 'ok', db: 'ok' }, 200);
				} catch (error) {
					console.error('health probe: database unreachable', error);
					return json({ status: 'degraded', db: 'error' }, 503);
				}
			},
		},
	},
});
