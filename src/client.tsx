import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { installChunkReload } from '#/lib/chunk-reload';
import { initBrowserSentry } from '#/lib/sentry-browser';

installChunkReload();
initBrowserSentry();

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
	);
});
