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
| `/opt/voidex/state/secrets.env` | `OTP_API_KEY`, `SMS_AERO_*`, written by each deploy from GitHub Secrets (deploy, 600). |
| `/opt/voidex/state/sms-provider` | Requested SMS provider of the last deploy: `auto`, `otpcom` or `smsaero`. |
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
| `SMS_PROVIDER` | `otpcom` | chosen per release by the deploy script, see "SMS" below |
| `OTP_API_KEY` | `otp_live_…` | from GitHub Secret `OTP_API_KEY` → `state/secrets.env` |
| `SMS_AERO_API_KEY` | SMS Aero API key | from GitHub Secret `SMS_AERO_API_KEY` → `state/secrets.env` |
| `SMS_AERO_EMAIL` | SMS Aero account email | from GitHub Secret `SMS_AERO_EMAIL` (Basic-auth login) |
| `SMS_AERO_SIGN` | sender name | GitHub **variable** `SMS_AERO_SIGN`; default `SMS Aero` |
| `SMS_AERO_API_BASE` | not set → `https://gate.smsaero.org/v2` | optional; `https://gate.smsaero.net/v2` as the alternative |
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
| `OTP_API_KEY` | otp.com **live server** key (`otp_live_…`) |
| `SMS_AERO_API_KEY` | SMS Aero API key |
| `SMS_AERO_EMAIL` | SMS Aero account email (login for the API's Basic auth) |

Repository **variables** (Settings → Secrets and variables → Actions → Variables):
`SMS_PROVIDER` (optional override: `otpcom` or `smsaero`; unset = `smsaero`, the production default)
and `SMS_AERO_SIGN` (approved sender name).

The registry token is the workflow's own short-lived `GITHUB_TOKEN`. Secrets go
to the server on the SSH connection's stdin (never on a command line, never
printed): `OTP_API_KEY` is saved to `/opt/voidex/state/secrets.env` (mode 600).
If the secret is empty, the key already on the server is kept.

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
docker logs -f --tail 100 voidex-app-1
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

## SMS — otp.com

Phone codes (sign-up, sign-in from a new device, password recovery, phone
change) go through **otp.com** (`SMS_PROVIDER=otpcom`). otp.com generates,
delivers and checks the code; VOIDEX stores only its `otp_id`
(`phone_verifications.provider_ref`), never the code. The channel comes from the
app routing in the otp.com dashboard (SMS first); the API takes no channel.

* **Send** `POST /otp/send` — E.164 number, the end user's IP as `client_ip`
  (from `X-Forwarded-For` set by Caddy), `locale`, and an `idempotency-key`
  `voidex:<purpose>:<verification id>`: a timeout / 5xx is retried once with the
  same key, so the user never gets two codes for one request.
* **Verify** `POST /otp/verify` — the phone is verified only on
  `matched: true` + `status: approved`. `pending` = wrong code, `failed` = too
  many attempts, `expired` = new code needed. Never retried.
* **Resend** in VOIDEX = a new send with a new key after the 60 s cooldown
  (`/otp/resend` would move the code to another channel).
* VOIDEX's own limits stay on top: 60 s between codes, 8 per number per hour,
  5 attempts, 10 minutes.
* Errors: 401 key rejected / 402 no balance / 5xx / timeout → "couldn't send SMS"
  (details in the server log); 429 → "too many attempts"; VPN/proxy IP → "turn off
  VPN"; blocked country → "not available in this country". There is **no
  fallback** to another SMS provider.
* Logs carry the masked number, `otp_id`, channel and otp.com's error type /
  message — never the key, a code or a full number. At startup the app checks
  the key for free (`GET /otp/<nonexistent id>`: 404 = accepted, 401 = rejected)
  and logs `SMS provider: otp.com — API key accepted`.

Production accepts only `otp_live_…` keys: sandbox keys accept a fixed code.

Which provider a release runs with is decided by the deploy script: `otpcom`
when `state/secrets.env` holds the key and the image supports it (label
`su.voidex.otpcom`), otherwise `SMS_PROVIDER` from `/opt/voidex/.env`
(`disabled`). So a rollback to a build from before otp.com starts with SMS off
instead of failing.

Change the key: update the GitHub Secret, then Actions → Deploy → Run workflow.
Turn otp.com off: on the server `rm /opt/voidex/state/secrets.env`, delete the
GitHub Secret, redeploy — phone verification is then refused (503), never faked.

## SMS — SMS Aero

`SMS_PROVIDER=smsaero` sends codes through SMS Aero (API v2,
`POST <SMS_AERO_API_BASE>/sms/send`, JSON `number`/`sign`/`text`, HTTP
Basic auth with the account email and API key). Unlike otp.com, SMS Aero only
**delivers**: VOIDEX makes the code, stores its HMAC and checks it, with all
VerificationService limits. One attempt per code (the API has no idempotency
key, a retry could send a second code). Errors: 401 → wrong email/key,
402 → no money, 404 "Invalid ip-address" → IP allow-list in the cabinet,
400 → validation (number / sign / text), 429, 5xx, timeout — all shown to the
user as "couldn't send SMS" (429 as "too many attempts", a bad number as
"invalid number"); details are in the server log, never the key, the text
(it holds the code) or the full number.

**Gateway.** `SMS_AERO_API_BASE` defaults to `https://gate.smsaero.org/v2`
(alternative: `https://gate.smsaero.net/v2`). Both are official API v2
gateways (the official SMS Aero clients list `gate.smsaero.ru`, `.org` and
`.net`). `gate.smsaero.ru` is not used: from voidex-01 (`161.35.135.122`) its
TCP connects but the TLS handshake never completes, while `.org`/`.net`
answer `/v2/auth` normally. There is no automatic failover between gateways —
a hidden retry could send the same SMS twice. To switch, set
`SMS_AERO_API_BASE` in the app environment and redeploy. `Production → status`
checks DNS/TCP/TLS and `/v2/auth` on all three gateways (no SMS is sent).

SMS Aero moderates messages manually (up to 5–10 minutes) until a contract is
signed; with the shared `SMS Aero` sender name the text must name the service
(ours says "VOIDEX").

**Which provider runs.** SMS Aero is the production provider. Each deploy
requests one: the Deploy run input *sms_provider*, else the repository
variable `SMS_PROVIDER`, else `smsaero`. The deploy script then uses
`smsaero` when requested and its key + email are on the server and the build
supports it; otherwise otp.com (when its key is on the server); otherwise
`/opt/voidex/.env`. To go back to otp.com: set the variable
`SMS_PROVIDER=otpcom` (every release) or run Deploy with *sms_provider* =
`otpcom` (that release only). Rollbacks keep the last request; a build without
SMS Aero support falls back to otp.com. The Deploy run fails (server
untouched) if `smsaero` is requested without both secrets.

## First-time setup (done once)

1. DNS records above in Рег.ру.
2. DigitalOcean → voidex-01 → Console, as root:
   `curl -fsSL https://raw.githubusercontent.com/Dimazubankov-sketch/Voidex/main/deploy/bootstrap.sh -o /root/voidex-bootstrap.sh && bash /root/voidex-bootstrap.sh`
3. The two printed values → GitHub Secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`;
   the otp.com live server key → GitHub Secret `OTP_API_KEY`.
4. Actions → Deploy → Run workflow.

`bootstrap.sh` is safe to re-run; `ROTATE_KEY=1 bash /root/voidex-bootstrap.sh`
replaces the deploy key (then update `DEPLOY_SSH_KEY`).
