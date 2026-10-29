# Backup service: PostgreSQL + uploads volume -> Cloudflare R2.
# Runs continuously next to the app and fires backup.sh on the BACKUP_CRON schedule.
# The base image matches the targeted server major version (PG 18): pg_dump refuses
# to dump a server newer than itself.
FROM postgres:18-alpine

# Tooling:
# - aws-cli (S3-compatible, talks to R2 through --endpoint-url)
# - supercronic: cron runner that logs to stdout (Docker friendly)
# - bash, tar, gzip (tar and gzip come with busybox)
# - curl + jq: the failure alert email (Resend API)
# supercronic binaries are pinned by SHA256 (checked against the official SHA1 of the
# v0.2.33 release): a tampered asset fails the build.
ENV SUPERCRONIC_ARM64_SHA256=f1f8585c66de020fef494dd636058f99949d108f569fef00016a1c8b9eb145b3
ENV SUPERCRONIC_AMD64_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
RUN apk add --no-cache aws-cli bash curl ca-certificates jq tzdata \
 && curl -fsSL -o /usr/local/bin/supercronic \
      https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-arm64 \
 && echo "${SUPERCRONIC_ARM64_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod +x /usr/local/bin/supercronic \
 && curl -fsSL -o /usr/local/bin/supercronic-amd64 \
      https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
 && echo "${SUPERCRONIC_AMD64_SHA256}  /usr/local/bin/supercronic-amd64" | sha256sum -c - \
 && chmod +x /usr/local/bin/supercronic-amd64

WORKDIR /opt/backup
COPY backup.sh restore.sh entrypoint.sh ./
RUN chmod +x backup.sh restore.sh entrypoint.sh

# Every 6 hours by default; override with BACKUP_CRON.
ENV BACKUP_CRON="0 */6 * * *"
ENV UPLOADS_DIR="/data/uploads"

# Verifies the supercronic cron runner is alive; on crash Docker restarts the
# container via `restart: unless-stopped`.
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD pgrep -f supercronic > /dev/null || exit 1

ENTRYPOINT ["/opt/backup/entrypoint.sh"]
