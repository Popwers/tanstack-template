import { createFileRoute, Link } from '@tanstack/react-router';

import { Button } from '#/components/ui/button';
import { SITE } from '#/content/legal/site';

export const Route = createFileRoute('/')({ component: Home });

/** Public home page. Replace with the product's landing. */
function Home() {
	return (
		<main className='mx-auto max-w-3xl px-4 py-24 text-center'>
			<h1 className='text-4xl font-semibold tracking-tight'>{SITE.name}</h1>
			<p className='text-muted-foreground mt-4 text-lg'>
				TanStack Start, Postgres, Better Auth, R2, Sentry et OpenPanel, prêts pour Coolify.
			</p>
			<div className='mt-8 flex justify-center gap-3'>
				<Button asChild>
					<Link to='/sign-up'>Créer un compte</Link>
				</Button>
				<Button asChild variant='outline'>
					<Link to='/sign-in'>Se connecter</Link>
				</Button>
			</div>
		</main>
	);
}
