import { createHmac, randomBytes } from 'node:crypto';

import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { E2E_AUTH_SECRET, E2E_BASE_URL } from './isolation';
import { AUTH_WORK_MS, outboxLink, uniqueId } from './support';

/** Session cookie over plain HTTP (production prefixes it with `__Secure-`). */
const SESSION_COOKIE = 'better-auth.session_token';

/** A server-function call the browser made, replayed with other cookies. */
interface ServerFnCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

/** Headers fetch sets itself or that would carry the browser's real session. */
const REPLAY_SKIPPED_HEADERS = new Set(['cookie', 'host', 'content-length', 'connection']);

/**
 * Sign a session token as Better Auth does: `<token>.<base64 HMAC-SHA256>`, URI-encoded.
 * @param token - Session token.
 * @param secret - `BETTER_AUTH_SECRET`.
 * @returns The cookie value.
 */
function signSessionToken(token: string, secret: string): string {
	const signature = createHmac('sha256', secret).update(token).digest('base64');
	return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Replay a server-function call with a `Cookie` header of our own.
 * @param call - The call the browser made.
 * @param cookie - The cookie header to send instead.
 * @returns The response body.
 */
async function replay(call: ServerFnCall, cookie: string): Promise<string> {
	const headers = Object.fromEntries(
		Object.entries(call.headers).filter(([name]) => !REPLAY_SKIPPED_HEADERS.has(name.toLowerCase())),
	);
	const response = await fetch(call.url, {
		method: call.method,
		headers: { ...headers, cookie },
		body: call.body,
	});
	return response.text();
}

/**
 * What the server grants a cookie: the dashboard (server-side route guard) and the session API.
 * @param cookie - The cookie header.
 * @returns The dashboard status and redirect, and the session body.
 */
async function accessWith(cookie: string) {
	const dashboard = await fetch(`${E2E_BASE_URL}/dashboard`, { headers: { cookie }, redirect: 'manual' });
	const session = await fetch(`${E2E_BASE_URL}/api/auth/get-session`, { headers: { cookie } });
	return {
		dashboardStatus: dashboard.status,
		dashboardLocation: dashboard.headers.get('location'),
		session: await session.text(),
	};
}

/**
 * Create a verified account through the API, as the sign-up form would.
 * @param email - Account e-mail.
 * @param password - Account password.
 */
async function createVerifiedAccount(email: string, password: string): Promise<void> {
	const signUp = await fetch(`${E2E_BASE_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: E2E_BASE_URL,
			'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
		},
		body: JSON.stringify({ name: 'Eve Forger', email, password }),
	});
	expect(signUp.status).toBe(200);
	const verify = await fetch(await outboxLink(email, 'Confirmez votre adresse e-mail'), {
		redirect: 'manual',
	});
	expect(verify.status).toBeLessThan(400);
}

test('a forged or revoked session cookie opens neither a protected route nor a server function', async ({
	app,
	screen,
	browser,
}) => {
	const email = `e2e-forgery-${uniqueId()}@example.test`;
	const password = 'e2e-password-123';
	await createVerifiedAccount(email, password);

	// Sign in through the form and record the server-function calls the dashboard guard makes.
	const calls: ServerFnCall[] = [];
	await browser.route('**/_serverFn/**', async (route) => {
		const { url, method, headers, postData } = route.request;
		calls.push({ url, method, headers, body: postData });
		await route.continue();
	});
	await app.open('/sign-in');
	await screen.getByLabel('E-mail').fill(email);
	await screen.getByLabel('Mot de passe').fill(password);
	const signIn = screen.getByRole('button', 'Se connecter');
	await expect(signIn).toBeEnabled({ timeout: AUTH_WORK_MS });
	await signIn.tap();
	await expect(browser).toHaveURL(/\/dashboard$/, { timeout: AUTH_WORK_MS });

	const realValue = (await browser.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)?.value;
	if (realValue === undefined) throw new Error(`no ${SESSION_COOKIE} cookie after sign-in`);
	const realCookie = `${SESSION_COOKIE}=${realValue}`;
	const [realToken = ''] = decodeURIComponent(realValue).split('.');
	// The forgeries below are only meaningful if we sign exactly as Better Auth does.
	expect(signSessionToken(realToken, E2E_AUTH_SECRET)).toBe(realValue);

	// The guard's call is the one that returns the user to the real cookie.
	let sessionCall: ServerFnCall | undefined;
	for (const call of calls) {
		if ((await replay(call, realCookie)).includes(email)) sessionCall = call;
	}
	if (sessionCall === undefined) throw new Error('the dashboard guard made no server-function call');
	expect(await accessWith(realCookie)).toMatchObject({ dashboardStatus: 200 });

	const forgeries = {
		'a random token and signature': `${SESSION_COOKIE}=${randomBytes(24).toString('base64url')}.${randomBytes(32).toString('base64')}`,
		'a well-signed token no session has': `${SESSION_COOKIE}=${signSessionToken(randomBytes(24).toString('base64url'), E2E_AUTH_SECRET)}`,
		'the real token with a tampered signature': `${SESSION_COOKIE}=${encodeURIComponent(`${realToken}.${randomBytes(32).toString('base64')}`)}`,
		'a forged session cache cookie': `better-auth.session_data=${Buffer.from(JSON.stringify({ session: { user: { email } } })).toString('base64url')}`,
	};
	for (const [forgery, cookie] of Object.entries(forgeries)) {
		expect({ forgery, body: await replay(sessionCall, cookie) }).not.toMatchObject({
			body: expect.stringContaining(email),
		});
		expect({ forgery, ...(await accessWith(cookie)) }).toMatchObject({
			forgery,
			dashboardStatus: 307,
			dashboardLocation: expect.stringMatching(/\/sign-in$/),
			session: 'null',
		});
	}

	// Signing out revokes the session at once: the old cookie is worth nothing (no cookie cache).
	await screen.getByRole('button', 'Se déconnecter').tap();
	await expect(browser).toHaveURL(/\/sign-in$/, { timeout: AUTH_WORK_MS });
	expect(await replay(sessionCall, realCookie)).not.toContain(email);
	expect(await accessWith(realCookie)).toMatchObject({ dashboardStatus: 307, session: 'null' });
});
