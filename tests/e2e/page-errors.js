// Init script (`e2e.config.ts` `initScripts`): records page failures in sessionStorage, so they
// survive navigations until `fixtures.ts` reads them after the test. It records `console.error`,
// uncaught errors and rejections, same-origin element load failures, same-origin HTTP >= 400
// responses and CSP violations (what Chromium logs as console errors under Playwright), with the
// call stack of any Error among them.
(() => {
	const key = '__e2ePageErrors';
	// The call stack of an Error, on the lines after the message, so the report shows its origin.
	const stackOf = (value) => (value instanceof Error && value.stack ? `\n${value.stack}` : '');
	const record = (message, error) => {
		try {
			const list = JSON.parse(sessionStorage.getItem(key) ?? '[]');
			list.push(`${message} (${location.pathname})${stackOf(error)}`);
			sessionStorage.setItem(key, JSON.stringify(list));
		} catch {
			// Storage is unavailable on opaque origins such as about:blank.
		}
	};
	const isSameOrigin = (url) => {
		try {
			return new URL(url, location.href).origin === location.origin;
		} catch {
			return false;
		}
	};
	const original = console.error.bind(console);
	console.error = (...args) => {
		record(
			args.map(String).join(' '),
			args.find((arg) => arg instanceof Error),
		);
		original(...args);
	};
	addEventListener(
		'error',
		(event) => {
			if (event.target === window) {
				record(event.message, event.error);
				return;
			}
			const url = event.target?.currentSrc || event.target?.src || event.target?.href;
			if (url && isSameOrigin(url)) record(`resource failed: ${url}`);
		},
		true,
	);
	addEventListener('unhandledrejection', (event) => record(String(event.reason), event.reason));
	addEventListener('securitypolicyviolation', (event) => {
		record(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
	});
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			if (entry.responseStatus >= 400 && isSameOrigin(entry.name)) {
				record(`status ${entry.responseStatus}: ${entry.name}`);
			}
		}
	}).observe({ type: 'resource', buffered: true });
})();
