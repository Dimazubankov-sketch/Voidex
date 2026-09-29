# VOIDEX — production deployment

Production: **https://voidex.su** on the DigitalOcean droplet **voidex-01**
(`161.35.135.122`, Ubuntu 24.04). Production branch: **`main`**.

```
https://voidex.su ─▶ Caddy (HTTPS, auto-renewing certificate, HTTP→HTTPS, www→apex)
                         │
                         ▼
                   app (Node: web client + /api on one origin)
                         │  internal Docker network, no published port
                         ▼
                   PostgreSQL 16 (volume voidex_pgdata)
```

```
git push main ─▶ GitHub Actions "Deploy"
                   1. Tests (unit, API integration, e2e)          ─ fail → nothing deployed
                   2. Build image → ghcr.io/dimazubankov-sketch/voidex:<commit>
                   3. SSH (deploy key, restricted) → voidex-deploy deploy <commit>
                        pull image · DB backup · migrations · switch · health checks
                        health checks fail → previous version restored automatically
                   4. Verify https://voidex.su (health, frontend, redirects)
```

The image is built on GitHub, not on the 2 GB server. A failed build or failed
tests never touch the running version.

## Server layout

| Path | What |
|---|---|
| `/opt/voidex/.env` | Production secrets (root:deploy, 640). Never in git or images. |
| `/opt/voidex/repo` | Checkout of `main` at the deployed commit (compose file, Caddyfile, scripts). |
| `/opt/voidex/bin/voidex-deploy` | The only command the GitHub deploy key may run (root-owned). |
| `/opt/voidex/state/current`, `history` | Deployed version and release history. |
| `/opt/voidex/backups` | `pg_dump` taken before every migration (last 10 kept). |
| Docker volume `voidex_pgdata` | Database files. Never removed by any script. |
| Docker volume `voidex_caddy_data` | TLS certificates. |

Containers (compose project `voidex`): `voidex-db-1`, `voidex-app-1`, `voidex-caddy-1`,
all `restart: unless-stopped`. Firewall (ufw): only 22, 80, 443 are open.

## Environment variables

All are read in `apps/server/src/config.ts`. Production values live in `/opt/voidex/.env`.

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | `postgres://voidex:…@db:5432/voidex` | generated |
| `POSTGRES_PASSWORD` | random hex | used by the `db` container on first start |
| `AUTH_ACCESS_SECRET` | random hex (96) | signs access tokens (JWT HS256) |
| `AUTH_TOKEN_PEPPER` | random hex (96) | HMAC for one-time codes, challenge & recovery secrets |
| `MAIL_DOMAIN` | `voidops.ru` | addresses `name@voidops.ru` |
| `SMS_PROVIDER` | `disabled` | see "SMS" below |
| `TRUST_PROXY` | `true` (set in compose) | only Caddy can reach the app |
| `LOG_LEVEL` | `info` | |
| `VOIDEX_VERSION` | commit (set in image) | shown by `/api/health` |

Refresh tokens and sessions need no secret: refresh tokens are random 256-bit
values stored only as SHA-256 hashes. There is no OAuth. Defaults are used for
`ACCESS_TOKEN_TTL_SECONDS` (900), `SESSION_IDLE_DAYS` (30),
`SESSION_ABSOLUTE_DAYS` (180), `COOKIE_SECURE` (on in production),
`RATE_LIMIT_SCALE` (1; the server refuses anything else in production).

## GitHub Secrets

Repository → Settings → Secrets and variables → Actions:

| Name | Value |
|---|---|
| `DEPLOY_SSH_KEY` | private deploy key (printed once by `bootstrap.sh`, base64 line) |
| `DEPLOY_KNOWN_HOSTS` | `161.35.135.122 ssh-ed25519 …` (printed by `bootstrap.sh`) |

The registry token is the workflow's own short-lived `GITHUB_TOKEN`.

## DNS (Рег.ру)

| Type | Name | Value |
|---|---|---|
| A | `@` | `161.35.135.122` |
| A | `www` | `161.35.135.122` |

No `api` record: the API is served from `https://voidex.su/api`.

## Everyday operations

All from the GitHub website — no server login needed:
**Actions → "Production (rollback · status · logs)" → Run workflow**, then choose:

* **status** — deployed version, release history, containers, health checks, RAM/disk.
* **logs** — last 150 lines of app, Caddy and PostgreSQL logs.
* **rollback** — back to the previous working version; or put a full commit id
  in *version* to return to that release.

Deploying = pushing to `main` (or Actions → Deploy → Run workflow to redeploy).

Health: `https://voidex.su/api/health` → `{"ok":true,"revision":"<commit>"}`
(200 only when the API and PostgreSQL both work).

### On the server (DigitalOcean console, as root) — only if ever needed

```bash
cd /opt/voidex && sudo -u deploy SSH_ORIGINAL_COMMAND=status bin/voidex-deploy
docker compose -p voidex --env-file .env -f repo/deploy/docker-compose.prod.yml logs -f app
```

Restore a backup (asks nothing, overwrites current data — only on purpose):

```bash
docker compose -p voidex --env-file /opt/voidex/.env -f /opt/voidex/repo/deploy/docker-compose.prod.yml \
  exec -T db pg_restore -U voidex -d voidex --clean --if-exists < /opt/voidex/backups/<file>.dump
```

## Rollback and the database

Migrations are forward-only SQL (Drizzle), applied in a transaction before the
new version starts; a failed migration stops the release with the old version
still running. Rolling back switches the app image only — schema changes are
kept additive so older versions keep working. A `pg_dump` is taken before every
migration.

## SMS (deferred)

`SMS_PROVIDER=disabled`: phone verification answers `503 sms_not_configured`,
no code is created, sent or shown. Consequences until SMS is connected:
registration is closed (the welcome screen says so), sign-in from a new device
and password recovery work only by approval from an already signed-in device.

To connect SMS later: put `SMS_PROVIDER=smsru` + `SMSRU_API_ID=…` (or
`twilio` + `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) into
`/opt/voidex/.env`, then redeploy (Actions → Deploy → Run workflow).

## First-time setup (done once)

1. DNS records above in Рег.ру.
2. DigitalOcean → voidex-01 → Console, as root:
   `curl -fsSL https://raw.githubusercontent.com/Dimazubankov-sketch/Voidex/main/deploy/bootstrap.sh -o /root/voidex-bootstrap.sh && bash /root/voidex-bootstrap.sh`
3. The two printed values → GitHub Secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.
4. Actions → Deploy → Run workflow.

`bootstrap.sh` is safe to re-run; `ROTATE_KEY=1 bash /root/voidex-bootstrap.sh`
replaces the deploy key (then update `DEPLOY_SSH_KEY`).
