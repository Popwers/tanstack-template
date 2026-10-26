import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '#/lib/server/env';

import * as schema from './schema';

// `prepare: false` keeps prepared statements off, required behind poolers.
const client = postgres(env().DATABASE_URL, {
	max: env().DATABASE_POOL_MAX,
	idle_timeout: 20,
	prepare: false,
});

export const db = drizzle(client, { schema });
export { schema };
