import { createMiddleware } from '@tanstack/react-start';

/**
 * Every body a server function takes here (JSON, urlencoded): the largest legitimate one is a few text
 * fields, well under this.
 */
export const MAX_SERVER_FUNCTION_BODY_BYTES = 2 * 1024 * 1024;

/**
 * A multipart body, which carries files. The template uploads none through a server function: a form
 * that does sets this to the heaviest legitimate one (its files plus about 1 Mo of framing).
 */
export const MAX_SERVER_FUNCTION_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * What a server-function call declares, judged before Start reads a byte of its body: Start reads the
 * whole body (JSON, urlencoded or multipart) before any auth check.
 * @param method - The HTTP method.
 * @param contentType - The `Content-Type` header.
 * @param contentLength - The `Content-Length` header.
 * @returns The status to answer, or `null` when the call may go on.
 */
export function refuseServerFunctionBody(
	method: string,
	contentType: string | null,
	contentLength: string | null,
): 411 | 413 | null {
	if (method === 'GET' || method === 'HEAD') {
		return null;
	}
	if (contentLength === null || !/^\d+$/.test(contentLength)) {
		return 411;
	}
	const length = Number(contentLength);
	const isMultipart = contentType?.toLowerCase().includes('multipart/form-data') === true;
	const cap = isMultipart ? MAX_SERVER_FUNCTION_UPLOAD_BYTES : MAX_SERVER_FUNCTION_BODY_BYTES;
	return length > cap ? 413 : null;
}

/**
 * A server-function call (`handlerType`, which Start decides on its own normalised path, so no spelling of
 * the path skips the check) with a body is refused on its declared length (413 above the cap), or for
 * declaring none (411), before its body is read. Browsers always send the length of what they post.
 */
export const limitServerFunctionBody = createMiddleware().server(async ({ request, handlerType, next }) => {
	if (handlerType !== 'serverFn') {
		return next();
	}
	const status = refuseServerFunctionBody(
		request.method,
		request.headers.get('content-type'),
		request.headers.get('content-length'),
	);
	if (status === null) {
		return next();
	}
	return new Response(status === 413 ? 'Request body too large.' : 'Request body length missing.', {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', connection: 'close' },
	});
});
