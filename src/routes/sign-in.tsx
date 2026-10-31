import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AuthCard } from '#/components/auth-card';
import { useCaptcha } from '#/components/captcha';
import { FormField } from '#/components/form-field';
import { Button } from '#/components/ui/button';
import { usePublicConfig } from '#/hooks/use-public-config';
import { signIn } from '#/lib/auth-client';
import { formText } from '#/lib/form';

export const Route = createFileRoute('/sign-in')({
	head: () => ({ meta: [{ title: 'Se connecter' }] }),
	component: SignIn,
});

/** E-mail + password sign-in, Turnstile-protected. */
function SignIn() {
	const { turnstileSiteKey } = usePublicConfig();
	const captcha = useCaptcha(turnstileSiteKey);
	const navigate = useNavigate();
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Submit: needs a fresh Turnstile token, spends it whatever the outcome.
	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const fetchOptions = captcha.fetchOptions();
		if (fetchOptions === null) {
			setError('Vérification anti-robot en cours, réessayez dans un instant.');
			return;
		}
		const form = new FormData(event.currentTarget);
		setIsPending(true);
		try {
			const result = await signIn.email({
				email: formText(form, 'email'),
				password: formText(form, 'password'),
				fetchOptions,
			});
			if (result.error) {
				setError(result.error.message ?? 'Connexion impossible.');
				return;
			}
			await navigate({ to: '/dashboard' });
		} finally {
			captcha.reset();
			setIsPending(false);
		}
	}

	return (
		<AuthCard title='Se connecter' description='Accédez à votre espace.'>
			<form onSubmit={onSubmit} className='grid gap-4'>
				<FormField id='email' label='E-mail' type='email' autoComplete='email' />
				<FormField
					id='password'
					label='Mot de passe'
					type='password'
					autoComplete='current-password'
				/>
				{captcha.widget}
				{error !== null && (
					<p role='alert' className='text-destructive text-sm'>
						{error}
					</p>
				)}
				<Button type='submit' disabled={isPending || !captcha.isReady}>
					Se connecter
				</Button>
				<div className='text-muted-foreground flex justify-between text-sm'>
					<Link to='/forgot-password' className='underline'>
						Mot de passe oublié
					</Link>
					<Link to='/sign-up' className='underline'>
						Créer un compte
					</Link>
				</div>
			</form>
		</AuthCard>
	);
}
