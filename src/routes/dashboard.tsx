import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';

import { Button } from '#/components/ui/button';
import { signOut } from '#/lib/auth-client';
import { getSessionUser } from '#/lib/server/session';

export const Route = createFileRoute('/dashboard')({
	beforeLoad: async () => {
		const user = await getSessionUser();
		if (user === null) throw redirect({ to: '/sign-in' });
		return { user };
	},
	head: () => ({ meta: [{ title: 'Mon espace' }] }),
	component: Dashboard,
});

/** Protected page: the session is checked on the server before render. */
function Dashboard() {
	const { user } = Route.useRouteContext();
	const router = useRouter();

	// Sign out, then re-run the guards so the page redirects.
	async function onSignOut() {
		await signOut();
		await router.invalidate();
	}

	return (
		<main className='mx-auto max-w-3xl px-4 py-16'>
			<h1 className='text-3xl font-semibold'>Bonjour {user.name}</h1>
			<p className='text-muted-foreground mt-2'>Connecté avec {user.email}.</p>
			<Button className='mt-8' variant='outline' onClick={onSignOut}>
				Se déconnecter
			</Button>
		</main>
	);
}
