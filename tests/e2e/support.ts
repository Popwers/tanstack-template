import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'e2e';

/** `STORAGE_DIR/_outbox` of the server under test (`e2e.config.ts`). */
const OUTBOX_DIR = fileURLToPath(new URL('../../storage/e2e/_outbox', import.meta.url));

/** Time a submit may take on a loaded host: Turnstile script, its check, then password hashing. */
export const AUTH_WORK_MS = 20_000;

/** @returns A unique suffix for test data. */
export function uniqueId(): string {
	return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** One outbox e-mail as `sendEmail` writes it. */
interface OutboxEmail {
	to: string;
	subject: string;
	text: string;
}

/** Read the outbox files addressed to `to`. */
async function emailsTo(to: string): Promise<OutboxEmail[]> {
	const files = await readdir(OUTBOX_DIR).catch(() => []);
	const emails = await Promise.all(
		files.map(async (file): Promise<OutboxEmail> =>
			JSON.parse(await readFile(path.join(OUTBOX_DIR, file), 'utf8')),
		),
	);
	return emails.filter((email) => email.to === to);
}

/**
 * Wait for the e-mail to `to` and return the first link it carries.
 * @param to - Recipient.
 * @param subject - Expected subject.
 * @returns The URL.
 */
export async function outboxLink(to: string, subject: string): Promise<string> {
	let link: string | undefined;
	await expect
		.poll(
			async () => {
				const email = (await emailsTo(to)).find((candidate) => candidate.subject === subject);
				link = email?.text.match(/https?:\/\/\S+/)?.[0];
				return link;
			},
			{ timeout: AUTH_WORK_MS },
		)
		.toBeDefined();
	if (link === undefined) throw new Error(`no link e-mailed to ${to}`);
	return link;
}
