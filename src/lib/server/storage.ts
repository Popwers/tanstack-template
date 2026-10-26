import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '#/lib/server/env';

/**
 * Server-only file storage. The backend is chosen at runtime:
 * - **Cloudflare R2** (private bucket `<name>-files`) when every `CF_*` variable is set — production;
 * - **local disk** under `STORAGE_DIR` otherwise — dev and tests.
 *
 * Keys are identical in both modes, so switching R2 on needs no migration. The bucket is private:
 * serve files through a session-guarded route, never by direct URL.
 */

/** Keys are `/`-separated segments of a safe charset; no traversal, no empty segment. */
const SAFE_KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?)*$/;

let client: S3Client | null = null;

/** R2 settings when every `CF_*` variable is present. */
interface R2Settings {
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
}

/** @returns The R2 settings, or `null` when storage falls back to disk. */
function r2Settings(): R2Settings | null {
	const { CF_ENDPOINT, CF_ACCESS_KEY_ID, CF_ACCESS_SECRET, CF_BUCKET } = env();
	if (!CF_ENDPOINT || !CF_ACCESS_KEY_ID || !CF_ACCESS_SECRET || !CF_BUCKET) return null;
	return {
		endpoint: CF_ENDPOINT.replace(/\/+$/, ''),
		accessKeyId: CF_ACCESS_KEY_ID,
		secretAccessKey: CF_ACCESS_SECRET,
		bucket: CF_BUCKET,
	};
}

/** Lazily build the S3 client (R2 uses the fixed `auto` region). */
function s3(settings: R2Settings): S3Client {
	client ??= new S3Client({
		region: 'auto',
		endpoint: settings.endpoint,
		credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
	});
	return client;
}

/**
 * Validate a storage key.
 * @param key - Candidate key (`avatars/<userId>.png`).
 * @returns The key, unchanged.
 * @throws Error `INVALID_STORAGE_PATH` when the key could escape the storage root.
 */
export function assertSafeKey(key: string): string {
	if (!SAFE_KEY.test(key)) throw new Error('INVALID_STORAGE_PATH');
	return key;
}

/** Absolute disk path of a key under `STORAGE_DIR`. */
function diskPath(key: string): string {
	return path.resolve(process.cwd(), env().STORAGE_DIR, ...assertSafeKey(key).split('/'));
}

/** @returns Whether files go to R2 (`true`) or to the local disk. */
export function isR2Enabled(): boolean {
	return r2Settings() !== null;
}

/**
 * Store bytes at a key.
 * @param key - Storage key.
 * @param body - File bytes.
 * @param contentType - MIME type kept on the R2 object.
 */
export async function putFile(key: string, body: Uint8Array, contentType: string): Promise<void> {
	const settings = r2Settings();
	if (settings !== null) {
		await s3(settings).send(
			new PutObjectCommand({
				Bucket: settings.bucket,
				Key: assertSafeKey(key),
				Body: body,
				ContentType: contentType,
			}),
		);
		return;
	}
	const target = diskPath(key);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, body);
}

/**
 * Read a stored file.
 * @param key - Storage key.
 * @returns The file bytes.
 */
export async function getFile(key: string): Promise<Uint8Array> {
	const settings = r2Settings();
	if (settings === null) return readFile(diskPath(key));
	const response = await s3(settings).send(
		new GetObjectCommand({ Bucket: settings.bucket, Key: assertSafeKey(key) }),
	);
	if (!response.Body) throw new Error('R2_EMPTY_BODY');
	return response.Body.transformToByteArray();
}

/** @returns Whether an fs error is a missing file. */
function isMissingFile(error: Error): boolean {
	return 'code' in error && error.code === 'ENOENT';
}

/**
 * Delete a stored file. Idempotent on both backends.
 * @param key - Storage key.
 */
export async function deleteFile(key: string): Promise<void> {
	const settings = r2Settings();
	if (settings !== null) {
		await s3(settings).send(
			new DeleteObjectCommand({ Bucket: settings.bucket, Key: assertSafeKey(key) }),
		);
		return;
	}
	try {
		await unlink(diskPath(key));
	} catch (error) {
		if (!(error instanceof Error) || !isMissingFile(error)) throw error;
	}
}
