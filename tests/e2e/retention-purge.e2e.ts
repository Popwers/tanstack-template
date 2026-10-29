import { test } from '@e2e-dev/web';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { expect } from 'e2e';
import postgres from 'postgres';

import * as schema from '#/lib/db/schema';
import { rateLimit, session, user, verification } from '#/lib/db/schema';
import { DAY_MS, RATE_LIMIT_RETENTION_HOURS } from '#/lib/retention';
import { purgeExpiredData } from '#/lib/server/retention-purge';

import { E2E_BASE_URL, E2E_DB_PORT } from './isolation';
import { uniqueId } from './support';

/** The throwaway database `serve.sh` migrates (`e2e.config.ts` gives the app the same URL). */
const DATABASE_URL = `postgres://app:app@127.0.0.1:${E2E_DB_PORT}/app`;

const HOUR_MS = 60 * 60 * 1000;

// `purge:retention` runs this every night: what the privacy policy says is gone must be gone.
test('the retention purge deletes expired sessions, tokens and idle counters, and nothing else', async () => {
	// The app is up, hence the database is migrated.
	expect((await fetch(`${E2E_BASE_URL}/api/health`)).status).toBe(200);
	const client = postgres(DATABASE_URL, { max: 1, prepare: false });
	const database = drizzle(client, { schema });
	const id = uniqueId();
	const now = new Date();
	const ago = (ms: number) => new Date(now.getTime() - ms);
	const later = (ms: number) => new Date(now.getTime() + ms);
	const userId = `e2e-purge-${id}`;
	try {
		await database.insert(user).values({ id: userId, name: 'Purge', email: `${userId}@example.test` });
		await database.insert(session).values([
			{
				id: `${userId}-expired`,
				token: `${userId}-expired`,
				userId,
				expiresAt: ago(1000),
				updatedAt: ago(DAY_MS),
			},
			{
				id: `${userId}-live`,
				token: `${userId}-live`,
				userId,
				expiresAt: later(DAY_MS),
				updatedAt: now,
			},
		]);
		await database.insert(verification).values([
			{ id: `${userId}-expired`, identifier: userId, value: 'x', expiresAt: ago(1000) },
			{ id: `${userId}-live`, identifier: userId, value: 'x', expiresAt: later(HOUR_MS) },
		]);
		const retentionMs = RATE_LIMIT_RETENTION_HOURS * HOUR_MS;
		await database.insert(rateLimit).values([
			{
				id: `${userId}-idle`,
				key: `${userId}|idle`,
				count: 3,
				lastRequest: now.getTime() - retentionMs - 1,
			},
			{
				id: `${userId}-recent`,
				key: `${userId}|recent`,
				count: 3,
				lastRequest: now.getTime() - retentionMs + HOUR_MS,
			},
		]);

		const deleted = await purgeExpiredData(database, now);
		expect(deleted.sessions).toBeGreaterThanOrEqual(1);
		expect(deleted.verifications).toBeGreaterThanOrEqual(1);
		expect(deleted.rateLimits).toBeGreaterThanOrEqual(1);

		const sessions = await database
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, userId));
		expect(sessions.map((row) => row.id)).toEqual([`${userId}-live`]);
		const tokens = await database
			.select({ id: verification.id })
			.from(verification)
			.where(eq(verification.identifier, userId));
		expect(tokens.map((row) => row.id)).toEqual([`${userId}-live`]);
		const counters = await database
			.select({ id: rateLimit.id })
			.from(rateLimit)
			.where(inArray(rateLimit.id, [`${userId}-idle`, `${userId}-recent`]));
		expect(counters.map((row) => row.id)).toEqual([`${userId}-recent`]);
	} finally {
		await database.delete(rateLimit).where(inArray(rateLimit.id, [`${userId}-idle`, `${userId}-recent`]));
		await database.delete(verification).where(eq(verification.identifier, userId));
		await database.delete(user).where(eq(user.id, userId));
		await client.end();
	}
});
