import { describe, expect, it } from 'vite-plus/test';

import {
	MAX_SERVER_FUNCTION_BODY_BYTES,
	MAX_SERVER_FUNCTION_UPLOAD_BYTES,
	refuseServerFunctionBody,
} from '#/lib/middleware/request-size';

/**
 * Failure modes: a POST with no length (chunked) or a negative or garbled one is read in full; a body
 * over the cap is read before it is refused; a multipart upload is judged by the JSON cap, or the cap
 * is off by one; a GET (payload in the query) is refused for having no body.
 */
describe('refuseServerFunctionBody', () => {
	const json = 'application/json';

	it('lets a GET and a HEAD through without a length', () => {
		expect(refuseServerFunctionBody('GET', null, null)).toBeNull();
		expect(refuseServerFunctionBody('HEAD', null, null)).toBeNull();
	});

	it.each([null, '', 'abc', '-1', 'NaN', 'Infinity'])('answers 411 to a POST declaring %j', (length) => {
		expect(refuseServerFunctionBody('POST', json, length)).toBe(411);
	});

	it('accepts a body up to the cap and refuses one byte more with 413', () => {
		expect(refuseServerFunctionBody('POST', json, String(MAX_SERVER_FUNCTION_BODY_BYTES))).toBeNull();
		expect(refuseServerFunctionBody('POST', json, String(MAX_SERVER_FUNCTION_BODY_BYTES + 1))).toBe(413);
	});

	it('judges a multipart body by the upload cap, whatever the case of the header', () => {
		const multipart = 'Multipart/Form-Data; boundary=x';
		expect(
			refuseServerFunctionBody('POST', multipart, String(MAX_SERVER_FUNCTION_UPLOAD_BYTES)),
		).toBeNull();
		expect(
			refuseServerFunctionBody('POST', multipart, String(MAX_SERVER_FUNCTION_UPLOAD_BYTES + 1)),
		).toBe(413);
	});

	it('judges PUT, PATCH and DELETE like POST', () => {
		for (const method of ['PUT', 'PATCH', 'DELETE']) {
			expect(refuseServerFunctionBody(method, json, null)).toBe(411);
		}
	});
});
