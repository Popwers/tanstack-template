import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Resend } from 'resend';

import { env } from '#/lib/server/env';

/** One transactional e-mail. */
export interface OutgoingEmail {
	to: string;
	subject: string;
	html: string;
	text: string;
}

/** Where an e-mail went. */
export type EmailTransport = 'resend' | 'mailpit' | 'outbox';

/**
 * Send an e-mail. Priority: Resend (`RESEND_API_KEY`) → Mailpit (`MAILPIT_URL`, local dev) →
 * a JSON file in `{STORAGE_DIR}/_outbox` (tests, e2e), so every environment works without an account.
 * @param email - The message.
 * @returns The transport used.
 * @throws Error when Resend or Mailpit refuses the message.
 */
export async function sendEmail(email: OutgoingEmail): Promise<EmailTransport> {
	const { RESEND_API_KEY, MAILPIT_URL, EMAIL_FROM, EMAIL_REPLY_TO, STORAGE_DIR } = env();
	if (RESEND_API_KEY) {
		const { error } = await new Resend(RESEND_API_KEY).emails.send({
			from: EMAIL_FROM,
			replyTo: EMAIL_REPLY_TO,
			...email,
		});
		if (error) throw new Error(`RESEND_FAILED: ${error.message}`);
		return 'resend';
	}
	if (MAILPIT_URL) {
		const response = await fetch(`${MAILPIT_URL.replace(/\/+$/, '')}/api/v1/send`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				From: { Email: EMAIL_FROM.replace(/^.*<|>.*$/g, '') },
				To: [{ Email: email.to }],
				Subject: email.subject,
				HTML: email.html,
				Text: email.text,
			}),
		});
		if (!response.ok) throw new Error(`MAILPIT_FAILED: ${response.status}`);
		return 'mailpit';
	}
	const outbox = path.resolve(process.cwd(), STORAGE_DIR, '_outbox');
	await mkdir(outbox, { recursive: true });
	const file = `${Date.now()}-${email.to.replace(/[^a-z0-9]/gi, '_')}.json`;
	await writeFile(path.join(outbox, file), JSON.stringify(email, null, '\t'));
	return 'outbox';
}

/**
 * Minimal branded layout for the auth e-mails.
 * @param title - Heading.
 * @param body - One paragraph of text.
 * @param action - Button label and URL.
 * @returns HTML and text bodies.
 */
export function actionEmail(
	title: string,
	body: string,
	action: { label: string; url: string },
): Pick<OutgoingEmail, 'html' | 'text'> {
	const html = `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
<h1 style="font-size:20px">${title}</h1><p>${body}</p>
<p><a href="${action.url}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${action.label}</a></p>
<p style="color:#666;font-size:12px">Si le bouton ne fonctionne pas : ${action.url}</p></body></html>`;
	return { html, text: `${title}\n\n${body}\n\n${action.label} : ${action.url}` };
}
