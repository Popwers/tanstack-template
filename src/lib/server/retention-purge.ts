import { lt } from 'drizzle-orm';

import type { db } from '#/lib/db';
import { rateLimit, session, verification } from '#/lib/db/schema';
import { RATE_LIMIT_RETENTION_HOURS } from '#/lib/retention';

/** Drizzle database: the app pool, or a test connection. */
export type Database = typeof db;

/** Rows deleted by one purge, per table. */
export interface PurgeReport {
	sessions: number;
	verifications: number;
	rateLimits: number;
}

/**
 * Delete what the privacy policy says is gone: sessions past their expiry (with their IP address and
 * browser), expired e-mail verification and reset tokens, and rate-limit counters idle for
 * {@link RATE_LIMIT_RETENTION_HOURS} hours. Better Auth only deletes an expired session when someone
 * presents it, and a rate-limit row when another key rolls over. Run daily by `purge:retention`.
 * @param database - Drizzle database.
 * @param now - Current time (`rateLimit.lastRequest` is epoch milliseconds).
 * @returns The number of deleted rows per table.
 */
export async function purgeExpiredData(database: Database, now: Date = new Date()): Promise<PurgeReport> {
	const rateLimitCutoff = now.getTime() - RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000;
	const [sessions, verifications, rateLimits] = await Promise.all([
		database.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id }),
		database
			.delete(verification)
			.where(lt(verification.expiresAt, now))
			.returning({ id: verification.id }),
		database
			.delete(rateLimit)
			.where(lt(rateLimit.lastRequest, rateLimitCutoff))
			.returning({ id: rateLimit.id }),
	]);
	return { sessions: sessions.length, verifications: verifications.length, rateLimits: rateLimits.length };
}
