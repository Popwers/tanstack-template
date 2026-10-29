import * as Sentry from '@sentry/tanstackstart-react';

import { parseTracesSampleRate, sentryOptions, shouldInitSentry } from '#/lib/sentry';

// Loaded before the server validates its env (`src/lib/server/env.ts`), hence the direct reads.
const dsn = process.env.SENTRY_DSN || import.meta.env.VITE_SENTRY_DSN;

if (shouldInitSentry(process.env.NODE_ENV === 'production', dsn)) {
	Sentry.init({ dsn, ...sentryOptions(parseTracesSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE)) });
}
