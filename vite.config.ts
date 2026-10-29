import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import type { PluginOption } from 'vite-plus';
import { defineConfig } from 'vite-plus';
import type { OxfmtConfig } from 'vite-plus/fmt';
import type { DummyRuleMap, OxlintConfig, OxlintOverride } from 'vite-plus/lint';

/**
 * Vite+ config: TanStack Start on Nitro (bun preset), Lionel's fmt/lint standard
 * (https://gist.github.com/Popwers/e112d96aea101e5aa35311048644d9cf), vendored anti-slop and @shadcn/lint.
 *
 * `fmt` and `lint` are typed outside `defineConfig`: an unknown Oxfmt key (`quoteStyle`, `lineWidth`…) is then
 * a type error instead of being silently ignored. `stack-conformity` checks the same keys.
 */

/** Under Vitest the app-server plugins load React in the SSR runner and keep handles open. */
const isTest = process.env.VITEST === 'true';

/** Coolify build args: SOURCE_COMMIT (Include Source Commit) and the optional SENTRY_AUTH_TOKEN. */
const sentryRelease = (process.env.SENTRY_RELEASE || process.env.SOURCE_COMMIT || '').trim();
const sentryAuthToken = (process.env.SENTRY_AUTH_TOKEN || '').trim();
const sentryOrg = (process.env.SENTRY_ORG || 'mystudiodigital').trim();
const sentryProject = (process.env.SENTRY_PROJECT || '').trim();

const hasShadcnLint = existsSync('node_modules/@shadcn/lint');

function shadcnLintRules(): DummyRuleMap {
	if (!hasShadcnLint) {
		return {};
	}

	return {
		'shadcn/no-restyle': ['error', { allow: ['layout'] }],
		'shadcn/no-raw-colors': 'error',
		'shadcn/no-arbitrary-values': 'error',
		'shadcn/no-inline-styles': 'error',
		'shadcn/no-unknown-classes': 'error',
		'shadcn/require-static-classes': 'error',
	};
}

function shadcnLintOverrides(): OxlintOverride[] {
	if (!hasShadcnLint) {
		return [];
	}

	return [
		{
			files: ['**/components/ui/**', 'src/components/ui/**'],
			rules: {
				// Primitives define the system; generated code uses calc() and data-slot selectors.
				'shadcn/no-restyle': 'off',
				'shadcn/no-arbitrary-values': 'off',
			},
		},
	];
}

/** Agent tooling and the vendored lint plugin: never formatted nor linted. */
const AGENT_IGNORES = [
	'.agent/**',
	'.agents/**',
	'.claude/**',
	'.codex/**',
	'.continue/**',
	'.cursor/**',
	'.gemini/**',
	'.grok/**',
	'.grepai/**',
	'.opencode/**',
	'.pi/**',
	'.roo/**',
	'.serena/**',
	'.windsurf/**',
	'tools/oxlint/anti-slop/**',
];

/** Generated output. */
const GENERATED_IGNORES = ['.output/**', '.tanstack/**', '.nitro/**', '.e2e/**', 'coverage/**', 'drizzle/**'];

const fmt: OxfmtConfig = {
	useTabs: true,
	tabWidth: 4,
	printWidth: 110,
	endOfLine: 'lf',
	singleQuote: true,
	jsxSingleQuote: true,
	vueIndentScriptAndStyle: true,
	arrowParens: 'always',
	bracketSpacing: true,
	bracketSameLine: true,
	semi: true,
	quoteProps: 'as-needed',
	trailingComma: 'all',
	embeddedLanguageFormatting: 'auto',
	htmlWhitespaceSensitivity: 'css',
	proseWrap: 'preserve',
	sortImports: {
		groups: [
			'builtin',
			'external',
			['internal', 'subpath'],
			['parent', 'sibling', 'index'],
			'style',
			'unknown',
		],
		internalPattern: ['~/', '@/', '#'],
		newlinesBetween: true,
		order: 'asc',
		ignoreCase: true,
		sortSideEffects: false,
	},
	sortTailwindcss: true,
	sortPackageJson: true,
	ignorePatterns: [
		'**/.git',
		'**/.cache',
		'**/*.md',
		'**/*.yml',
		'**/*.yaml',
		'**/node_modules',
		'**/public',
		'**/dist',
		'**/package.json',
		'**/*.min.css',
		'**/*.min.js',
		'routeTree.gen.ts',
		...GENERATED_IGNORES,
		...AGENT_IGNORES,
	],
};

const lint: OxlintConfig = {
	ignorePatterns: [
		'dist/**',
		'.cache/**',
		'public/**',
		'node_modules/**',
		'**/*.esm.js',
		'routeTree.gen.ts',
		...GENERATED_IGNORES,
		...AGENT_IGNORES,
	],
	// Vendored anti-slop (https://github.com/dmmulroy/anti-slop). @shadcn/lint loads only when installed.
	jsPlugins: [
		{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
		...(hasShadcnLint ? ['@shadcn/lint'] : []),
	],
	options: {
		typeAware: true,
		typeCheck: true,
	},
	rules: {
		'no-param-reassign': 'error',
		'prefer-as-const': 'error',
		'no-inferrable-types': 'error',
		'react/self-closing-comp': 'error',
		'prefer-number-properties': 'error',
		'no-else-return': 'error',
		'no-explicit-any': 'error',
		'anti-slop/no-chained-type-assertions': 'error',
		'anti-slop/no-conditional-empty-object-spread': 'error',
		'anti-slop/no-known-value-widening': 'error',
		'anti-slop/no-module-mocking': 'error',
		'anti-slop/no-object-parameters': 'error',
		'anti-slop/no-reflect-apply': 'error',
		'anti-slop/no-reflect-get': 'error',
		// `typeof` narrowing is allowed only inside named type guards / assertion functions.
		'anti-slop/no-runtime-typeof': ['error', { allowInTypeGuards: true }],
		'anti-slop/no-shape-in-symbol-names': 'error',
		'anti-slop/no-unknown-parameters': 'error',
		'anti-slop/no-unknown-returns': 'error',
		'anti-slop/no-unknown-type-aliases': 'error',
		'anti-slop/no-unsafe-dictionary-type': 'error',
		'anti-slop/no-widen-then-assert': 'error',
		'anti-slop/require-safety-comment-for-type-assertion': 'error',
		...shadcnLintRules(),
	},
	overrides: [
		...shadcnLintOverrides(),
		{
			files: ['**/tests/**', '**/*.test.ts', '**/*.test.tsx'],
			rules: {
				'anti-slop/no-module-mocking': 'off',
			},
		},
	],
};

/**
 * npm package of a resolved module id.
 * @param id - Resolved module id.
 * @returns `@scope/name` or `name`, or `undefined` for app code.
 */
function packageOf(id: string): string | undefined {
	const marker = 'node_modules/';
	const idx = id.lastIndexOf(marker);
	if (idx === -1) return undefined;
	const [scope, name] = id.slice(idx + marker.length).split('/');
	if (!scope) return undefined;
	return scope.startsWith('@') && name ? `${scope}/${name}` : scope;
}

/**
 * One browser chunk per npm package, so a dependency bump invalidates only its own cached file.
 * @param id - Resolved module id.
 * @returns The vendor chunk name, or `undefined` for app code.
 */
function vendorChunkName(id: string): string | undefined {
	const pkg = packageOf(id);
	if (pkg === undefined) return undefined;
	return `vendor-${pkg.replace('@', '').replaceAll('/', '-')}`;
}

/** Plugin order (nitro → tailwind → tanstackStart → react) builds cleanly under Rolldown with the bun preset. */
const plugins: PluginOption[] = isTest
	? [viteReact()]
	: [
			nitro({
				preset: process.env.NITRO_PRESET || 'bun',
				compressPublicAssets: { gzip: true, brotli: true },
				plugins: [fileURLToPath(new URL('src/server/plugins/purge-edge-cache.ts', import.meta.url))],
				// Daily jobs run in the server process, 02:30 UTC. Every instance runs them: the deletes are idempotent.
				experimental: { tasks: true },
				tasks: {
					'purge:retention': {
						handler: fileURLToPath(
							new URL('src/server/tasks/purge-retention.ts', import.meta.url),
						),
					},
				},
				scheduledTasks: { '30 2 * * *': ['purge:retention'] },
				routeRules: {
					'/**': { headers: { 'X-Content-Type-Options': 'nosniff' } },
				},
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
			// Kept without SENTRY_AUTH_TOKEN: the upload is skipped but no *.map ships in `.output`.
			sentryVitePlugin({
				org: sentryOrg,
				project: sentryProject || undefined,
				authToken: sentryAuthToken || undefined,
				release: {
					name: sentryRelease || undefined,
					deploy: sentryRelease ? { env: 'production' } : false,
				},
				errorHandler: (error) => console.warn(`[sentry] ${error.message}`),
				sourcemaps: { filesToDeleteAfterUpload: ['./**/*.map', './.output/**/*.map'] },
				silent: sentryAuthToken.length === 0,
				telemetry: false,
			}),
		];

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins,
	server: { host: '0.0.0.0', port: 3000 },
	preview: { host: '127.0.0.1' },

	fmt,

	lint,

	build: {
		target: 'esnext',
		// Maps exist for the Sentry upload only, never referenced from the bundles.
		sourcemap: 'hidden',
		modulePreload: { polyfill: false },
	},

	environments: {
		client: {
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: {
							includeDependenciesRecursively: false,
							groups: [{ name: vendorChunkName }],
						},
					},
				},
			},
		},
	},

	staged: {
		'*.{js,jsx,ts,tsx,json,css,html}': 'bun --bun vp check --fix',
	},

	test: {
		environment: 'node',
		globals: true,
		include: ['tests/**/*.test.{ts,tsx}'],
		clearMocks: true,
		restoreMocks: true,
	},
});
