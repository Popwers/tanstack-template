import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { AuthCard } from '#/components/auth-card';
import { useCaptcha } from '#/components/captcha';
import { FormField } from '#/components/form-field';
import { Button } from '#/components/ui/button';
import { usePublicConfig } from '#/hooks/use-public-config';
import { authClient } from '#/lib/auth-client';
import { formText } from '#/lib/form';

export const Route = createFileRoute('/forgot-password')({
	head: () => ({ meta: [{ title: 'Mot de passe oublié' }] }),
	component: ForgotPassword,
});

/** Reset request. The answer never says whether the address has an account. */
function ForgotPassword() {
	const { turnstileSiteKey } = usePublicConfig();
	const captcha = useCaptcha(turnstileSiteKey);
	const [isSent, setIsSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Submit: needs a fresh Turnstile token.
	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const fetchOptions = captcha.fetchOptions();
		if (fetchOptions === null) {
			setError('Vérification anti-robot en cours, réessayez dans un instant.');
			return;
		}
		const form = new FormData(event.currentTarget);
		const result = await authClient.requestPasswordReset({
			email: formText(form, 'email'),
			redirectTo: '/reset-password',
			fetchOptions,
		});
		captcha.reset();
		if (result.error) {
			setError(result.error.message ?? 'Demande impossible.');
			return;
		}
		setIsSent(true);
	}

	if (isSent) {
		return (
			<AuthCard
				title='Vérifiez vos e-mails'
				description='Si un compte existe, un lien vient de partir.'>
				<p className='text-sm'>Le lien est valable une heure.</p>
			</AuthCard>
		);
	}

	return (
		<AuthCard title='Mot de passe oublié' description='Recevez un lien de réinitialisation.'>
			<form onSubmit={onSubmit} className='grid gap-4'>
				<FormField id='email' label='E-mail' type='email' autoComplete='email' />
				{captcha.widget}
				{error !== null && (
					<p role='alert' className='text-destructive text-sm'>
						{error}
					</p>
				)}
				<Button type='submit' disabled={!captcha.isReady}>
					Envoyer le lien
				</Button>
			</form>
		</AuthCard>
	);
}
