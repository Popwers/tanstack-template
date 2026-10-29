import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { E2E_BASE_URL } from './isolation';
import { OUTAGE_TOKEN, REJECTED_TOKEN } from './siteverify';
import { AUTH_WORK_MS } from './support';

/**
 * Post to an auth endpoint as the browser would, with the given Turnstile token.
 * @param path - Endpoint below `/api/auth`.
 * @param token - Value of `x-captcha-response`.
 * @param body - JSON body.
 * @returns The response.
 */
function postAuth(path: string, token: string, body: Record<string, string>): Promise<Response> {
	return fetch(`${E2E_BASE_URL}/api/auth${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: E2E_BASE_URL, 'x-captcha-response': token },
		body: JSON.stringify(body),
	});
}

test('a token siteverify rejects is refused with 403', async () => {
	const response = await postAuth('/sign-in/email', REJECTED_TOKEN, {
		email: 'nobody@example.test',
		password: 'whatever-123',
	});
	expect(response.status).toBe(403);
	expect(await response.json()).toMatchObject({ code: 'VERIFICATION_FAILED' });
});

test('siteverify down answers 503, never 500', async () => {
	const response = await postAuth('/request-password-reset', OUTAGE_TOKEN, {
		email: 'nobody@example.test',
		redirectTo: '/reset-password',
	});
	expect(response.status).toBe(503);
	expect(response.headers.get('retry-after')).toBe('30');
	expect(await response.json()).toMatchObject({ code: 'CAPTCHA_UNAVAILABLE' });
});

test('the form says so when siteverify is down', async ({ app, screen, browser }) => {
	// The widget's token is swapped for the one the stand-in answers as an outage.
	await browser.route('**/api/auth/request-password-reset', async (route) => {
		await route.continue({ headers: { ...route.request.headers, 'x-captcha-response': OUTAGE_TOKEN } });
	});
	await app.open('/forgot-password');
	await screen.getByLabel('E-mail').fill('nobody@example.test');
	const submit = screen.getByRole('button', /Envoyer/);
	await expect(submit).toBeEnabled({ timeout: AUTH_WORK_MS });
	await submit.tap();
	await expect(screen.getByText(/anti-robot est momentanément indisponible/)).toBeVisible({
		timeout: AUTH_WORK_MS,
	});
});

test('the verification e-mail can be resent 5 times per hour per IP', async () => {
	const resend = () =>
		fetch(`${E2E_BASE_URL}/api/auth/send-verification-email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: E2E_BASE_URL },
			body: JSON.stringify({ email: 'nobody@example.test' }),
		});
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		expect((await resend()).status).not.toBe(429);
	}
	const blocked = await resend();
	expect(blocked.status).toBe(429);
	expect(Number(blocked.headers.get('x-retry-after'))).toBeGreaterThan(3500);
});
