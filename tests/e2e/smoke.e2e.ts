import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { E2E_BASE_URL } from './isolation';
import { AUTH_WORK_MS, outboxLink, uniqueId } from './support';

test('the health probe reports the database', async () => {
	const response = await fetch(`${E2E_BASE_URL}/api/health`);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ status: 'ok', db: 'ok' });
});

test('the home page and the legal pages render', async ({ app, screen }) => {
	await app.open('/');
	await expect(screen.getByRole('heading', { level: 1, name: 'Mon produit' })).toBeVisible();
	await screen.getByRole('link', 'Mentions légales').tap();
	await expect(screen.getByText(/Hetzner Online GmbH/).first()).toBeVisible();
	await screen.getByRole('link', 'Confidentialité').tap();
	await expect(
		screen.getByRole('heading', { level: 1, name: 'Politique de confidentialité' }),
	).toBeVisible();
});

test('the dashboard redirects a visitor to sign-in', async ({ app, browser }) => {
	await app.open('/dashboard');
	await expect(browser).toHaveURL(/\/sign-in$/);
});

test('sign-up, e-mail verification, sign-out and sign-in reach the dashboard', async ({
	app,
	screen,
	browser,
}) => {
	const email = `e2e-${uniqueId()}@example.test`;
	const password = 'e2e-password-123';

	await app.open('/sign-up');
	await screen.getByLabel('Nom').fill('Ada Test');
	await screen.getByLabel('E-mail').fill(email);
	await screen.getByLabel(/Mot de passe/).fill(password);
	const create = screen.getByRole('button', 'Créer mon compte');
	await expect(create).toBeEnabled({ timeout: AUTH_WORK_MS });
	await create.tap();
	await expect(screen.getByText('Vérifiez vos e-mails')).toBeVisible({ timeout: AUTH_WORK_MS });

	await app.open(await outboxLink(email, 'Confirmez votre adresse e-mail'));
	await expect(browser).toHaveURL(/\/dashboard$/, { timeout: AUTH_WORK_MS });
	await expect(screen.getByRole('heading', { level: 1, name: 'Bonjour Ada Test' })).toBeVisible();

	await screen.getByRole('button', 'Se déconnecter').tap();
	await expect(browser).toHaveURL(/\/sign-in$/, { timeout: AUTH_WORK_MS });

	await screen.getByLabel('E-mail').fill(email);
	await screen.getByLabel('Mot de passe').fill(password);
	const signIn = screen.getByRole('button', 'Se connecter');
	await expect(signIn).toBeEnabled({ timeout: AUTH_WORK_MS });
	await signIn.tap();
	await expect(browser).toHaveURL(/\/dashboard$/, { timeout: AUTH_WORK_MS });
});

test('an auth call without a Turnstile token is refused', async () => {
	const response = await fetch(`${E2E_BASE_URL}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: E2E_BASE_URL },
		body: JSON.stringify({ email: 'nobody@example.test', password: 'whatever-123' }),
	});
	expect(response.status).toBe(400);
});

test('crawlers get robots.txt and a sitemap of the public pages', async () => {
	const robots = await fetch(`${E2E_BASE_URL}/robots.txt`);
	expect(robots.status).toBe(200);
	expect(await robots.text()).toContain(`Sitemap: ${E2E_BASE_URL}/sitemap.xml`);

	const sitemap = await fetch(`${E2E_BASE_URL}/sitemap.xml`);
	expect(sitemap.status).toBe(200);
	expect(sitemap.headers.get('content-type')).toContain('application/xml');
	const xml = await sitemap.text();
	expect(xml).toContain(`<loc>${E2E_BASE_URL}/mentions-legales</loc>`);
	expect(xml).not.toContain('/dashboard');
});

test('a public page is edge-cacheable and shareable, an app page is private', async () => {
	const home = await fetch(`${E2E_BASE_URL}/`);
	expect(home.headers.get('cdn-cache-control')).toContain('max-age=');
	const html = await home.text();
	expect(html).toContain(`<link rel="canonical" href="${E2E_BASE_URL}/"`);
	expect(html).toMatch(/<meta property="og:image" content="[^"]+\/og-image\.png"/);
	expect((await fetch(`${E2E_BASE_URL}/og-image.png`)).status).toBe(200);

	const signedIn = await fetch(`${E2E_BASE_URL}/`, {
		headers: { cookie: 'better-auth.session_token=forged' },
	});
	expect(signedIn.headers.get('cache-control')).toBe('private, no-store');
	expect(signedIn.headers.get('cdn-cache-control')).toBeNull();

	const signIn = await fetch(`${E2E_BASE_URL}/sign-in`);
	expect(signIn.headers.get('cache-control')).toBe('private, no-store');
	expect(await signIn.text()).not.toContain('rel="canonical"');
});
