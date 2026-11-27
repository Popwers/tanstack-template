import { useEffect, useRef, useSyncExternalStore } from 'react';

import { Button } from '#/components/ui/button';
import {
	dismissStaleBuildNotice,
	getStaleBuildNotice,
	reloadFromNotice,
	setStaleBuildNotifier,
	subscribeToStaleBuildNotice,
} from '#/lib/chunk-reload';

/** CSS variable holding the banner's height, which `styles.css` turns into `scroll-padding-top`. */
const HEIGHT_VARIABLE = '--stale-build-notice-height';

/**
 * Banner shown when a call from a tab left open across a deployment was refused (`announceStaleBuild`): the
 * form stays on screen so the visitor can copy what they typed, « Recharger » reloads the page and
 * « Fermer » dismisses it, giving focus back where it was. It sticks to the top of the page, so it never
 * covers a form's save button or the footer links on a phone, and reserves its height as the page's
 * `scroll-padding-top`, so an element scrolled or tabbed to never ends under it (WCAG 2.4.11). A second
 * notice replaces the first in the same slot. When the banner leaves the page, its notice is forgotten.
 * @returns The banner, or nothing until a call is refused.
 */
export function StaleBuildNotice() {
	const notice = useSyncExternalStore(subscribeToStaleBuildNotice, getStaleBuildNotice, () => undefined);
	const banner = useRef<HTMLDivElement>(null);

	useEffect(() => setStaleBuildNotifier(() => undefined), []);

	useEffect(() => {
		const element = banner.current;
		if (notice === undefined || element === null) return;
		const root = document.documentElement;
		const reserve = () =>
			root.style.setProperty(HEIGHT_VARIABLE, `${element.getBoundingClientRect().height}px`);
		reserve();
		const observer = new ResizeObserver(reserve);
		observer.observe(element);
		return () => {
			observer.disconnect();
			root.style.removeProperty(HEIGHT_VARIABLE);
		};
	}, [notice]);

	if (notice === undefined) return null;
	return (
		<div
			ref={banner}
			role='alert'
			data-stale-build-notice=''
			className='bg-background sticky top-0 z-50 flex flex-wrap items-center gap-3 border-b p-3 text-sm shadow-sm'>
			<p className='min-w-0 flex-1 basis-60'>{notice.message}</p>
			<Button onClick={reloadFromNotice}>Recharger</Button>
			<Button variant='outline' onClick={dismissStaleBuildNotice}>
				Fermer
			</Button>
		</div>
	);
}
