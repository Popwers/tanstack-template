# backup

Second Coolify app (same repo, base directory `backup/`). Runs `backup.sh` on `BACKUP_CRON`
(default every 6 h) with supercronic:

1. `pg_dump --format=custom` of the app database → `<prefix>db-<ts>.dump`
2. the uploads (R2 bucket `UPLOADS_BUCKET`, or the disk volume `UPLOADS_DIR`) → `<prefix>uploads-<ts>.tar.gz`

Both go to the **backups** bucket `CF_BUCKET` (`<name>-backups`, EU jurisdiction), never to the files
bucket. An R2 lifecycle rule on the prefix expires them after 3 days (DEPLOY.md §4).

A failed files archive fails the run too (the database dump is uploaded first and stays). The first
failed step of a run (configuration, database dump, database upload, uploads archive) sends **one** email
to `BACKUP_ALERT_EMAIL_TO` through Resend: subject `[<project>] Backup failed: <step>` (the project is the
sender's display name), body with the step, the UTC date and the exit code, no secret. Without these
variables the run logs `alert email skipped`; a Resend outage only logs a `WARNING` and never changes the
backup. No Sentry cron monitor: a backup that stops running sends nothing, so watch the container and the
bucket.

| Variable | Value |
| --- | --- |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | the app's role and database (discrete vars: pg_dump does not take `DATABASE_URL`) |
| `CF_ENDPOINT`, `CF_ACCESS_KEY_ID`, `CF_ACCESS_SECRET` | R2 token with read on `<name>-files` and write on `<name>-backups` |
| `CF_BUCKET` | `<name>-backups` |
| `UPLOADS_BUCKET` | `<name>-files` (unset → archive `UPLOADS_DIR`, default `/data/uploads`) |
| `BACKUP_KEY_PREFIX` | default `backup-` |
| `BACKUP_CRON` | default `0 */6 * * *` |
| `RESEND_API_KEY` | the app's Resend key: sends the failure alert email |
| `BACKUP_ALERT_EMAIL_TO` | recipient(s) of the alert, comma-separated |
| `BACKUP_ALERT_EMAIL_FROM` | `<Name> <no-reply@<domain>>`, default `EMAIL_FROM`; on the key's domain |

Run once by hand: `docker compose run --rm backup --once`, or in Coolify: Execute command
`/opt/backup/backup.sh`. Restore: `restore.sh <db-dump-key> [uploads-key]` (read it first: it
overwrites the target database).
