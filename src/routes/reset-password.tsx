import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { z } from 'zod';

import { AuthCard } from '#/components/auth-card';
import { FormField } from '#/components/form-field';
import { Button } from '#/components/ui/button';
import { authClient } from '#/lib/auth-client';
import { formText } from '#/lib/form';

export const Route = createFileRoute('/reset-password')({
	validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
	head: () => ({ meta: [{ title: 'Nouveau mot de passe' }] }),
	component: ResetPassword,
});

/** New password form, reached from the e-mailed link (`?token=`). */
function ResetPassword() {
	const { token, error: linkError } = Route.useSearch();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);

	// Submit: the token is single-use; Better Auth revokes the other sessions.
	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (token === undefined) return;
		const form = new FormData(event.currentTarget);
		const result = await authClient.resetPassword({ token, newPassword: formText(form, 'password') });
		if (result.error) {
			setError(result.error.message ?? 'Réinitialisation impossible.');
			return;
		}
		await navigate({ to: '/sign-in' });
	}

	if (token === undefined || linkError !== undefined) {
		return (
			<AuthCard title='Lien expiré' description='Ce lien n’est plus valable.'>
				<p className='text-sm'>Demandez un nouveau lien depuis « Mot de passe oublié ».</p>
			</AuthCard>
		);
	}

	return (
		<AuthCard title='Nouveau mot de passe' description='10 caractères minimum.'>
			<form onSubmit={onSubmit} className='grid gap-4'>
				<FormField
					id='password'
					label='Nouveau mot de passe'
					type='password'
					autoComplete='new-password'
				/>
				{error !== null && (
					<p role='alert' className='text-destructive text-sm'>
						{error}
					</p>
				)}
				<Button type='submit'>Enregistrer</Button>
			</form>
		</AuthCard>
	);
}
