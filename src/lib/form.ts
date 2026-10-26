/**
 * Read a text field of a submitted form.
 * @param form - Submitted form data.
 * @param name - Field name.
 * @returns The trimmed value, `''` when absent or a file.
 */
export function formText(form: FormData, name: string): string {
	const value = form.get(name);
	return value instanceof File || value === null ? '' : value.trim();
}
