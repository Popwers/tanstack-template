import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useRef, useState } from 'react';

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
	const reset = useCallback(() => {
		setToken(null);
		ref.current?.reset();
	}, []);
	const fetchOptions = useCallback(
		() => (token === null ? null : { headers: { 'x-captcha-response': token } }),
		[token],
	);
	const widget = (
		<Turnstile
			ref={ref}
			siteKey={siteKey}
			options={{ size: 'flexible', language: 'fr' }}
			onSuccess={setToken}
			onExpire={() => setToken(null)}
		/>
	);
	return { widget, isReady: token !== null, fetchOptions, reset };
}
