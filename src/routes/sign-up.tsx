import { createFileRoute, Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AuthCard } from '#/components/auth-card';
import { useCaptcha } from '#/components/captcha';
import { FormField } from '#/components/form-field';
import { Button } from '#/components/ui/button';
import { usePublicConfig } from '#/hooks/use-public-config';
import { signUp } from '#/lib/auth-client';
import { formText } from '#/lib/form';

export const Route = createFileRoute('/sign-up')({
	head: () => ({ meta: [{ title: 'Créer un compte' }] }),
	component: SignUp,
});

/** Sign-up form. A verification e-mail follows; the account signs in once verified. */
function SignUp() {
	const { turnstileSiteKey } = usePublicConfig();
	const captcha = useCaptcha(turnstileSiteKey);
	const [state, setState] = useState<'idle' | 'pending' | 'sent'>('idle');
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
		setState('pending');
		const result = await signUp.email({
			name: formText(form, 'name'),
			email: formText(form, 'email'),
			password: formText(form, 'password'),
			callbackURL: '/dashboard',
			fetchOptions,
		});
		captcha.reset();
		if (result.error) {
			setError(result.error.message ?? 'Inscription impossible.');
			setState('idle');
			return;
		}
		setState('sent');
	}

	if (state === 'sent') {
		return (
			<AuthCard
				title='Vérifiez vos e-mails'
				description='Un lien de confirmation vient de vous être envoyé.'>
				<p className='text-sm'>Cliquez sur le lien reçu pour activer votre compte.</p>
			</AuthCard>
		);
	}

	return (
		<AuthCard title='Créer un compte' description='Quelques secondes suffisent.'>
			<form onSubmit={onSubmit} className='grid gap-4'>
				<FormField id='name' label='Nom' type='text' autoComplete='name' />
				<FormField id='email' label='E-mail' type='email' autoComplete='email' />
				<FormField
					id='password'
					label='Mot de passe (10 caractères min.)'
					type='password'
					autoComplete='new-password'
				/>
				{captcha.widget}
				{error !== null && (
					<p role='alert' className='text-destructive text-sm'>
						{error}
					</p>
				)}
				<Button type='submit' disabled={state === 'pending' || !captcha.isReady}>
					Créer mon compte
				</Button>
				<p className='text-muted-foreground text-sm'>
					Déjà inscrit ?{' '}
					<Link to='/sign-in' className='underline'>
						Se connecter
					</Link>
				</p>
			</form>
		</AuthCard>
	);
}
