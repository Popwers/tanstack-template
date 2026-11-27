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
	return (
		error instanceof StaleBuildError ||
		isChunkLoadMessage(error.message) ||
		isMissingServerFunctionMessage(error.message)
	);
}

/** What a visitor reads when a save was refused because the page is older than the running build. */
export const STALE_BUILD_MESSAGE =
	'L’application a été mise à jour. Rechargez la page pour continuer : votre saisie n’a pas été enregistrée.';

/** What a visitor reads when a read made outside a navigation (a hover preload, a refetch) was refused. */
export const STALE_BUILD_READ_MESSAGE = 'L’application a été mise à jour. Rechargez la page pour continuer.';

/** Which call met the older build: a read (GET) or a call that changes data. */
export type StaleBuildKind = 'read' | 'save';

/**
 * A call reached a server function the running build no longer has, and the page was not reloaded for
 * it: a save would lose the typed text without a word, a read outside a navigation (a hover preload)
 * would take a half-typed form away. The caller sees this error, and the app shows a notice with a
 * « Recharger » button (`announceStaleBuild`).
 */
export class StaleBuildError extends Error {
	constructor(kind: StaleBuildKind = 'save') {
		super(kind === 'save' ? STALE_BUILD_MESSAGE : STALE_BUILD_READ_MESSAGE);
		this.name = 'StaleBuildError';
	}
}

/** Shows the notice; the app registers it once, with its own notification (toast or banner). */
export type StaleBuildNotifier = (message: string, reload: () => void) => void;

let notifier: StaleBuildNotifier | undefined;

/**
 * Register how the app tells a visitor that a save was refused (`announceStaleBuild`).
 * @param show - Shows the message with a « Recharger » action calling the `reload` it is given.
 */
export function setStaleBuildNotifier(show: StaleBuildNotifier): void {
	notifier = show;
}

/** Whether the notice was already raised: one per page life, however many calls fail (parallel reads, a poll). */
let isAnnounced = false;

/**
 * Tell the visitor that the page is older than the build. The « Recharger » button reloads at once, even
 * within the cooldown: a click is no loop.
 */
export function announceStaleBuild(kind: StaleBuildKind): void {
	if (isAnnounced || notifier === undefined) {
		return;
	}
	isAnnounced = true;
	notifier(new StaleBuildError(kind).message, () => {
		const url = new URL(window.location.href);
		url.searchParams.set(RELOAD_PARAM, String(Date.now()));
		window.location.replace(url.href);
	});
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
 * Whether this page has started its reload and is leaving. The error screen and every error report stay
 * quiet then: the router throws a TypeError for the file whose failure was cancelled, and it only
 * matters for the few hundred milliseconds before the fresh page arrives.
 * @returns `true` once {@link reloadNow} started a reload.
 */
export function isPageReloading(): boolean {
	return isReloading;
}

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

/** The router's own answer to « is a navigation in flight », set by {@link installChunkReload}. */
let navigationProbe: (() => boolean) | undefined;

/**
 * Whether the router is loading a navigation (the predicate given to {@link installChunkReload}). A reload
 * is only started then: outside one a failure comes from a preload, a refetch or a poll, and the page
 * holds what the visitor typed.
 * @returns `false` before the router installed its predicate.
 */
export function isNavigationInFlight(): boolean {
	return navigationProbe?.() === true;
}

/**
 * Browser start-up: drop the reload query from the address bar, then reload on Vite's
 * `vite:preloadError` (a hashed file that failed to load) and on a dynamic import that rejected
 * outside Vite's helper, but only while the router has a navigation in flight. The router also preloads
 * on hover or touch through the same helper: a failed preload must not take a form away from the
 * visitor, and the click that follows fails again inside a navigation, which reloads onto its
 * destination. The event's default action, throwing the error to the error screen, stays when no reload
 * is allowed, and is cancelled once one is under way.
 * @param isNavigating - Whether the router is loading a navigation (`router.state.status === 'pending'`:
 * `preloadRoute` never sets it, `load-client.ts` sets it for navigations only).
 * @returns Removes the listeners; a second call before that returns the same remover.
 */
export function installChunkReload(isNavigating: () => boolean): () => void {
	if (removeListeners !== undefined) {
		return removeListeners;
	}
	navigationProbe = isNavigating;
	const cleaned = withoutReloadParam(window.location.href);
	if (cleaned !== null) {
		window.history.replaceState(window.history.state, '', cleaned);
	}
	const onPreloadError = (event: Event) => {
		if (isNavigating() && reloadNow()) {
			event.preventDefault();
		}
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		const reason = event.reason instanceof Error ? event.reason.message : '';
		if (isNavigating() && isChunkLoadMessage(reason)) {
			reloadNow();
		}
	};
	window.addEventListener('vite:preloadError', onPreloadError);
	window.addEventListener('unhandledrejection', onRejection);
	removeListeners = () => {
		window.removeEventListener('vite:preloadError', onPreloadError);
		window.removeEventListener('unhandledrejection', onRejection);
		navigationProbe = undefined;
		removeListeners = undefined;
	};
	return removeListeners;
}
