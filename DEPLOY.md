# Déploiement (Coolify, Hetzner)

Deux applications Coolify sur le serveur choisi pour le projet : l'app et son service de backup. Base
sur le Postgres partagé, joint par le réseau privé uniquement. Fichiers et backups sur R2 (juridiction
UE), dans deux buckets séparés. Domaine sur Cloudflare. `/provision-project <name>` crée tout ça ; ce
document décrit le résultat attendu.

Les hôtes ne sont jamais écrits ici : lisez-les en direct (`coolify server list`, `coolify database list`,
`hcloud server list -o columns=name,ipv4,ipv6,private_net` pour l'adresse privée du Postgres).

## 1. Variables d'environnement

Secrets en **runtime** seulement. Les variables marquées *build* sont aussi des build args (Coolify
injecte chaque variable *Buildtime* en `ARG`) : en changer une demande un nouveau build.

| Variable | Requis | Exemple / défaut | Rôle |
| --- | --- | --- | --- |
| `DATABASE_URL` | oui | `postgres://<name>:••••@<ip-privée-postgres>:5432/<name>` | Base applicative |
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
| `TURNSTILE_SITEVERIFY_URL` | **jamais en prod** | | Doublure de siteverify pour l'e2e (`tests/e2e/siteverify.ts`). Le serveur refuse de démarrer en prod avec |
| `SENTRY_DSN` | non | | Erreurs serveur |
| `SENTRY_TRACES_SAMPLE_RATE` | non, *runtime + build* | `0.1` | Part des traces gardées (≤ `0.1` : le quota Sentry est partagé par toute l'organisation). Au build, il fixe aussi le taux du navigateur |
| `VITE_SENTRY_DSN` | non, *build* | | Erreurs navigateur (inliné au build) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_PROJECT` | non, *build seulement* | | Upload des source maps (org `mystudiodigital`) |
| `OPENPANEL_API_URL` | non | `https://o.mystudio.digital/api` | OpenPanel self-hosted |
| `OPENPANEL_CLIENT_ID` | non | | Id client public du projet. Absent : pas d'analytics |
| `CLOUDFLARE_ZONE_ID` | non | | Zone Cloudflare d'`APP_URL` |
| `CLOUDFLARE_API_TOKEN` | non | | Token limité à *Zone › Cache Purge* sur cette zone. Avec la zone : chaque démarrage en prod purge les pages publiques, robots.txt et sitemap.xml une fois le nouveau conteneur en service. Absent : pas de purge |

Cache Cloudflare : l'app envoie `CDN-Cache-Control` sur les pages publiques (`PUBLIC_PAGES` dans
`src/lib/http-headers.ts`) pour un visiteur anonyme, et `private, no-store` partout ailleurs. La règle de
cache de la zone liste ces mêmes chemins et exclut le cookie `better-auth.session_token`.

Activez **Include Source Commit in Build** : `SOURCE_COMMIT` devient la release Sentry.

## 2. Base de données

Rôle et base `<name>` sur le Postgres partagé, propriétaire seul (`REVOKE ALL … FROM PUBLIC`) : voir
`/provision-project`. Les migrations (`./drizzle`) s'appliquent **à chaque démarrage** par
`docker-entrypoint.sh` (idempotent). Une migration en échec arrête le conteneur (`set -e`) : il ne sert
jamais une base non migrée, et Coolify garde l'ancienne version en ligne.

## 3. Application

1. **New Resource → Application → Public/Private Git → Dockerfile**, branche `main`, Auto Deploy.
2. **Port** `3000`. **Health check** `GET /api/health` (200 ok, 503 base injoignable). L'image a aussi
   son `HEALTHCHECK`. Mémoire `512m`. Image poussée dans le registre privé.
3. **Domaine** `https://<domaine>` (apex). Redirection `www` → apex côté Cloudflare.
4. Variables du §1, puis **Deploy**. Logs attendus :
   `→ Applying database migrations… ✓ Migrations applied. → Starting server…`.
5. **Watch paths** : tout sauf `backup/**` et `*.md`.

## 4. Backup

Deuxième app Coolify, même dépôt, **Base Directory** `/backup`, sans port ni domaine, watch path
`backup/**`, health check de l'image (`pgrep -f supercronic`), mémoire `256m`. Variables : voir
[`backup/README.md`](backup/README.md) (`POSTGRES_*` discrets, `CF_BUCKET=<name>-backups`,
`UPLOADS_BUCKET=<name>-files`).

Bucket `<name>-backups` : expiration **3 jours** sur le préfixe `backup-` seulement, abandon des
uploads multipart après 7 jours, object lock de 2 jours. Rien n'expire sur `<name>-files`. La politique
de confidentialité annonce ces 3 jours (`BACKUP_RETENTION_DAYS` dans `src/lib/retention.ts`) : gardez
les deux alignés. Premier test : Execute command `/opt/backup/backup.sh`, puis vérifier l'objet dans le
bucket.

Alerte et heartbeat : avec `SENTRY_DSN`, chaque exécution s'enregistre auprès du moniteur cron Sentry
`backup` (créé au premier passage avec le planning `BACKUP_CRON`). Une exécution en échec (base **ou**
fichiers) ouvre une issue, une exécution qui ne démarre pas est signalée manquée après 30 minutes. Une
panne de Sentry ne fait jamais échouer le backup. Vérifiez le moniteur dans Sentry → Crons après le
premier passage.

## 4 bis. Purges planifiées

Chaque nuit à 02:30 UTC, la tâche Nitro `purge:retention` (dans le processus de l'app) efface les
sessions expirées avec leur IP, les liens de confirmation expirés et les compteurs de rate limit inactifs
depuis 24 h. Les durées viennent de `src/lib/retention.ts`, que la politique de confidentialité lit
aussi. Log attendu : `[purge:retention] deleted …`.

## 5. Vérifier en production

```bash
curl -fsS https://<domaine>/api/health
curl -sI https://<domaine>/ | grep -i -E 'cf-cache-status|strict-transport|x-content-type|content-security'
```

Puis inscription → e-mail reçu → lien → `/dashboard`, et `stack-conformity .` vert sur `main`.

## 6. Tester l'image en local

```bash
make image-run   # build + run sur :3002 contre la base de dev
```
