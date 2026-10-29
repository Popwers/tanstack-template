import { createFileRoute } from '@tanstack/react-router';
import { getRequestIP } from '@tanstack/react-start/server';
import { z } from 'zod';

import { auth, CAPTCHA_ENDPOINTS, turnstile } from '#/lib/auth';
import { withClientIpChain } from '#/lib/server/client-ip';

/** Better Auth's JSON error body. */
const errorBody = z.object({ code: z.string() });

/** Shown by the auth forms, which display the error message as is. */
const CAPTCHA_UNAVAILABLE_MESSAGE =
	'La vérification anti-robot est momentanément indisponible. Réessayez dans un instant.';

/**
 * The captcha plugin answers 500 when Cloudflare's siteverify is unreachable: the visitor did nothing
 * wrong and the server is not broken, the check is unavailable. Turn that one answer into a 503.
 * @param request - The auth request.
 * @param response - Better Auth's response.
 * @returns A 503 for a siteverify outage, else `response` untouched (Set-Cookie included).
 */
async function captchaOutageAs503(request: Request, response: Response): Promise<Response> {
	if (response.status !== 500) return response;
	const endpoint = new URL(request.url).pathname.replace(/^\/api\/auth/, '');
	if (!CAPTCHA_ENDPOINTS.includes(endpoint)) return response;
	const body = errorBody.safeParse(
		await response
			.clone()
			.json()
			.catch(() => null),
	);
	if (!body.success || body.data.code !== turnstile.$ERROR_CODES.UNKNOWN_ERROR.code) return response;
	return Response.json(
		{ code: 'CAPTCHA_UNAVAILABLE', message: CAPTCHA_UNAVAILABLE_MESSAGE },
		{ status: 503, headers: { 'retry-after': '30' } },
	);
}

/** Better Auth catch-all, keyed on the real client IP for its rate limits. */
const handle = async ({ request }: { request: Request }) => {
	const authRequest = withClientIpChain(request, getRequestIP({ xForwardedFor: false }));
	return captchaOutageAs503(authRequest, await auth.handler(authRequest));
};

export const Route = createFileRoute('/api/auth/$')({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
		},
	},
});
