import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useMemo, useRef, useState } from 'react';

/** Fetch options carrying a Turnstile token to a Better Auth endpoint. */
export interface CaptchaFetchOptions {
	headers: { 'x-captcha-response': string };
}

/** What a form needs from its widget. */
export interface Captcha {
	widget: React.ReactNode;
	/** Fetch options for the next auth call, or `null` while the challenge is pending. */
	fetchOptions: () => CaptchaFetchOptions | null;
	/** Whether a token is ready: submit stays disabled until then. */
	isReady: boolean;
	/** Ask for a fresh token: a token is single-use. */
	reset: () => void;
}

/**
 * Turnstile widget of one auth form.
 * @param siteKey - Public site key (test key outside production).
 * @returns The widget and its token accessors.
 */
export function useCaptcha(siteKey: string): Captcha {
	const ref = useRef<TurnstileInstance>(null);
	const [token, setToken] = useState<string | null>(null);
	const [hasFailed, setHasFailed] = useState(false);
	const reset = useCallback(() => {
		setToken(null);
		ref.current?.reset();
	}, []);
	const fetchOptions = useCallback(
		() => (token === null ? null : { headers: { 'x-captcha-response': token } }),
		[token],
	);
	const onSuccess = useCallback((value: string) => {
		setHasFailed(false);
		setToken(value);
	}, []);
	const onFailure = useCallback(() => {
		setToken(null);
		setHasFailed(true);
	}, []);
	// Stable: the widget reloads its script when this object changes.
	const scriptOptions = useMemo(() => ({ onError: onFailure }), [onFailure]);
	const widget = (
		<>
			<Turnstile
				ref={ref}
				siteKey={siteKey}
				options={{ size: 'flexible', language: 'fr', appearance: 'interaction-only', theme: 'light' }}
				scriptOptions={scriptOptions}
				onSuccess={onSuccess}
				onError={onFailure}
				onExpire={() => setToken(null)}
			/>
			{/* Fail closed, never silently: the submit stays disabled, so say why. */}
			{hasFailed ? (
				<p role='alert' className='text-destructive text-sm'>
					La vérification anti-robot n’a pas pu se charger. Désactivez votre bloqueur de contenu
					pour ce site, puis rechargez la page.
				</p>
			) : (
				token === null && (
					<p aria-live='polite' className='text-muted-foreground text-sm'>
						Vérification anti-robot en cours…
					</p>
				)
			)}
		</>
	);
	return { widget, isReady: token !== null, fetchOptions, reset };
}
