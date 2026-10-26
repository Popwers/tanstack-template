import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';

/** Props of one labelled input. */
interface FormFieldProps {
	id: string;
	label: string;
	type: 'email' | 'password' | 'text';
	autoComplete: string;
}

/**
 * Labelled input read from `FormData` on submit.
 * @param props - Field id (also its form name), label, type and autocomplete hint.
 * @returns The field.
 */
export function FormField({ id, label, type, autoComplete }: FormFieldProps) {
	return (
		<div className='grid gap-2'>
			<Label htmlFor={id}>{label}</Label>
			<Input id={id} name={id} type={type} autoComplete={autoComplete} required />
		</div>
	);
}
