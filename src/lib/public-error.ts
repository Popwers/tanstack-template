/**
 * An error whose message is written for the user. A server function that throws it shows that
 * message in the browser; any other error reaches the browser as a generic message (`src/start.ts`).
 */
export class PublicError extends Error {
	override name = 'PublicError';
}
