/**
 * Retention periods. The privacy policy, the docs and the code read them from here, so a period never
 * differs between what the legal text promises and what the app deletes. Each one has a purge:
 * `src/server/tasks/purge-retention.ts` (daily) for the database, the R2 lifecycle rule for backups
 * (DEPLOY.md §4), Sentry and OpenPanel settings for their own data.
 */

/** A session (with its IP address and browser) lives this long without use, then the daily purge deletes it. */
export const SESSION_RETENTION_DAYS = 7;

/** Abuse counters (client IP + auth route) are deleted this long after their last request. */
export const RATE_LIMIT_RETENTION_HOURS = 24;

/** Backups expire after this many days (R2 lifecycle rule on `<name>-backups`). */
export const BACKUP_RETENTION_DAYS = 3;

/** Error events kept by Sentry (organization data retention setting). */
export const ERROR_EVENT_RETENTION_DAYS = 90;

/** Audience measurement kept by OpenPanel (project setting), the standard's upper bound. */
export const ANALYTICS_RETENTION_MONTHS = 25;

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;
