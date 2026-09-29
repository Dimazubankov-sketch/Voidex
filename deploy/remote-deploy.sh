#!/usr/bin/env bash
# VOIDEX production deployment on voidex-01.
#
# Called by /opt/voidex/bin/voidex-deploy (the only command the GitHub Actions
# deploy key may run). Never destroys data: the database volume is never
# removed, a backup is taken before every migration, and a failed release is
# replaced by the previous working one automatically.
#
#   remote-deploy.sh deploy   <commit>   pull image, migrate, switch, verify
#   remote-deploy.sh rollback <commit|previous>
#   remote-deploy.sh status
#   remote-deploy.sh logs
#
# Secrets arrive on stdin from GitHub Actions, one per line, and are never
# printed:
#   line 1  registry token (short-lived GITHUB_TOKEN) — used once to pull images
#           with a throwaway Docker config;
#   line 2  OTP_API_KEY (otp.com live server key), optional — saved to
#           $STATE/secrets.env (mode 600, owner deploy) for the app container.
#           When the line is empty, the key already on the server is kept.
set -Eeuo pipefail

BASE=/opt/voidex
ENV_FILE="$BASE/.env"
STATE="$BASE/state"
BACKUPS="$BASE/backups"
IMAGE_REPO=ghcr.io/dimazubankov-sketch/voidex
KEEP_IMAGES=5
KEEP_BACKUPS=10
COMPOSE_FILE="$BASE/repo/deploy/docker-compose.prod.yml"
SECRETS_FILE="$STATE/secrets.env"

export VOIDEX_ENV_FILE="$ENV_FILE" VOIDEX_SECRETS_FILE="$SECRETS_FILE"

REGISTRY_TOKEN=""
OTP_API_KEY_IN=""
# Read all piped secrets up front, before any docker command can consume stdin.
read_secrets() {
  [[ -t 0 ]] && return 0
  IFS= read -r REGISTRY_TOKEN || true
  IFS= read -r OTP_API_KEY_IN || true
  OTP_API_KEY_IN="${OTP_API_KEY_IN//[[:space:]]/}"
}

# SMS provider for a given app image: otp.com when its key is on the server
# and the build supports it (image label); otherwise what /opt/voidex/.env says.
sms_provider_for() {
  local image=$1 fallback
  fallback=$(sed -n 's/^[[:space:]]*SMS_PROVIDER[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" 2>/dev/null | tail -1 | tr -d "\"' \r")
  if [[ -s "$SECRETS_FILE" ]] &&
    [[ "$(docker image inspect -f '{{index .Config.Labels "su.voidex.otpcom"}}' "$image" 2>/dev/null)" == 1 ]]; then
    echo otpcom
  else
    echo "${fallback:-disabled}"
  fi
}

# Compose interpolates the whole file on every call, so the app image must
# always be known: callers that switch versions pass VOIDEX_IMAGE, every other
# call (db, caddy, exec, logs) keeps whatever version is currently deployed.
compose() {
  local image="${VOIDEX_IMAGE:-$IMAGE_REPO:$(cat "$STATE/current" 2>/dev/null || echo none)}"
  VOIDEX_IMAGE="$image" VOIDEX_SMS_PROVIDER="$(sms_provider_for "$image")" \
    docker compose -p voidex --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

log() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
ok() { printf '  ✔ %s\n' "$*"; }
bad() { printf '  ✘ %s\n' "$*" >&2; }
die() { bad "$*"; exit 1; }

short() { if [[ -n "${1:-}" ]]; then echo "${1:0:7}"; else echo none; fi; }

current_version() { cat "$STATE/current" 2>/dev/null || true; }

# ---------------------------------------------------------------- checks

preflight() {
  log "Preflight"
  docker info >/dev/null 2>&1 || die "Docker is not running on the server."
  ok "Docker $(docker version --format '{{.Server.Version}}')"
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing."
  [[ -r "$ENV_FILE" ]] || die "$ENV_FILE is missing — run deploy/bootstrap.sh on the server first."
  [[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE is missing."
  local free_kb
  free_kb=$(df --output=avail / | tail -1)
  ((free_kb > 1500000)) || die "Less than 1.5 GB free disk space ($((free_kb / 1024)) MB). Free space before deploying."
  ok "Free disk space: $((free_kb / 1024 / 1024)) GB"
  mkdir -p "$STATE" "$BACKUPS"
}

# Saves OTP_API_KEY for the app (never printed). Empty input keeps the saved key.
store_secrets() {
  log "Secrets"
  if [[ -z "$OTP_API_KEY_IN" ]]; then
    if [[ -s "$SECRETS_FILE" ]]; then
      ok "OTP_API_KEY: kept the key already saved on the server"
    else
      printf '  • OTP_API_KEY not provided — SMS stays as set in %s\n' "$ENV_FILE"
    fi
    return 0
  fi
  [[ "$OTP_API_KEY_IN" =~ ^otp_live_[A-Za-z0-9._~+/=-]+$ ]] ||
    die "OTP_API_KEY is not an otp.com live server key (must start with otp_live_). Nothing was changed."
  local tmp
  tmp=$(umask 077 && mktemp "$STATE/.secrets.XXXXXX")
  {
    echo "# Managed by the deploy pipeline from GitHub Secrets — do not edit by hand."
    echo "OTP_API_KEY=$OTP_API_KEY_IN"
  } >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$SECRETS_FILE"
  OTP_API_KEY_IN=""
  ok "OTP_API_KEY saved to $SECRETS_FILE (mode 600, value not shown)"
}

pull_image() {
  local tag=$1 image="$IMAGE_REPO:$1" token="$REGISTRY_TOKEN"
  if docker image inspect "$image" >/dev/null 2>&1; then
    ok "Image $(short "$tag") already on server"
    return
  fi
  log "Pulling $IMAGE_REPO:$(short "$tag")"
  local cfg
  cfg=$(mktemp -d)
  if [[ -n "$token" ]]; then
    printf '%s' "$token" | DOCKER_CONFIG="$cfg" docker login ghcr.io -u voidex-deploy --password-stdin >/dev/null 2>&1 ||
      { rm -rf "$cfg"; die "Could not log in to ghcr.io with the provided token."; }
  fi
  if ! DOCKER_CONFIG="$cfg" docker pull --quiet "$image" >/dev/null; then
    rm -rf "$cfg"
    die "Could not pull $image (does the image exist? was a registry token passed?)."
  fi
  rm -rf "$cfg"
  ok "Pulled $image"
}

wait_db() {
  log "PostgreSQL"
  compose up -d db >/dev/null
  for _ in $(seq 1 60); do
    if compose exec -T db pg_isready -U voidex -d voidex >/dev/null 2>&1; then
      ok "PostgreSQL accepts connections"
      return
    fi
    sleep 2
  done
  compose logs --tail 50 db || true
  die "PostgreSQL did not become ready."
}

backup_db() {
  local label=$1 file
  file="$BACKUPS/voidex-$(date -u +%Y%m%d-%H%M%S)-$label.dump"
  log "Database backup"
  compose exec -T db pg_dump -U voidex -d voidex --format=custom >"$file" || die "Backup failed — deployment stopped, nothing changed."
  chmod 600 "$file"
  ok "Saved $(basename "$file") ($(du -h "$file" | cut -f1))"
  # Keep the newest $KEEP_BACKUPS backups.
  ls -1t "$BACKUPS"/voidex-*.dump 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
}

run_migrations() {
  local tag=$1
  log "Database migrations (forward-only SQL, each in a transaction)"
  if ! VOIDEX_IMAGE="$IMAGE_REPO:$tag" compose run --rm --no-deps -T app node dist/db/migrate-cli.js; then
    die "Migrations failed. The running version was not touched."
  fi
  ok "Schema is up to date"
}

switch_to() {
  local tag=$1
  log "Starting version $(short "$tag")"
  VOIDEX_IMAGE="$IMAGE_REPO:$tag" compose up -d --no-deps app
  # Caddy: start if needed and reload the (possibly updated) Caddyfile.
  VOIDEX_IMAGE="$IMAGE_REPO:$tag" compose up -d --no-deps caddy
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
}

# Runs inside the app container so it works before DNS/HTTPS exist.
app_fetch() {
  compose exec -T app node -e "
    const path = process.argv[1];
    fetch('http://127.0.0.1:4000' + path).then(async (r) => {
      const body = await r.text();
      process.stdout.write(body);
      process.exit(r.ok ? 0 : 1);
    }).catch((e) => { console.error(String(e)); process.exit(1); });" "$1"
}

health_check() {
  local tag=$1 status body asset
  log "Health checks for $(short "$tag")"

  # 1. Containers running
  for svc in db app caddy; do
    status=$(docker inspect -f '{{.State.Status}}' "voidex-$svc-1" 2>/dev/null || echo missing)
    [[ "$status" == running ]] || { bad "container $svc: $status"; return 1; }
  done
  ok "Containers running: db, app, caddy"

  # 2. App container reports healthy (its own check hits /api/health → PostgreSQL)
  for _ in $(seq 1 45); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' voidex-app-1 2>/dev/null || echo missing)
    [[ "$status" == healthy ]] && break
    [[ "$status" == unhealthy ]] && break
    sleep 2
  done
  [[ "$status" == healthy ]] || { bad "app container health: $status"; return 1; }
  ok "App container healthy"

  # 3. PostgreSQL reachable
  compose exec -T db pg_isready -U voidex -d voidex >/dev/null || { bad "PostgreSQL not ready"; return 1; }
  ok "PostgreSQL ready"

  # 4. /api/health = 200 and serving THIS build
  body=$(app_fetch /api/health) || { bad "/api/health failed: $body"; return 1; }
  [[ "$body" == *"\"ok\":true"* ]] || { bad "/api/health unexpected: $body"; return 1; }
  [[ "$body" == *"\"revision\":\"$tag\""* ]] || { bad "/api/health reports another version: $body"; return 1; }
  ok "/api/health 200, revision $(short "$tag")"

  # 5. Frontend really loads: index.html and its main script
  body=$(app_fetch /) || { bad "frontend index not served"; return 1; }
  [[ "$body" == *'<div id="root">'* ]] || { bad "frontend index has no app root"; return 1; }
  asset=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<<"$body" | head -1)
  [[ -n "$asset" ]] || { bad "frontend index references no script"; return 1; }
  app_fetch "$asset" >/dev/null || { bad "frontend script $asset not served"; return 1; }
  ok "Frontend loads ($asset)"

  # SMS provider as the running app reports it (informational).
  body=$(app_fetch /api/system/info 2>/dev/null) || body=""
  if [[ "$body" == *'"smsAvailable":true'* ]]; then
    ok "SMS provider: $(grep -oE '"smsProvider":"[a-z]+"' <<<"$body" | cut -d'"' -f4) (available)"
  else
    printf '  • SMS provider: %s (phone verification unavailable)\n' "$(grep -oE '"smsProvider":"[a-z]+"' <<<"$body" | cut -d'"' -f4)"
  fi
  sleep 1
  body=$(compose logs --no-log-prefix --since 10m app 2>/dev/null | grep -oE 'SMS provider: otp\.com[^"]*' | tail -1) || true
  [[ -n "$body" ]] && printf '  • %s\n' "$body"

  # 6. Through Caddy (HTTPS). Informational: before DNS points here there is no certificate yet.
  if curl -fsS --max-time 10 --resolve voidex.su:443:127.0.0.1 https://voidex.su/api/health >/dev/null 2>&1; then
    ok "HTTPS through Caddy: https://voidex.su/api/health"
  else
    printf '  • HTTPS through Caddy not ready yet (certificate is issued once DNS points to this server)\n'
  fi
  return 0
}

record_success() {
  local tag=$1
  echo "$tag" >"$STATE/current"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $tag" >>"$STATE/history"
}

prune_images() {
  # Keep images of the last $KEEP_IMAGES successful releases (rollback targets).
  local keep
  keep=$(awk '{print $2}' "$STATE/history" 2>/dev/null | tac | awk '!seen[$0]++' | head -n "$KEEP_IMAGES")
  docker image ls "$IMAGE_REPO" --format '{{.Tag}}' | while read -r t; do
    grep -qx "$t" <<<"$keep" || docker image rm "$IMAGE_REPO:$t" >/dev/null 2>&1 || true
  done
  docker image prune -f >/dev/null 2>&1 || true
}

show_failure_logs() {
  log "Logs of the failed version"
  compose logs --tail 80 app 2>&1 || true
}

# Put the previous version back after a failed release.
restore() {
  local prev=$1
  if [[ -z "$prev" ]]; then
    bad "No previous version to return to (first deployment)."
    return 1
  fi
  log "Restoring previous version $(short "$prev")"
  switch_to "$prev"
  if health_check "$prev"; then
    ok "Previous version $(short "$prev") is serving again"
  else
    bad "Previous version is not healthy either — manual attention needed."
  fi
}

# ---------------------------------------------------------------- commands

cmd_deploy() {
  local tag=$1 prev
  prev=$(current_version)
  log "Deploying $(short "$tag") (current: $(short "$prev"))"
  preflight
  store_secrets
  pull_image "$tag"
  wait_db
  backup_db "before-$(short "$tag")"
  run_migrations "$tag"
  switch_to "$tag"
  if health_check "$tag"; then
    record_success "$tag"
    prune_images
    log "✅ Deployed $(short "$tag")"
  else
    show_failure_logs
    restore "$prev" || true
    die "❌ Version $(short "$tag") failed health checks and was NOT kept."
  fi
}

cmd_rollback() {
  local target=$1 cur
  cur=$(current_version)
  preflight
  if [[ "$target" == previous ]]; then
    target=$(awk '{print $2}' "$STATE/history" 2>/dev/null | tac | awk -v cur="$cur" '$0 != cur && !seen[$0]++' | head -1)
    [[ -n "$target" ]] || die "There is no earlier successful version to roll back to."
  fi
  log "Rolling back from $(short "$cur") to $(short "$target")"
  printf '  • Database schema is left as is (migrations are additive and backward compatible).\n'
  pull_image "$target"
  wait_db
  switch_to "$target"
  if health_check "$target"; then
    record_success "$target"
    log "✅ Now serving $(short "$target")"
  else
    show_failure_logs
    [[ -n "$cur" && "$cur" != "$target" ]] && restore "$cur" || true
    die "❌ Rollback target $(short "$target") failed health checks."
  fi
}

cmd_status() {
  local cur
  cur=$(current_version)
  log "Current version: ${cur:-none}"
  echo "Recent releases:"
  tail -n 10 "$STATE/history" 2>/dev/null | tac | sed 's/^/  /' || echo "  (none)"
  log "Containers"
  compose ps
  [[ -n "$cur" ]] && health_check "$cur" || true
  log "Server"
  echo "  $(uptime -p), load: $(cut -d' ' -f1-3 /proc/loadavg)"
  free -h | sed 's/^/  /'
  df -h / | sed 's/^/  /'
}

cmd_logs() {
  compose logs --tail 150 --timestamps app caddy db
}

read_secrets
case "${1:-}" in
  deploy) cmd_deploy "$2" ;;
  rollback) cmd_rollback "${2:-previous}" ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *)
    echo "usage: remote-deploy.sh deploy <commit> | rollback [<commit>|previous] | status | logs" >&2
    exit 2
    ;;
esac
