import { RELOAD_COOLDOWN_MS, RELOAD_PARAM, RELOAD_STATE_KEY, RELOAD_STORAGE_KEY } from '#/lib/chunk-reload';

/**
 * The inline script first in `<head>`, for the one failure no bundled code can catch: HTML that names an
 * entry script, a stylesheet or a module preload the server no longer has (a copy Cloudflare kept across a
 * deployment). Nothing of the bundle runs then, so `chunk-reload.ts` cannot reload. The script reloads the
 * page once to an address the edge has no copy of, with the same query, the same session marker and the same
 * cooldown as `chunk-reload.ts`, and records the start of the shared reloading window (`PageReloadState`):
 * one reload per cooldown whichever of the two starts it, never a loop. Once the bundle runs
 * (`installChunkReload`), the script leaves every failure to it, so a failed hover preload never takes a
 * half-typed form away. It reacts to same-origin `/assets/` scripts and links that fail, and to an `/assets/`
 * file that already answered an error before it ran (React writes the module preloads and stylesheets
 * ahead of the `<head>` children; read from the resource timings where the browser reports the status).
 *
 * Where the edge cache ignores the query string, the reload gets the same copy back: the second failure is
 * refused by the cooldown and the page stays as the server rendered it, readable but inert, until the
 * deployment purge replaces the copy.
 */
export const ENTRY_RECOVERY_SCRIPT = `(function (param, key, cooldown, stateKey) {
	var state = (window[stateKey] = window[stateKey] || {});
	function recover(src) {
		if (!src || state.isBundleRunning || state.startedAt !== undefined) return;
		var asset = new URL(src, location.href);
		if (asset.origin !== location.origin || asset.pathname.indexOf('/assets/') !== 0) return;
		var now = Date.now();
		try {
			var last = Number(sessionStorage.getItem(key));
			if (last > 0 && now - last < cooldown) return;
			sessionStorage.setItem(key, String(now));
		} catch (error) {
			return;
		}
		state.startedAt = now;
		var next = new URL(location.href);
		next.searchParams.set(param, String(now));
		location.replace(next.href);
	}
	addEventListener('error', function (event) {
		var node = event.target;
		recover(node && (node.tagName === 'SCRIPT' ? node.src : node.tagName === 'LINK' ? node.href : ''));
	}, true);
	if (window.performance && performance.getEntriesByType) {
		performance.getEntriesByType('resource').forEach(function (entry) {
			if (entry.responseStatus >= 400) recover(entry.name);
		});
	}
})(${JSON.stringify(RELOAD_PARAM)}, ${JSON.stringify(RELOAD_STORAGE_KEY)}, ${RELOAD_COOLDOWN_MS}, ${JSON.stringify(RELOAD_STATE_KEY)})`;
