#!/usr/bin/env bun
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Apply pending Drizzle migrations from ./drizzle, then exit. The Docker entrypoint runs it before the
 * server on every boot; Drizzle's journal makes it idempotent. Bundled into a standalone .mjs at build.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not defined. Set it in the deployment environment.');

// Single serial connection so the process exits cleanly.
const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

try {
	await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
	console.log('✓ Migrations applied.');
} finally {
	await sql.end();
}
