import { useEffect, useState } from 'react';

import { Button } from '#/components/ui/button';
import { setStaleBuildNotifier } from '#/lib/chunk-reload';

/** The notice a visitor reads when a save was refused because the page is older than the running build. */
interface Notice {
	message: string;
	reload: () => void;
}

/**
 * Banner shown when a save from a tab left open across a deployment was refused (`announceStaleBuild`):
 * the form stays on screen so the visitor can copy what they typed, and « Recharger » reloads the page.
 * @returns The banner, or nothing until a save is refused.
 */
export function StaleBuildNotice() {
	const [notice, setNotice] = useState<Notice | null>(null);

	useEffect(() => {
		setStaleBuildNotifier((message, reload) => setNotice({ message, reload }));
	}, []);

	if (notice === null) return null;
	return (
		<div
			role='alert'
			className='bg-background fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-center gap-4 rounded-lg border p-4 text-sm shadow-lg'>
			<p className='flex-1'>{notice.message}</p>
			<Button onClick={notice.reload}>Recharger</Button>
		</div>
	);
}
