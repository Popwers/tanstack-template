# Déploiement (Coolify, Hetzner)

Deux applications Coolify sur le serveur principal (`worker-server-2`, `49.13.58.160`) : l'app et son
service de backup. Base sur le Postgres partagé de Le Niid (`10.0.0.3:5432`, réseau privé). Fichiers et
backups sur R2 (juridiction UE). Domaine sur Cloudflare. `/provision-project <name>` crée tout ça ;
ce document décrit le résultat attendu.

## 1. Variables d'environnement

Secrets en **runtime** seulement. Les variables marquées *build* sont aussi des build args (Coolify
injecte chaque variable *Buildtime* en `ARG`) : en changer une demande un nouveau build.

| Variable | Requis | Exemple / défaut | Rôle |
| --- | --- | --- | --- |
| `DATABASE_URL` | oui | `postgres://<name>:••••@10.0.0.3:5432/<name>` | Base applicative |
| `DATABASE_POOL_MAX` | non | `10` | Connexions max |
| `BETTER_AUTH_SECRET` | oui | `openssl rand -base64 32` | Signe la session. Le serveur refuse de démarrer sans |
| `APP_URL` | oui | `https://<domaine>` | Origine publique, liens des e-mails |
| `TRUSTED_ORIGINS` | non | | Origines supplémentaires, séparées par des virgules |
| `CF_ENDPOINT` | prod | `https://<account>.eu.r2.cloudflarestorage.com` | R2 (juridiction UE) |
| `CF_ACCESS_KEY_ID`, `CF_ACCESS_SECRET` | prod | | Token R2 *Object Read & Write* limité à `<name>-files` |
| `CF_BUCKET` | prod | `<name>-files` | Bucket privé des fichiers |
| `STORAGE_DIR` | non | `/home/bun/app/storage` | Repli disque si un `CF_*` manque (monter un volume) |
| `RESEND_API_KEY` | prod | | Clé *sending_access* limitée au domaine |
| `EMAIL_FROM` | prod | `<Nom> <no-reply@<domaine>>` | Expéditeur vérifié dans Resend (région `eu-west-1`) |
| `EMAIL_REPLY_TO` | non | `bonjour@<domaine>` | |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | prod | | Widget *Managed* sur le domaine. Le serveur refuse de démarrer en prod sans |
| `SENTRY_DSN` | non | | Erreurs serveur |
| `VITE_SENTRY_DSN` | non, *build* | | Erreurs navigateur (inliné au build) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_PROJECT` | non, *build seulement* | | Upload des source maps (org `mystudiodigital`) |
| `OPENPANEL_API_URL` | non | `https://o.mystudio.digital/api` | OpenPanel self-hosted |
| `OPENPANEL_CLIENT_ID` | non | | Id client public du projet. Absent : pas d'analytics |

Activez **Include Source Commit in Build** : `SOURCE_COMMIT` devient la release Sentry.

## 2. Base de données

Rôle et base `<name>` sur le Postgres partagé, propriétaire seul (`REVOKE ALL … FROM PUBLIC`) : voir
`/provision-project`. Les migrations (`./drizzle`) s'appliquent **à chaque démarrage** par
`docker-entrypoint.sh` (idempotent). Une migration en échec arrête le conteneur (`set -e`) : il ne sert
jamais une base non migrée, et Coolify garde l'ancienne version en ligne.

## 3. Application

1. **New Resource → Application → Public/Private Git → Dockerfile**, branche `main`, Auto Deploy.
2. **Port** `3000`. **Health check** `GET /api/health` (200 ok, 503 base injoignable). L'image a aussi
   son `HEALTHCHECK`.
3. **Domaine** `https://<domaine>` (apex). Redirection `www` → apex côté Cloudflare.
4. Variables du §1, puis **Deploy**. Logs attendus :
   `→ Applying database migrations… ✓ Migrations applied. → Starting server…`.
5. **Watch paths** : tout sauf `backup/**` et `*.md`.

## 4. Backup

Deuxième app Coolify, même dépôt, **Base Directory** `backup`, sans port ni domaine, watch path
`backup/**`. Variables : voir [`backup/README.md`](backup/README.md) (`POSTGRES_*` discrets,
`CF_BUCKET=<name>-backups`, `UPLOADS_BUCKET=<name>-files`). Lifecycle rule R2 sur le préfixe
`backup-` (30 jours). Premier test : Execute command `/opt/backup/backup.sh`, puis vérifier l'objet
dans le bucket.

## 5. Vérifier en production

```bash
curl -fsS https://<domaine>/api/health
curl -sI https://<domaine>/ | grep -i -E 'cf-cache-status|strict-transport|x-content-type'
```

Puis inscription → e-mail reçu → lien → `/dashboard`, et `make conformity` vert sur `main`.

## 6. Tester l'image en local

```bash
make image-run   # build + run sur :3002 contre la base de dev
```
