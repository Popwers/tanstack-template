import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';

/** Props of one labelled input. */
interface FormFieldProps {
	id: string;
	label: string;
	type: 'email' | 'password' | 'text';
	autoComplete: string;
	/** Native `minlength`: the browser refuses a shorter value before the form is sent. */
	minLength?: number;
}

/**
 * Labelled input read from `FormData` on submit. An e-mail field holds an identifier, not prose: no spell check.
 * A password field gets a show-password toggle.
 * @param props - Field id (also its form name), label, type, autocomplete hint and optional minimum length.
 * @returns The field.
 */
export function FormField({ id, label, type, autoComplete, minLength }: FormFieldProps) {
	return (
		<div className='grid gap-2'>
			<Label htmlFor={id}>{label}</Label>
			{type === 'password' ? (
				<PasswordInput id={id} autoComplete={autoComplete} minLength={minLength} />
			) : (
				<Input
					id={id}
					name={id}
					type={type}
					autoComplete={autoComplete}
					minLength={minLength}
					spellCheck={type === 'email' ? false : undefined}
					required
				/>
			)}
		</div>
	);
}

/**
 * Password input with a button that shows it in clear, so the user can check what they typed. Spell
 * check stays off: a shown password is plain text, which an enhanced spell checker would send away.
 * @param props - Field id (also its form name), autocomplete hint and optional minimum length.
 * @returns The input and its toggle.
 */
function PasswordInput({ id, autoComplete, minLength }: Omit<FormFieldProps, 'label' | 'type'>) {
	const [isShown, setIsShown] = useState(false);
	const warningId = useId();
	return (
		<div className='flex gap-2'>
			<Input
				id={id}
				name={id}
				type={isShown ? 'text' : 'password'}
				autoComplete={autoComplete}
				minLength={minLength}
				spellCheck={false}
				autoCapitalize='off'
				required
			/>
			<Button
				type='button'
				variant='outline'
				size='icon'
				aria-label='Afficher le mot de passe'
				aria-pressed={isShown}
				aria-describedby={warningId}
				onClick={() => setIsShown((shown) => !shown)}>
				{isShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
			</Button>
			<span id={warningId} className='sr-only'>
				Le mot de passe s’affichera en clair à l’écran.
			</span>
		</div>
	);
}
