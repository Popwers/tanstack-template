#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * stack-conformity — checks a web project against Lionel's standard. Read-only: it only reads files.
 *
 *   stack-conformity [repo-dir] [--stack <id>]
 *
 * Installed on PATH by `setup_my_mac.sh` from `dotfiles/scripts/stack-conformity.ts`. Templates vendor a
 * copy (`scripts/conformity.ts`) so their CI runs it without the dotfiles. Exits 1 when a check fails.
 *
 * Layout: the stack is detected first (or forced with `--stack`); the COMMON checks run on every stack,
 * then the profile's own checks. A profile with `isImplemented: false` is detected and reported, and its
 * expectations are listed as pending, so a repo is never silently judged by another stack's rules.
 * To add a stack: fill its `checks` in PROFILES and flip `isImplemented`.
 */

/** Outcome of one check. `pending` = expected for this stack, not implemented yet (never fails the run). */
interface CheckResult {
	name: string;
	status: 'pass' | 'fail' | 'pending';
	detail: string;
}

/** The parts of package.json the checks read. */
interface PackageManifest {
	scripts: Map<string, string>;
	dependencies: Map<string, string>;
}

/** Everything a check reads, loaded once. */
interface RepoContext {
	root: string;
	manifest: PackageManifest | null;
	/** Vite+ config text (`vite.config.{ts,mts,js,mjs}`), `''` when absent. */
	viteConfig: string;
	dockerfile: string;
	entrypoint: string;
	workflows: string[];
	/** App sources (`src/`, `config/`) and root config files, with their text. */
	sources: Array<{ file: string; text: string }>;
}

/** One check: a name and how to judge the repo. */
interface Check {
	name: string;
	run: (context: RepoContext) => CheckResult;
}

/** A stack profile: how to recognise it, and what it adds to the common checks. */
interface StackProfile {
	id: string;
	label: string;
	detect: (context: RepoContext) => boolean;
	isImplemented: boolean;
	/** Implemented checks, or for a pending profile the expectations to list. */
	checks: Check[];
	pendingExpectations: string[];
}

/* ------------------------------------------------------------------ */
/* ------------------------- FILE HELPERS --------------------------- */
/* ------------------------------------------------------------------ */

/** Directories never scanned. */
const SKIPPED_DIRS = new Set([
	'node_modules',
	'.git',
	'.output',
	'.tanstack',
	'.nitro',
	'.astro',
	'.strapi',
	'.cache',
	'dist',
	'build',
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
 * @param field - Field name.
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

/** @returns Scripts and every dependency kind merged, or `null` without a package.json. */
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

/** @returns The text of the first existing candidate under `root`, or `''`. */
function readFirst(root: string, candidates: string[]): string {
	const found = candidates.map((name) => path.join(root, name)).find((file) => existsSync(file));
	return found === undefined ? '' : readFileSync(found, 'utf8');
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

/** @returns Whether a file exists at any of `names` under `root`. */
function hasAny(root: string, names: string[]): boolean {
	return names.some((name) => existsSync(path.join(root, name)));
}

/**
 * Load everything the checks read.
 * @param root - Repo directory.
 * @returns The context.
 */
function loadContext(root: string): RepoContext {
	const sourceFiles = [
		...findFiles(path.join(root, 'src'), /\.(ts|tsx|js|jsx|mjs|mts|astro)$/),
		...findFiles(path.join(root, 'config'), /\.(ts|js|mjs|mts)$/),
		...readdirSync(root)
			.filter((entry) => /\.config\.(ts|mts|js|mjs)$/.test(entry))
			.map((entry) => path.join(root, entry)),
	];
	return {
		root,
		manifest: readManifest(root),
		viteConfig: readFirst(root, [
			'vite.config.ts',
			'vite.config.mts',
			'vite.config.js',
			'vite.config.mjs',
		]),
		dockerfile: readText(path.join(root, 'Dockerfile')),
		entrypoint: readFirst(root, [
			'docker-entrypoint.sh',
			'entrypoint.sh',
			'start.mjs',
			'scripts/docker-entrypoint.sh',
		]),
		workflows: findFiles(path.join(root, '.github/workflows'), /\.ya?ml$/).map((file) =>
			readFileSync(file, 'utf8'),
		),
		sources: sourceFiles.map((file) => ({ file, text: readFileSync(file, 'utf8') })),
	};
}

/** @returns Whether the manifest declares a dependency. */
function hasDependency(context: RepoContext, name: string): boolean {
	return context.manifest?.dependencies.has(name) ?? false;
}

/** Build a result. */
function result(name: string, isPass: boolean, detail: string): CheckResult {
	return { name, status: isPass ? 'pass' : 'fail', detail };
}

/* ------------------------------------------------------------------ */
/* --------------------------- FMT KEYS ----------------------------- */
/* ------------------------------------------------------------------ */

/** Oxfmt keys, used when the target repo has no `node_modules/oxfmt` schema. */
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

/** Keys the standard requires in every `fmt` block. */
const REQUIRED_FMT_KEYS = ['useTabs', 'tabWidth', 'printWidth', 'singleQuote', 'semi'];

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

/**
 * Top-level keys of an object literal body (text between the braces), spreads excluded.
 * @param body - Object body.
 * @returns Key names.
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
			const name = /^[A-Za-z_$][\w$]*/.exec(body.slice(index))?.[0] ?? '';
			if (
				body
					.slice(index + name.length)
					.trimStart()
					.startsWith(':')
			)
				keys.push(name);
			isKeyPosition = false;
			index += name.length - 1;
		}
	}
	return keys;
}

/** @returns The body of `fmt: { … }` or of a `const fmt = { … }` it references, or `null`. */
function fmtBlock(config: string): string | null {
	const match = /(?:const\s+fmt\b[^=]*=|\bfmt\s*:)\s*\{/.exec(config);
	if (match === null) return null;
	const open = match.index + match[0].length - 1;
	const close = matchingBrace(config, open);
	return close === -1 ? null : config.slice(open + 1, close);
}

/** @returns Oxfmt keys the target accepts: its installed schema, else the fallback list. */
function validFmtKeys(root: string): Set<string> {
	const schemaFile = path.join(root, 'node_modules/oxfmt/configuration_schema.json');
	if (!existsSync(schemaFile)) return new Set(FALLBACK_FMT_KEYS);
	const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
	const properties = isRecord(schema) ? schema.properties : undefined;
	return new Set(isRecord(properties) ? Object.keys(properties) : FALLBACK_FMT_KEYS);
}

/* ------------------------------------------------------------------ */
/* ------------------------- COMMON CHECKS -------------------------- */
/* ------------------------------------------------------------------ */

/** @returns Whether the repo uses Tailwind (same detection as the global CLAUDE.md). */
function usesTailwind(context: RepoContext): boolean {
	if (hasDependency(context, 'tailwindcss') || hasDependency(context, '@tailwindcss/vite')) return true;
	if (
		hasAny(context.root, [
			'components.json',
			'tailwind.config.js',
			'tailwind.config.ts',
			'tailwind.config.mjs',
		])
	) {
		return true;
	}
	return findFiles(path.join(context.root, 'src'), /\.css$/).some((file) =>
		/@import\s+['"]tailwindcss['"]|@tailwind\s/.test(readFileSync(file, 'utf8')),
	);
}

/** Checks every stack with a package.json runs. */
const COMMON_CHECKS: Check[] = [
	{
		name: 'Vite+',
		run: (context) =>
			result(
				'Vite+',
				hasDependency(context, 'vite-plus') && context.viteConfig.length > 0,
				hasDependency(context, 'vite-plus')
					? 'vite-plus + config'
					: 'no vite-plus dependency or vite.config',
			),
	},
	{
		// Oxfmt silently ignores unknown keys (`quoteStyle`, `lineWidth`…): the format drifts unnoticed.
		name: 'fmt keys',
		run: (context) => {
			const block = fmtBlock(context.viteConfig);
			if (block === null) return result('fmt keys', false, 'no `fmt` block in vite.config');
			const keys = topLevelKeys(block);
			const valid = validFmtKeys(context.root);
			const invalid = keys.filter((key) => !valid.has(key));
			const missing = REQUIRED_FMT_KEYS.filter((key) => !keys.includes(key));
			const problems = [
				invalid.length > 0 ? `invalid: ${invalid.join(', ')}` : '',
				missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
			].filter(Boolean);
			return result('fmt keys', problems.length === 0, problems.join('; ') || 'all keys valid');
		},
	},
	{
		name: 'anti-slop',
		run: (context) => {
			const isVendored = existsSync(path.join(context.root, 'tools/oxlint/anti-slop/index.ts'));
			const isRegistered = context.viteConfig.includes('anti-slop/index.ts');
			return result(
				'anti-slop',
				isVendored && isRegistered,
				isVendored && isRegistered
					? 'vendored + registered'
					: 'tools/oxlint/anti-slop/ missing or not in lint.jsPlugins',
			);
		},
	},
	{
		name: '@shadcn/lint',
		run: (context) => {
			if (!usesTailwind(context)) return result('@shadcn/lint', true, 'no Tailwind: not required');
			const isInstalled = hasDependency(context, '@shadcn/lint');
			return result(
				'@shadcn/lint',
				isInstalled && context.viteConfig.includes('@shadcn/lint'),
				isInstalled ? 'installed' : 'not in devDependencies or not registered',
			);
		},
	},
	{
		name: 'cn',
		run: (context) => {
			if (!usesTailwind(context)) return result('cn', true, 'no Tailwind: not required');
			return result(
				'cn',
				hasDependency(context, 'cn'),
				hasDependency(context, 'cn') ? 'installed' : 'npm `cn` missing',
			);
		},
	},
	{
		name: 'pinned ranges',
		run: (context) => {
			const floating = [...(context.manifest?.dependencies ?? [])].filter(([, range]) =>
				/(^|@)(latest|next|\*)$|^$/.test(range.trim()),
			);
			return result(
				'pinned ranges',
				floating.length === 0,
				floating.length === 0
					? 'no latest/*'
					: floating.map(([name, range]) => `${name}@${range || '""'}`).join(', '),
			);
		},
	},
	{
		name: 'start script',
		run: (context) => {
			const start = context.manifest?.scripts.get('start');
			return result('start script', start !== undefined, start ?? 'no `start` script');
		},
	},
	{
		name: 'Dockerfile',
		run: (context) =>
			result(
				'Dockerfile',
				context.dockerfile.length > 0,
				context.dockerfile.length > 0 ? 'present' : 'missing',
			),
	},
	{
		name: 'Docker HEALTHCHECK',
		run: (context) =>
			result(
				'Docker HEALTHCHECK',
				/^HEALTHCHECK\s/m.test(context.dockerfile),
				/^HEALTHCHECK\s/m.test(context.dockerfile) ? 'declared' : 'no HEALTHCHECK in Dockerfile',
			),
	},
	{
		name: 'e2e config',
		run: (context) => {
			const isPresent = hasAny(context.root, ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js']);
			return result('e2e config', isPresent, isPresent ? 'present' : 'no e2e.config.*');
		},
	},
	{
		name: 'release workflow',
		run: (context) => {
			const hasRelease = context.workflows.some((text) => text.includes('semantic-release'));
			return result(
				'release workflow',
				hasRelease,
				hasRelease ? 'semantic-release' : 'no semantic-release workflow',
			);
		},
	},
];

/* ------------------------------------------------------------------ */
/* ----------------------- SHARED PROFILE CHECKS -------------------- */
/* ------------------------------------------------------------------ */

/** Packages that mean the app stores its data in SQLite instead of Postgres. */
const SQLITE_PACKAGES = [
	'better-sqlite3',
	'sqlite3',
	'@libsql/client',
	'libsql',
	'sql.js',
	'@tursodatabase/serverless',
];

/** Source patterns of a SQLite driver or dialect (Drizzle, Bun, Strapi `client: 'sqlite'`). */
const SQLITE_SOURCE =
	/bun:sqlite|drizzle-orm\/(better-sqlite3|bun-sqlite|libsql|sqlite-proxy)|dialect:\s*['"](sqlite|turso)['"]|client:\s*['"](sqlite|better-sqlite3)['"]/;

/** Postgres only: shared by every profile with a database. */
const NO_SQLITE_CHECK: Check = {
	name: 'no SQLite',
	run: (context) => {
		const packages = SQLITE_PACKAGES.filter((name) => hasDependency(context, name));
		const files = context.sources
			.filter(({ text }) => SQLITE_SOURCE.test(text))
			.map(({ file }) => path.relative(context.root, file));
		return result(
			'no SQLite',
			packages.length === 0 && files.length === 0,
			[...packages, ...files].join(', ') || 'Postgres only',
		);
	},
};

/** Public sites name their host in the legal notice, from one `export const HOSTING`. */
const LEGAL_HOSTING_CHECK: Check = {
	name: 'legal HOSTING',
	run: (context) => {
		const hosting = context.sources
			.map(({ text }) => /export\s+const\s+HOSTING\s*=\s*(['"`])([\s\S]*?)\1/.exec(text)?.[2]?.trim())
			.find((value) => value !== undefined);
		const isSet = hosting !== undefined && hosting.length > 0 && !/TODO|TBD|xxx/i.test(hosting);
		const hint = context.sources.some(({ text }) => /Hetzner/.test(text))
			? ' (legal text names Hetzner inline: move it to HOSTING)'
			: '';
		return result(
			'legal HOSTING',
			isSet,
			isSet ? hosting.slice(0, 40) : `no non-empty \`export const HOSTING\`${hint}`,
		);
	},
};

/* ------------------------------------------------------------------ */
/* ----------------------------- PROFILES --------------------------- */
/* ------------------------------------------------------------------ */

/** Detection order matters: the first matching profile wins. */
const PROFILES: StackProfile[] = [
	{
		id: 'tanstack',
		label: 'TanStack Start (Nitro, bun)',
		detect: (context) => hasDependency(context, '@tanstack/react-start'),
		isImplemented: true,
		pendingExpectations: [],
		checks: [
			{
				name: 'Nitro bun output',
				run: (context) => {
					const start = context.manifest?.scripts.get('start') ?? '';
					const isNitro =
						hasDependency(context, 'nitro') && start.includes('.output/server/index.mjs');
					return result(
						'Nitro bun output',
						isNitro,
						isNitro ? start : 'needs `nitro` and start = bun .output/server/index.mjs',
					);
				},
			},
			{
				name: '/api/health',
				run: (context) => {
					const hasRoute =
						findFiles(path.join(context.root, 'src/routes'), /^health\.(ts|tsx)$/).length > 0 ||
						context.sources.some(({ text }) => text.includes("'/api/health'"));
					return result('/api/health', hasRoute, hasRoute ? 'route found' : 'no /api/health route');
				},
			},
			{
				name: 'migrate at boot',
				run: (context) => {
					const isMigrating =
						/migrat/i.test(context.entrypoint) ||
						/(ENTRYPOINT|CMD)[^\n]*migrat/i.test(context.dockerfile);
					return result(
						'migrate at boot',
						isMigrating,
						isMigrating
							? 'entrypoint migrates'
							: 'no entrypoint running migrations before the server',
					);
				},
			},
			{
				name: 'Postgres driver',
				run: (context) => {
					const hasDriver = hasDependency(context, 'postgres') || hasDependency(context, 'pg');
					return result(
						'Postgres driver',
						hasDriver,
						hasDriver ? 'postgres-js / pg' : 'no postgres or pg dependency',
					);
				},
			},
			NO_SQLITE_CHECK,
			LEGAL_HOSTING_CHECK,
		],
	},
	{
		id: 'astro',
		label: 'Astro',
		detect: (context) => hasDependency(context, 'astro'),
		isImplemented: false,
		checks: [LEGAL_HOSTING_CHECK],
		pendingExpectations: [
			'`astro build` output served by the Node/Bun adapter (`start` = node/bun dist/server/entry.mjs or start.mjs)',
			'health endpoint (src/pages/api/health.ts or the adapter route) wired to the Docker HEALTHCHECK',
			'`make dev` / `make build` call `vp run dev|build` (never `vp dev` on Astro)',
			'Sentry via sentry.{client,server}.config.*; Turnstile on public forms',
			'legal pages read HOSTING (Hetzner) from one constant',
			'if it talks to Strapi: STRAPI_URL / STRAPI_TOKEN validated at boot',
		],
	},
	{
		id: 'strapi',
		label: 'Strapi',
		detect: (context) => hasDependency(context, '@strapi/strapi'),
		isImplemented: false,
		checks: [NO_SQLITE_CHECK],
		pendingExpectations: [
			'config/database: client `postgres`, no sqlite default (NO_SQLITE runs already)',
			'health: Strapi `/_health` used by the Docker HEALTHCHECK',
			'npm lockfile (`package-lock.json`) and `vp` delegating to npm',
			'APP_KEYS / API_TOKEN_SALT / ADMIN_JWT_SECRET / JWT_SECRET / TRANSFER_TOKEN_SALT documented, never committed',
			'uploads on R2 (`@strapi/provider-upload-aws-s3`) with the EU endpoint',
			'no legal HOSTING (the front owns the legal pages)',
		],
	},
	{
		id: 'static',
		label: 'Static site (HTML5)',
		detect: (context) => context.manifest === null && existsSync(path.join(context.root, 'index.html')),
		isImplemented: false,
		checks: [],
		pendingExpectations: [
			'no package.json: common JS checks do not apply',
			'Dockerfile on a static server (caddy/nginx alpine) with a HEALTHCHECK',
			'legal page naming HOSTING; robots.txt; security headers in the server config',
		],
	},
];

/* ------------------------------------------------------------------ */
/* ------------------------------ MAIN ------------------------------ */
/* ------------------------------------------------------------------ */

/**
 * Run the common checks and the profile's.
 * @param context - Loaded repo.
 * @param profile - Detected or forced profile, `undefined` when no profile matches.
 * @returns Every result, in report order.
 */
function runChecks(context: RepoContext, profile: StackProfile | undefined): CheckResult[] {
	const common = context.manifest === null ? [] : COMMON_CHECKS.map((check) => check.run(context));
	if (profile === undefined) {
		return [
			...common,
			{ name: 'stack profile', status: 'pending', detail: 'no profile matches: common checks only' },
		];
	}
	const own = profile.checks.map((check) => check.run(context));
	const pending = profile.isImplemented
		? []
		: profile.pendingExpectations.map((expectation): CheckResult => ({
				name: `${profile.id} (pending)`,
				status: 'pending',
				detail: expectation,
			}));
	return [...common, ...own, ...pending];
}

/** Command-line arguments. */
interface CliArguments {
	root: string;
	forcedStack: string | undefined;
}

/** Parse `[dir] [--stack <id>]`. */
function parseArguments(argv: string[]): CliArguments {
	const stackIndex = argv.indexOf('--stack');
	const forcedStack = stackIndex === -1 ? undefined : argv[stackIndex + 1];
	const positional = argv.filter(
		(argument, index) => !argument.startsWith('--') && (stackIndex === -1 || index !== stackIndex + 1),
	);
	return { root: path.resolve(positional[0] ?? process.cwd()), forcedStack };
}

const { root, forcedStack } = parseArguments(process.argv.slice(2));
if (!existsSync(root)) {
	console.error(`stack-conformity: ${root} does not exist`);
	process.exit(2);
}
const context = loadContext(root);
const profile =
	forcedStack === undefined
		? PROFILES.find((candidate) => candidate.detect(context))
		: PROFILES.find((candidate) => candidate.id === forcedStack);
if (forcedStack !== undefined && profile === undefined) {
	console.error(
		`stack-conformity: unknown stack "${forcedStack}" (known: ${PROFILES.map((p) => p.id).join(', ')})`,
	);
	process.exit(2);
}

const results = runChecks(context, profile);
const width = Math.max(...results.map((entry) => entry.name.length));
const marks = { pass: '✓', fail: '✗', pending: '·' } as const;
const profileLabel =
	profile === undefined ? 'none' : `${profile.label}${profile.isImplemented ? '' : ' — profile pending'}`;
console.log(`Conformity: ${root}\nStack: ${profileLabel}\n`);
for (const entry of results)
	console.log(`${marks[entry.status]} ${entry.name.padEnd(width)}  ${entry.detail}`);
const failures = results.filter((entry) => entry.status === 'fail').length;
console.log(failures === 0 ? '\nAll checks pass.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
