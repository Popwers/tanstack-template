/**
 * A visitor can hold HTML (a tab left open across a deployment, or Cloudflare's copy) that names hashed
 * files a newer build replaced: the file answers 404 and the page would end on the error screen. The same
 * tab can also call a server function whose id the new build no longer has. The browser then reloads the
 * page it was opening once, with a query the edge has no copy of, so the HTML comes from the server and
 * names the files and functions that exist. A reload that did not help is not repeated: it would loop on
 * a real outage. When the entry script itself is gone no bundled code runs: the inline `<head>` script
 * (`entry-recovery.ts`) reloads instead, with the same query, marker, cooldown and reloading window.
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

/**
 * Shows the notice; the app registers it once, with its own notification (toast or banner). It shows the
 * message with a « Recharger » action calling `reload`, in one slot (same toast id, same banner): a second
 * call replaces what is on screen, never stacks. It calls `onDismiss` when the notice leaves the screen
 * (the visitor closed it, or it timed out), and may return how to take its notice off the screen, which
 * runs when the visitor closes another copy of it (the one inside an open dialog).
 */
export type StaleBuildNotifier = (
	message: string,
	reload: () => void,
	onDismiss: () => void,
) => (() => void) | void;

/** The notice on screen: which call met the older build and the sentence the visitor reads. */
export interface StaleBuildNotice {
	kind: StaleBuildKind;
	message: string;
}

let notifier: StaleBuildNotifier | undefined;

/** The notice now on screen; `undefined` once it left. One object per notice, so a snapshot compares by identity. */
let noticeOnScreen: StaleBuildNotice | undefined;

/** Takes the app's own notice off the screen (what the notifier returned, if anything). */
let hideNotice: (() => void) | void;

const noticeListeners = new Set<() => void>();

function noticeChanged(): void {
	for (const listener of noticeListeners) listener();
}

/**
 * Marks every element that shows the notice: the banner and its copy in a dialog. Focus inside one is the
 * notice's own, and goes back where it was when the notice closes.
 */
export const NOTICE_SELECTOR = '[data-stale-build-notice]';

/** The element that had focus before it entered the notice. */
let focusBeforeNotice: HTMLElement | undefined;

function onFocusIn(event: FocusEvent): void {
	if (event.target instanceof HTMLElement && event.target.closest(NOTICE_SELECTOR) === null) {
		focusBeforeNotice = event.target;
	}
}

function rememberFocus(): void {
	if (!('document' in globalThis)) return;
	const active = document.activeElement;
	focusBeforeNotice = active instanceof HTMLElement && active !== document.body ? active : undefined;
	document.addEventListener('focusin', onFocusIn);
}

/**
 * Gives focus back to the element that had it before the notice, when closing the notice left it inside the
 * notice (the button pressed) or on `<body>`; a visitor who already moved on keeps their focus.
 */
function restoreFocus(): void {
	if (!('document' in globalThis)) return;
	document.removeEventListener('focusin', onFocusIn);
	const target = focusBeforeNotice;
	focusBeforeNotice = undefined;
	const active = document.activeElement;
	const isFocusLeftBehind =
		active === null || active === document.body || active.closest(NOTICE_SELECTOR) !== null;
	if (isFocusLeftBehind && target?.isConnected === true) target.focus({ preventScroll: true });
}

/**
 * Register how the app tells a visitor that a call was refused (`announceStaleBuild`).
 * @param show - Shows the message with a « Recharger » action.
 * @returns Removes it: the component holding the notice left the page, so its notice is forgotten (no
 * `onDismiss` will come) and the next refusal shows again.
 */
export function setStaleBuildNotifier(show: StaleBuildNotifier): () => void {
	notifier = show;
	return () => {
		if (notifier !== show) return;
		notifier = undefined;
		noticeOnScreen = undefined;
		hideNotice = undefined;
		if ('document' in globalThis) document.removeEventListener('focusin', onFocusIn);
		focusBeforeNotice = undefined;
		noticeChanged();
	};
}

/**
 * Reload at once from the notice's « Recharger » button, even within the cooldown: a click is no loop.
 */
export function reloadFromNotice(): void {
	const url = new URL(window.location.href);
	url.searchParams.set(RELOAD_PARAM, String(Date.now()));
	window.location.replace(url.href);
}

/** The visitor closed the notice, or it timed out: forget it and give focus back. */
function noticeLeft(): void {
	if (noticeOnScreen === undefined) return;
	noticeOnScreen = undefined;
	hideNotice = undefined;
	restoreFocus();
	noticeChanged();
}

/**
 * Tell the visitor that the page is older than the build. One notice at a time, per kind: ten parallel
 * reads give one, a save still shows after a read (and replaces it), and a refused save shows again once
 * the previous notice is gone: a failed save is never silent.
 * @param kind - A read (GET) or a call that changes data.
 */
export function announceStaleBuild(kind: StaleBuildKind): void {
	if (notifier === undefined || noticeOnScreen?.kind === 'save' || noticeOnScreen?.kind === kind) {
		return;
	}
	if (noticeOnScreen === undefined) rememberFocus();
	const shown = { kind, message: new StaleBuildError(kind).message };
	noticeOnScreen = shown;
	hideNotice = notifier(shown.message, reloadFromNotice, () => {
		if (noticeOnScreen === shown) noticeLeft();
	});
	noticeChanged();
}

/**
 * The notice on screen, for a copy of it the app renders elsewhere (inside an open modal dialog, where the
 * page's own notice is out of reach).
 * @returns The same object until the notice changes or leaves; `undefined` when none is on screen.
 */
export function getStaleBuildNotice(): StaleBuildNotice | undefined {
	return noticeOnScreen;
}

/**
 * Subscribe to the notice appearing, changing or leaving (`useSyncExternalStore`).
 * @param listener - Called after each change.
 * @returns Unsubscribes.
 */
export function subscribeToStaleBuildNotice(listener: () => void): () => void {
	noticeListeners.add(listener);
	return () => noticeListeners.delete(listener);
}

/** The visitor closed a copy of the notice: the app's own leaves the screen too. */
export function dismissStaleBuildNotice(): void {
	const hide = hideNotice;
	noticeLeft();
	hide?.();
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

/** How long a started reload is given to replace the page: past it, the reload is taken for lost. */
export const RELOADING_WINDOW_MS = 10_000;

/** What a page records of its own reload, shared with the inline `<head>` script (`entry-recovery.ts`). */
export interface PageReloadState {
	/** When this page started its reload (`Date.now()`), by the script or by this module. */
	startedAt?: number;
	/** Set once the bundle runs: the script then leaves every failure to this module. */
	isBundleRunning?: boolean;
}

/** The `window` property holding the {@link PageReloadState}. */
export const RELOAD_STATE_KEY = '__chunkReload';

declare global {
	interface Window {
		__chunkReload?: PageReloadState;
	}
}

function pageReloadState(): PageReloadState {
	window.__chunkReload ??= {};
	return window.__chunkReload;
}

/** Whether this page's reloading window is open; only the window's own timer closes it. */
let isReloading = false;

const reloadingWindowListeners = new Set<() => void>();

/** Calls parked until the window ends, each failing with its notice when it does. */
const parkedCalls = new Set<() => void>();

function closeReloadingWindow(): void {
	isReloading = false;
	const calls = [...parkedCalls];
	parkedCalls.clear();
	for (const fail of calls) fail();
	for (const listener of reloadingWindowListeners) listener();
}

function openReloadingWindow(durationMs: number): void {
	isReloading = true;
	setTimeout(closeReloadingWindow, durationMs);
	queueMicrotask(() => {
		for (const listener of reloadingWindowListeners) listener();
	});
}

/**
 * Whether this page has started its reload and is about to leave. The error screen and every error report
 * stay quiet then: the router throws a TypeError for the file whose failure was cancelled, and it only
 * matters for the few hundred milliseconds before the fresh page arrives. Bounded by
 * {@link RELOADING_WINDOW_MS}, which a timer ends (not a comparison of clocks): a reload that does not
 * complete (Stop, Back, a cancelled `beforeunload` prompt) must not leave the tab silent and blank for the
 * rest of its life.
 * @returns `true` from the start of a reload until the window ends.
 */
export function isPageReloading(): boolean {
	return isReloading;
}

/**
 * Subscribe to the reloading window (`useSyncExternalStore`): an error screen that rendered nothing while
 * the page was leaving renders again when it did not leave. The opening is told after the current task,
 * since a boundary opens the window while it renders.
 * @param listener - Called after {@link isPageReloading} changed.
 * @returns Unsubscribes.
 */
export function subscribeToReloadingWindow(listener: () => void): () => void {
	reloadingWindowListeners.add(listener);
	return () => reloadingWindowListeners.delete(listener);
}

/**
 * Start the reload, or confirm it is already under way. A second failure in the dying page (the click
 * after a hover preload, the router's own plain reload) must not replace the navigation to the fresh
 * address: the latest navigation wins. After the window the reload is taken for lost: a new attempt
 * goes through the cooldown, which refuses it.
 * @returns `true` when this page is reloading.
 */
export function reloadNow(): boolean {
	if (!('window' in globalThis)) {
		return false;
	}
	if (isReloading) {
		return true;
	}
	if (reloadOnce(browserEnvironment())) {
		pageReloadState().startedAt = Date.now();
		openReloadingWindow(RELOADING_WINDOW_MS);
		return true;
	}
	return false;
}

/**
 * The promise a call is parked on while the page reloads: it never resolves, and rejects with a
 * {@link StaleBuildError} (and the notice) once the window ended without the page having left, so no
 * caller stays pending forever. The window is over by then: nothing counts the page as reloading.
 * @param kind - The kind of call that is parked.
 * @returns A promise that only ever rejects.
 */
export function parkUntilReloadEnds(kind: StaleBuildKind): Promise<never> {
	return new Promise<never>((_, reject) => {
		const fail = () => {
			announceStaleBuild(kind);
			reject(new StaleBuildError(kind));
		};
		if (isReloading) {
			parkedCalls.add(fail);
		} else {
			fail();
		}
	});
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
 * Browser start-up: take over from the inline `<head>` script (it leaves every later failure to this module,
 * and a reload it started keeps its reloading window), drop the reload query from the address bar, then
 * reload on Vite's `vite:preloadError` (a hashed file that failed to load) and on a dynamic import that
 * rejected outside Vite's helper, but only while the router has a navigation in flight. The router also
 * preloads on hover or touch through the same helper: a failed preload must not take a form away from
 * the visitor, and the click that follows fails again inside a navigation, which reloads onto its
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
	const state = pageReloadState();
	state.isBundleRunning = true;
	const sinceScriptReload = state.startedAt === undefined ? undefined : Date.now() - state.startedAt;
	if (!isReloading && sinceScriptReload !== undefined && sinceScriptReload < RELOADING_WINDOW_MS) {
		openReloadingWindow(RELOADING_WINDOW_MS - sinceScriptReload);
	}
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
