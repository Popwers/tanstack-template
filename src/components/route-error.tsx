import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Button } from '#/components/ui/button';

/**
 * Error screen of the root route, next to its not-found screen. The error itself never reaches the page
 * (its message can name a table, a path or a query): it goes to Sentry, which is a no-op until the SDK
 * is initialised (production build with a DSN).
 * @param props.error - The error thrown by a loader or a render.
 * @param props.reset - Clears the route's error boundary.
 * @returns The screen, with a retry and a way back home.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
	const router = useRouter();

	useEffect(() => {
		void import('@sentry/tanstackstart-react').then((Sentry) => Sentry.captureException(error));
	}, [error]);

	return (
		<main className='mx-auto max-w-2xl px-4 py-24 text-center'>
			<h1 className='text-2xl font-semibold'>Une erreur est survenue</h1>
			<p className='text-muted-foreground mt-2'>
				Nous n’avons pas pu afficher cette page. Réessayez, ou revenez à l’accueil.
			</p>
			<div className='mt-6 flex items-center justify-center gap-4'>
				<Button
					onClick={() => {
						reset();
						void router.invalidate();
					}}>
					Réessayer
				</Button>
				<Link to='/' className='underline'>
					Retour à l’accueil
				</Link>
			</div>
		</main>
	);
}
