#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * MyStudio conformity check for a TanStack Start web project. Read-only: it only reads files.
 *
 *   bun scripts/conformity.ts [repo-dir]     (default: the current directory)
 *   make conformity DIR=../other-repo
 *
 * Exits 1 when any check fails, so CI can gate on it. Every check is static (no install, no build):
 * it runs the same on a fresh clone and on a repo someone else handed over.
 */

/** Outcome of one check. */
interface CheckResult {
	name: string;
	isPass: boolean;
	detail: string;
}

/** The parts of package.json the checks read. */
interface PackageManifest {
	scripts: Map<string, string>;
	dependencies: Map<string, string>;
}

/** Oxfmt keys accepted by the installed schema; used when the target repo has no node_modules. */
const FALLBACK_FMT_KEYS = [
	'arrowParens',
	'associations',
	'astro',
	'bracketSameLine',
	'bracketSpacing',
	'embeddedLanguageFormatting',
	'endOfLine',
	'experimentalOperatorPosition',
	'htmlWhitespaceSensitivity',
	'ignorePatterns',
	'insertFinalNewline',
	'jsdoc',
	'jsxSingleQuote',
	'objectWrap',
	'overrides',
	'printWidth',
	'proseWrap',
	'quoteProps',
	'semi',
	'singleAttributePerLine',
	'singleQuote',
	'sortImports',
	'sortPackageJson',
	'sortTailwindcss',
	'svelte',
	'tabWidth',
	'trailingComma',
	'useTabs',
	'vueIndentScriptAndStyle',
];

/** Packages that mean the app stores its data in SQLite instead of Postgres. */
const SQLITE_PACKAGES = [
	'better-sqlite3',
	'sqlite3',
	'@libsql/client',
	'libsql',
	'sql.js',
	'@tursodatabase/serverless',
];

/** Source patterns of a SQLite driver or dialect. */
const SQLITE_SOURCE =
	/bun:sqlite|drizzle-orm\/(better-sqlite3|bun-sqlite|libsql|sqlite-proxy)|dialect:\s*['"](sqlite|turso)['"]/;

/** Directories never scanned. */
const SKIPPED_DIRS = new Set([
	'node_modules',
	'.git',
	'.output',
	'.tanstack',
	'.nitro',
	'dist',
	'.e2e',
	'coverage',
]);

/** @returns Whether a parsed JSON value is a plain object. */
function isRecord(
	value: ReturnType<typeof JSON.parse>,
): value is { [key: string]: ReturnType<typeof JSON.parse> } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @returns Whether a parsed JSON value is a string. */
function isString(value: ReturnType<typeof JSON.parse>): value is string {
	return typeof value === 'string';
}

/**
 * String entries of a JSON object field.
 * @param source - Parsed object.
 * @param field - Field name (`scripts`, `dependencies`…).
 * @returns The string entries, empty when the field is missing.
 */
function stringEntries(
	source: { [key: string]: ReturnType<typeof JSON.parse> },
	field: string,
): Array<[string, string]> {
	const value = source[field];
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([key, entry]): Array<[string, string]> =>
		isString(entry) ? [[key, entry]] : [],
	);
}

/**
 * Read package.json.
 * @param root - Repo directory.
 * @returns Scripts and every dependency kind merged, or `null` when absent.
 */
function readManifest(root: string): PackageManifest | null {
	const file = path.join(root, 'package.json');
	if (!existsSync(file)) return null;
	const parsed = JSON.parse(readFileSync(file, 'utf8'));
	if (!isRecord(parsed)) return null;
	return {
		scripts: new Map(stringEntries(parsed, 'scripts')),
		dependencies: new Map([
			...stringEntries(parsed, 'dependencies'),
			...stringEntries(parsed, 'devDependencies'),
			...stringEntries(parsed, 'optionalDependencies'),
		]),
	};
}

/** @returns The file's text, or `''` when it does not exist. */
function readText(file: string): string {
	return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/**
 * Every file under `dir` whose name matches.
 * @param dir - Directory to walk.
 * @param pattern - File name pattern.
 * @returns Absolute paths.
 */
function findFiles(dir: string, pattern: RegExp): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((entry) => {
		if (SKIPPED_DIRS.has(entry)) return [];
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) return findFiles(full, pattern);
		return pattern.test(entry) ? [full] : [];
	});
}

/**
 * Index of the brace closing the one at `open`, skipping strings and comments.
 * @param text - Source text.
 * @param open - Index of `{`.
 * @returns Index of the matching `}`, or -1.
 */
function matchingBrace(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];
		if (char === '/' && next === '/') {
			index = text.indexOf('\n', index);
			if (index === -1) return -1;
		} else if (char === '/' && next === '*') {
			index = text.indexOf('*/', index) + 1;
		} else if (char === '"' || char === "'" || char === '`') {
			index = skipString(text, index);
		} else if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** @returns Index of the closing quote of the string starting at `start`. */
function skipString(text: string, start: number): number {
	const quote = text[start];
	for (let index = start + 1; index < text.length; index += 1) {
		if (text[index] === '\\') index += 1;
		else if (text[index] === quote) return index;
	}
	return text.length;
}

/**
 * Top-level keys of an object literal body (`{ … }` without the braces).
 * @param body - Text between the braces.
 * @returns Key names, spreads excluded.
 */
function topLevelKeys(body: string): string[] {
	const keys: string[] = [];
	let depth = 0;
	let isKeyPosition = true;
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index] ?? '';
		if (char === '/' && body[index + 1] === '/') {
			index = body.indexOf('\n', index);
			if (index === -1) break;
			continue;
		}
		if (char === '/' && body[index + 1] === '*') {
			index = body.indexOf('*/', index) + 1;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			const end = skipString(body, index);
			if (
				depth === 0 &&
				isKeyPosition &&
				body
					.slice(end + 1)
					.trimStart()
					.startsWith(':')
			) {
				keys.push(body.slice(index + 1, end));
				isKeyPosition = false;
			}
			index = end;
			continue;
		}
		if ('{[('.includes(char)) depth += 1;
		else if ('}])'.includes(char)) depth -= 1;
		else if (depth === 0 && char === ',') isKeyPosition = true;
		else if (depth === 0 && isKeyPosition && /[A-Za-z_$]/.test(char)) {
			const match = /^[A-Za-z_$][\w$]*/.exec(body.slice(index));
			const name = match?.[0] ?? '';
			const rest = body.slice(index + name.length).trimStart();
			if (rest.startsWith(':')) keys.push(name);
			isKeyPosition = false;
			index += name.length - 1;
		}
	}
	return keys;
}

/**
 * Locate the Oxfmt block of a Vite+ config: `fmt: { … }` or a `const fmt = { … }` it references.
 * @param config - vite.config.ts text.
 * @returns The block body, or `null` when the config has none.
 */
function fmtBlock(config: string): string | null {
	const match = /(?:const\s+fmt\b[^=]*=|\bfmt\s*:)\s*\{/.exec(config);
	if (match === null) return null;
	const open = match.index + match[0].length - 1;
	const close = matchingBrace(config, open);
	return close === -1 ? null : config.slice(open + 1, close);
}

/**
 * Oxfmt keys the target accepts: its installed schema, else the template's list.
 * @param root - Repo directory.
 * @returns Valid top-level keys.
 */
function validFmtKeys(root: string): Set<string> {
	const schemaFile = path.join(root, 'node_modules/oxfmt/configuration_schema.json');
	if (!existsSync(schemaFile)) return new Set(FALLBACK_FMT_KEYS);
	const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
	const properties = isRecord(schema) ? schema.properties : undefined;
	return new Set(isRecord(properties) ? Object.keys(properties) : FALLBACK_FMT_KEYS);
}

/**
 * Whether the repo uses Tailwind (same detection as the global CLAUDE.md).
 * @param root - Repo directory.
 * @param manifest - Parsed package.json.
 * @returns True for a Tailwind app.
 */
function usesTailwind(root: string, manifest: PackageManifest): boolean {
	if (manifest.dependencies.has('tailwindcss') || manifest.dependencies.has('@tailwindcss/vite'))
		return true;
	if (existsSync(path.join(root, 'components.json'))) return true;
	return findFiles(path.join(root, 'src'), /\.css$/).some((file) =>
		/@import\s+['"]tailwindcss['"]|@tailwind\s/.test(readFileSync(file, 'utf8')),
	);
}

/**
 * Run every check against a repo.
 * @param root - Repo directory.
 * @returns One result per check.
 */
function runChecks(root: string): CheckResult[] {
	const manifest = readManifest(root);
	if (manifest === null) return [{ name: 'package.json', isPass: false, detail: 'no package.json' }];

	const config = readText(path.join(root, 'vite.config.ts'));
	const sourceFiles = findFiles(path.join(root, 'src'), /\.(ts|tsx|js|jsx|mjs)$/);
	const rootTsFiles = findFiles(root, /^(drizzle\.config|vite\.config)\.(ts|js|mjs)$/).filter(
		(file) => path.dirname(file) === root,
	);
	const sources = [...sourceFiles, ...rootTsFiles].map((file) => ({
		file,
		text: readFileSync(file, 'utf8'),
	}));
	const results: CheckResult[] = [];
	const add = (name: string, isPass: boolean, detail: string) => results.push({ name, isPass, detail });

	// Oxfmt silently ignores unknown keys (`quoteStyle`, `lineWidth`…), so the format drifts unnoticed.
	const fmt = fmtBlock(config);
	if (fmt === null) {
		add('fmt keys', false, 'no `fmt` block in vite.config.ts');
	} else {
		const valid = validFmtKeys(root);
		const invalid = topLevelKeys(fmt).filter((key) => !valid.has(key));
		const missing = ['useTabs', 'tabWidth', 'printWidth', 'singleQuote', 'semi'].filter(
			(key) => !topLevelKeys(fmt).includes(key),
		);
		add(
			'fmt keys',
			invalid.length === 0 && missing.length === 0,
			[
				invalid.length > 0 ? `invalid: ${invalid.join(', ')}` : '',
				missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
			]
				.filter(Boolean)
				.join('; ') || 'all keys valid',
		);
	}

	const hasAntiSlopPlugin = existsSync(path.join(root, 'tools/oxlint/anti-slop/index.ts'));
	add(
		'anti-slop',
		hasAntiSlopPlugin && config.includes('anti-slop/index.ts'),
		hasAntiSlopPlugin
			? 'vendored + registered'
			: 'tools/oxlint/anti-slop/ missing or not in lint.jsPlugins',
	);

	if (usesTailwind(root, manifest)) {
		add(
			'@shadcn/lint',
			manifest.dependencies.has('@shadcn/lint') && config.includes('@shadcn/lint'),
			manifest.dependencies.has('@shadcn/lint')
				? 'installed'
				: 'not in devDependencies or not registered',
		);
		add(
			'cn',
			manifest.dependencies.has('cn'),
			manifest.dependencies.has('cn') ? 'installed' : 'npm `cn` missing',
		);
	} else {
		add('@shadcn/lint', true, 'no Tailwind: not required');
		add('cn', true, 'no Tailwind: not required');
	}

	const floating = [...manifest.dependencies].filter(([, range]) =>
		/(^|@)(latest|next|\*)$|^$/.test(range.trim()),
	);
	add(
		'pinned ranges',
		floating.length === 0,
		floating.length === 0
			? 'no latest/*'
			: floating.map(([name, range]) => `${name}@${range || '""'}`).join(', '),
	);

	const start = manifest.scripts.get('start');
	add('start script', start !== undefined, start ?? 'no `start` script');

	const hasHealthRoute =
		findFiles(path.join(root, 'src/routes'), /^health\.(ts|tsx)$/).length > 0 ||
		sources.some(({ text }) => text.includes("'/api/health'"));
	add('/api/health', hasHealthRoute, hasHealthRoute ? 'route found' : 'no /api/health route');

	const dockerfile = readText(path.join(root, 'Dockerfile'));
	add('Dockerfile', dockerfile.length > 0, dockerfile.length > 0 ? 'present' : 'missing');

	const entrypoint = readText(path.join(root, 'docker-entrypoint.sh'));
	const migratesAtBoot = /migrat/i.test(entrypoint) || /(ENTRYPOINT|CMD)[^\n]*migrat/i.test(dockerfile);
	add(
		'migrate at boot',
		migratesAtBoot,
		migratesAtBoot ? 'entrypoint migrates' : 'no entrypoint running migrations before the server',
	);

	const sqlitePackages = SQLITE_PACKAGES.filter((name) => manifest.dependencies.has(name));
	const sqliteFiles = sources
		.filter(({ text }) => SQLITE_SOURCE.test(text))
		.map(({ file }) => path.relative(root, file));
	add(
		'no SQLite',
		sqlitePackages.length === 0 && sqliteFiles.length === 0,
		[...sqlitePackages, ...sqliteFiles].join(', ') || 'Postgres only',
	);

	const hasE2eConfig = existsSync(path.join(root, 'e2e.config.ts'));
	add('e2e.config.ts', hasE2eConfig, hasE2eConfig ? 'present' : 'missing');

	const workflows = findFiles(path.join(root, '.github/workflows'), /\.ya?ml$/);
	const hasRelease = workflows.some((file) => readFileSync(file, 'utf8').includes('semantic-release'));
	add('release workflow', hasRelease, hasRelease ? 'semantic-release' : 'no semantic-release workflow');

	const hosting = sources
		.map(({ text }) => /export\s+const\s+HOSTING\s*=\s*(['"`])([\s\S]*?)\1/.exec(text)?.[2]?.trim())
		.find((value) => value !== undefined);
	const isHostingSet = hosting !== undefined && hosting.length > 0 && !/TODO|TBD|xxx/i.test(hosting);
	const inlineHostHint = sources.some(({ text }) => /Hetzner/.test(text))
		? ' (legal text names Hetzner inline: move it to HOSTING)'
		: '';
	add(
		'legal HOSTING',
		isHostingSet,
		isHostingSet ? hosting.slice(0, 40) : `no non-empty \`export const HOSTING\`${inlineHostHint}`,
	);

	return results;
}

const root = path.resolve(process.argv[2] ?? process.cwd());
const results = runChecks(root);
const width = Math.max(...results.map((result) => result.name.length));
console.log(`Conformity: ${root}\n`);
for (const result of results) {
	console.log(`${result.isPass ? '✓' : '✗'} ${result.name.padEnd(width)}  ${result.detail}`);
}
const failures = results.filter((result) => !result.isPass).length;
console.log(failures === 0 ? '\nAll checks pass.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
