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
 * @param props - Field id (also its form name), label, type, autocomplete hint and optional minimum length.
 * @returns The field.
 */
export function FormField({ id, label, type, autoComplete, minLength }: FormFieldProps) {
	return (
		<div className='grid gap-2'>
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				name={id}
				type={type}
				autoComplete={autoComplete}
				minLength={minLength}
				spellCheck={type === 'email' ? false : undefined}
				required
			/>
		</div>
	);
}
