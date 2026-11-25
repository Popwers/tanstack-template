import { describe, expect, it } from 'vite-plus/test';

import { actionEmail } from '#/lib/server/email';

/**
 * Failure modes covered:
 * - text placed in the e-mail (a user's name, say) is read as markup by the mail client;
 * - a `"` in the link ends the `href` attribute and adds attributes of its own;
 * - escaping breaks the link: the HTML `href` must decode to the URL, the text part must keep it as is.
 */

const MARKUP = '<img src=x onerror=alert(1)><a href="https://evil.example">Ada</a>';
const URL_WITH_QUERY = 'https://app.example/verify-email?token=abc&callbackURL=%2Fdashboard';

describe('actionEmail', () => {
	it('shows markup in the title, body and label as text', () => {
		const { html } = actionEmail(MARKUP, MARKUP, { label: MARKUP, url: URL_WITH_QUERY });
		expect(html).not.toContain('<img');
		expect(html).not.toContain('https://evil.example">');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('keeps a quote in the link inside the href attribute', () => {
		const { html } = actionEmail('Title', 'Body', {
			label: 'Go',
			url: 'https://app.example/" onmouseover="alert(1)',
		});
		expect(html).not.toContain('" onmouseover="');
		expect(html).toContain('href="https://app.example/&quot; onmouseover=&quot;alert(1)"');
	});

	it('writes the link as an HTML-encoded href and as plain text', () => {
		const { html, text } = actionEmail('Title', 'Body', { label: 'Go', url: URL_WITH_QUERY });
		expect(html).toContain(`href="${URL_WITH_QUERY.replaceAll('&', '&amp;')}"`);
		expect(text).toContain(`Go : ${URL_WITH_QUERY}`);
	});
});
