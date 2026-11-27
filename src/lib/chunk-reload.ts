/**
 * A visitor can hold HTML (a tab left open across a deployment, or Cloudflare's copy) that names hashed
 * files a newer build replaced: the file answers 404 and the page would end on the error screen. The same
 * tab can also call a server function whose id the new build no longer has. The browser then reloads the
 * page it was opening once, with a query the edge has no copy of, so the HTML comes from the server and
 * names the files and functions that exist. A reload that did not help is not repeated: it would loop on
 * a real outage.
 */

/** Query added to the reloaded address; removed again once the page is up. */
export const RELOAD_PARAM = '_r';

/** Session key holding when the last such reload happened. */
export const RELOAD_STORAGE_KEY = 'chunk-reload-at';

/** A second reload within this long is refused: the first did not fix it. */
export const RELOAD_COOLDOWN_MS = 10 * 60_000;

const chunkFailureMessage =
	/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** What the client throws when the server answers a call to a function id its build does not have. */
export const MISSING_SERVER_FUNCTION_MESSAGE = 'Server function info not found';

/**
 * Whether an error message is a hashed file that could not be loaded.
 * @param message - An error's message.
 * @returns `true` for the messages Chrome, Firefox, Safari and Vite give.
 */
export function isChunkLoadMessage(message: string): boolean {
	return chunkFailureMessage.test(message);
}

/**
 * Whether an error message is a server function the running build does not have.
 * @param message - An error's message.
 * @returns `true` for the text the server answers (`MISSING_SERVER_FUNCTION_MESSAGE`).
 */
export function isMissingServerFunctionMessage(message: string): boolean {
	return message.includes(MISSING_SERVER_FUNCTION_MESSAGE);
}

/**
 * Whether an error comes from a page that is older than the running build.
 * @param error - An error a boundary or a call rejected with.
 * @returns `true` for a failed hashed file or a missing server function.
 */
export function isStaleBuildError(error: Error): boolean {
	return isChunkLoadMessage(error.message) || isMissingServerFunctionMessage(error.message);
}

/** The browser pieces {@link reloadOnce} uses, injectable for tests. */
export interface ReloadEnvironment {
	href: string;
	now: () => number;
	storage: Pick<Storage, 'getItem' | 'setItem'>;
	replace: (url: string) => void;
}

/**
 * Reload the page with a fresh query, unless one already did within {@link RELOAD_COOLDOWN_MS}.
 * @param environment - Address, clock, session storage and navigation.
 * @returns `true` when the reload was started.
 */
export function reloadOnce(environment: ReloadEnvironment): boolean {
	const now = environment.now();
	try {
		const last = Number(environment.storage.getItem(RELOAD_STORAGE_KEY));
		if (Number.isFinite(last) && last > 0 && now - last < RELOAD_COOLDOWN_MS) {
			return false;
		}
		environment.storage.setItem(RELOAD_STORAGE_KEY, String(now));
	} catch {
		return false;
	}
	const url = new URL(environment.href);
	url.searchParams.set(RELOAD_PARAM, String(now));
	environment.replace(url.href);
	return true;
}

/**
 * The address without {@link RELOAD_PARAM}.
 * @param href - The current address.
 * @returns The cleaned address, or `null` when it has no such parameter.
 */
export function withoutReloadParam(href: string): string | null {
	const url = new URL(href);
	if (!url.searchParams.has(RELOAD_PARAM)) {
		return null;
	}
	url.searchParams.delete(RELOAD_PARAM);
	return url.href;
}

/**
 * Where the visitor is going: the page a navigation in progress opens, else the current one. The router's
 * `latestLocation` follows the history at once, while `state.location` only moves once the navigation has
 * started loading, which a file that fails fast can beat.
 */
function destinationHref(): string {
	const pending = window.__TSR_ROUTER__?.latestLocation.href;
	return pending === undefined ? window.location.href : new URL(pending, window.location.origin).href;
}

function browserEnvironment(): ReloadEnvironment {
	return {
		href: destinationHref(),
		now: () => Date.now(),
		storage: window.sessionStorage,
		replace: (url) => window.location.replace(url),
	};
}

/** Set once this page has started its reload: it is leaving, and nothing else may start a navigation. */
let isReloading = false;

/**
 * Start the reload, or confirm it is already under way. A second failure in the dying page (the click
 * after a hover preload, the router's own plain reload) must not replace the navigation to the fresh
 * address: the latest navigation wins.
 * @returns `true` when this page is reloading.
 */
export function reloadNow(): boolean {
	if (!isReloading) {
		isReloading = reloadOnce(browserEnvironment());
	}
	return isReloading;
}

/**
 * Reload for a router error when it comes from an older build.
 * @param error - The error a route's boundary caught.
 * @returns `true` when a reload was started.
 */
export function reloadForStaleBuild(error: Error): boolean {
	return isStaleBuildError(error) && reloadNow();
}

let removeListeners: (() => void) | undefined;

/**
 * Browser start-up: drop the reload query from the address bar, then reload on Vite's
 * `vite:preloadError` (a hashed file that failed to load) and on a dynamic import that rejected
 * outside Vite's helper. The event's default action, throwing the error to the error screen, stays
 * when no reload is allowed, and is cancelled once one is under way.
 * @returns Removes the listeners; a second call before that returns the same remover.
 */
export function installChunkReload(): () => void {
	if (removeListeners !== undefined) {
		return removeListeners;
	}
	const cleaned = withoutReloadParam(window.location.href);
	if (cleaned !== null) {
		window.history.replaceState(window.history.state, '', cleaned);
	}
	const onPreloadError = (event: Event) => {
		if (reloadNow()) {
			event.preventDefault();
		}
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		const reason = event.reason instanceof Error ? event.reason.message : '';
		if (isChunkLoadMessage(reason)) {
			reloadNow();
		}
	};
	window.addEventListener('vite:preloadError', onPreloadError);
	window.addEventListener('unhandledrejection', onRejection);
	removeListeners = () => {
		window.removeEventListener('vite:preloadError', onPreloadError);
		window.removeEventListener('unhandledrejection', onRejection);
		removeListeners = undefined;
	};
	return removeListeners;
}
