import * as Sentry from '@sentry/tanstackstart-react';

import { SENTRY_OPTIONS, shouldInitSentry } from '#/lib/sentry';

const dsn = process.env.SENTRY_DSN || import.meta.env.VITE_SENTRY_DSN;

if (shouldInitSentry(process.env.NODE_ENV === 'production', dsn)) {
	Sentry.init({ dsn, ...SENTRY_OPTIONS });
}
