import { useEffect, useState } from 'react';

import { Button } from '#/components/ui/button';
import { setStaleBuildNotifier } from '#/lib/chunk-reload';

/** What the banner shows: the sentence, the reload action, and what to tell the module when it closes. */
interface Notice {
	message: string;
	reload: () => void;
	onDismiss: () => void;
}

/**
 * Banner shown when a call from a tab left open across a deployment was refused (`announceStaleBuild`): the
 * form stays on screen so the visitor can copy what they typed, « Recharger » reloads the page and
 * « Fermer » dismisses it. It sticks to the top of the page, so it never covers a form's save button or the
 * footer links on a phone; a second notice replaces the first in the same slot.
 * @returns The banner, or nothing until a call is refused.
 */
export function StaleBuildNotice() {
	const [notice, setNotice] = useState<Notice | null>(null);

	useEffect(() => {
		setStaleBuildNotifier((message, reload, onDismiss) => setNotice({ message, reload, onDismiss }));
	}, []);

	if (notice === null) return null;
	const close = () => {
		notice.onDismiss();
		setNotice(null);
	};
	return (
		<div
			role='alert'
			className='bg-background sticky top-0 z-50 flex flex-wrap items-center gap-3 border-b p-3 text-sm shadow-sm'>
			<p className='min-w-0 flex-1 basis-60'>{notice.message}</p>
			<Button onClick={notice.reload}>Recharger</Button>
			<Button variant='outline' onClick={close}>
				Fermer
			</Button>
		</div>
	);
}
