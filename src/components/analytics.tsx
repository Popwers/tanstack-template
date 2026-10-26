import { OpenPanel } from '@openpanel/sdk';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

/**
 * Cookieless OpenPanel page views. Renders nothing; off when no client id is configured.
 * @param props.clientId - Public OpenPanel client id, or `null`.
 * @param props.apiUrl - Self-hosted ingest URL.
 * @returns Nothing.
 */
export function Analytics({ clientId, apiUrl }: { clientId: string | null; apiUrl: string }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const client = useRef<OpenPanel | null>(null);
	useEffect(() => {
		if (clientId === null) return;
		client.current ??= new OpenPanel({ clientId, apiUrl });
		void client.current.track('screen_view', { __path: pathname });
	}, [clientId, apiUrl, pathname]);
	return null;
}
