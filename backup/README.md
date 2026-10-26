# backup

Second Coolify app (same repo, base directory `backup/`). Runs `backup.sh` on `BACKUP_CRON`
(default every 6 h) with supercronic:

1. `pg_dump --format=custom` of the app database → `<prefix>db-<ts>.dump`
2. the uploads (R2 bucket `UPLOADS_BUCKET`, or the disk volume `UPLOADS_DIR`) → `<prefix>uploads-<ts>.tar.gz`

Both go to the **backups** bucket `CF_BUCKET` (`<name>-backups`, EU jurisdiction), never to the files
bucket. Expire them with an R2 lifecycle rule on the prefix.

| Variable | Value |
| --- | --- |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | the app's role and database (discrete vars: pg_dump does not take `DATABASE_URL`) |
| `CF_ENDPOINT`, `CF_ACCESS_KEY_ID`, `CF_ACCESS_SECRET` | R2 token with read on `<name>-files` and write on `<name>-backups` |
| `CF_BUCKET` | `<name>-backups` |
| `UPLOADS_BUCKET` | `<name>-files` (unset → archive `UPLOADS_DIR`, default `/data/uploads`) |
| `BACKUP_KEY_PREFIX` | default `backup-` |
| `BACKUP_CRON` | default `0 */6 * * *` |

Run once by hand: `docker compose run --rm backup --once`, or in Coolify: Execute command
`/opt/backup/backup.sh`. Restore: `restore.sh <db-dump-key> [uploads-key]` (read it first: it
overwrites the target database).
