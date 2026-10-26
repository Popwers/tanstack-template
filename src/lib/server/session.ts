import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

import { auth } from '#/lib/auth';

/** Signed-in user shown by the protected pages. */
export interface SessionUser {
	id: string;
	name: string;
	email: string;
}

/** Current session user, or `null` when signed out. */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(
	async (): Promise<SessionUser | null> => {
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		if (!session) return null;
		return { id: session.user.id, name: session.user.name, email: session.user.email };
	},
);

/** Public browser config: the Turnstile site key and OpenPanel client id. */
export const getPublicConfig = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ turnstileKeys }, { env }] = await Promise.all([
		import('#/lib/server/turnstile'),
		import('#/lib/server/env'),
	]);
	return {
		turnstileSiteKey: turnstileKeys().siteKey,
		openpanelClientId: env().OPENPANEL_CLIENT_ID ?? null,
		openpanelApiUrl: env().OPENPANEL_API_URL,
	};
});
