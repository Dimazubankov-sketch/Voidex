#!/usr/bin/env bash
# VOIDEX — one-time setup of the production server (voidex-01, Ubuntu 24.04).
#
# Run as root (DigitalOcean → Droplet → Console):
#   curl -fsSL https://raw.githubusercontent.com/Dimazubankov-sketch/Voidex/main/deploy/bootstrap.sh -o /root/voidex-bootstrap.sh && bash /root/voidex-bootstrap.sh
#
# Safe to run again: it never deletes data, never overwrites existing secrets
# and does not touch the SSH daemon configuration or root's SSH access.
#
# What it does:
#   • Docker Engine + Compose plugin (official repository), log rotation
#   • 2 GB swap (only if the server has none)
#   • firewall: allow SSH, HTTP, HTTPS; deny everything else incoming
#   • user `deploy` (no password, docker group) for GitHub Actions
#   • /opt/voidex: code checkout, production .env with generated secrets
#   • a dedicated SSH key that may ONLY run the deploy command
#
# Set ROTATE_KEY=1 to replace the deploy key (e.g. if it was lost or leaked).
set -Eeuo pipefail

REPO_URL=https://github.com/Dimazubankov-sketch/Voidex.git
BRANCH=main
BASE=/opt/voidex
KEY_COMMENT=voidex-github-actions-deploy

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this as root (the DigitalOcean console logs you in as root)."
. /etc/os-release
[[ "$ID" == ubuntu ]] || die "This script is for Ubuntu (found $ID)."

APT=(apt-get -y -o DPkg::Lock::Timeout=600)
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- system
say "System packages"
"${APT[@]}" update -qq
"${APT[@]}" install -qq ca-certificates curl git ufw openssl >/dev/null
ok "curl, git, ufw, openssl"

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  "${APT[@]}" update -qq
  "${APT[@]}" install -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
if [[ ! -f /etc/docker/daemon.json ]]; then
  # Keep container logs from filling the disk.
  mkdir -p /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1
ok "$(docker --version)"
ok "$(docker compose version)"

say "Swap"
if [[ -z "$(swapon --show --noheadings)" ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-voidex-swap.conf
  sysctl -q -p /etc/sysctl.d/90-voidex-swap.conf
  ok "2 GB swap created"
else
  ok "Swap already present: $(swapon --show --noheadings | awk '{print $3}' | head -1)"
fi

say "Firewall"
ufw allow OpenSSH >/dev/null # SSH first — never lock ourselves out
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ok "Open: 22 (SSH), 80 (HTTP), 443 (HTTPS). Everything else incoming is blocked."
ok "PostgreSQL has no published port at all (internal Docker network only)."

# ---------------------------------------------------------------- deploy user
say "Deploy user"
if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
fi
passwd -l deploy >/dev/null 2>&1 || true # key-only, no password login
usermod -aG docker deploy
ok "User 'deploy' (no password, member of 'docker')"

say "VOIDEX directory $BASE"
install -d -o root -g deploy -m 0750 "$BASE"
install -d -o root -g root -m 0755 "$BASE/bin"
install -d -o deploy -g deploy -m 0750 "$BASE/state" "$BASE/backups"
if [[ ! -d "$BASE/repo/.git" ]]; then
  install -d -o deploy -g deploy -m 0750 "$BASE/repo"
  sudo -u deploy git clone --quiet --branch "$BRANCH" "$REPO_URL" "$BASE/repo"
else
  sudo -u deploy git -C "$BASE/repo" fetch --quiet origin "$BRANCH"
  sudo -u deploy git -C "$BASE/repo" checkout --quiet --force --detach "origin/$BRANCH"
fi
ok "Code: $BASE/repo ($(sudo -u deploy git -C "$BASE/repo" rev-parse --short HEAD))"
install -o root -g root -m 0755 "$BASE/repo/deploy/voidex-deploy" "$BASE/bin/voidex-deploy"
ok "Deploy command: $BASE/bin/voidex-deploy"

say "Production secrets ($BASE/.env)"
if [[ -f "$BASE/.env" ]]; then
  ok "Already exists — kept unchanged (secrets are never regenerated)."
else
  umask 077
  PG_PASSWORD=$(openssl rand -hex 32)
  cat >"$BASE/.env" <<ENV
# VOIDEX production configuration — generated on this server by bootstrap.sh.
# Never commit or copy this file. Readable only by root and the deploy user.
NODE_ENV=production

# PostgreSQL (container 'db', internal network only).
# Note: POSTGRES_PASSWORD is applied when the database is first created.
POSTGRES_PASSWORD=${PG_PASSWORD}
DATABASE_URL=postgres://voidex:${PG_PASSWORD}@db:5432/voidex

# Signs access tokens (JWT HS256).
AUTH_ACCESS_SECRET=$(openssl rand -hex 48)
# Keyed hashing of one-time codes and challenge/recovery secrets.
AUTH_TOKEN_PEPPER=$(openssl rand -hex 48)

# Internal mail addresses: name@voidops.ru
MAIL_DOMAIN=voidops.ru

# Used only while no otp.com key has been delivered: phone verification is
# refused (never faked). Once the GitHub secret OTP_API_KEY reaches the server
# (on deploy), releases run with SMS_PROVIDER=otpcom automatically.
SMS_PROVIDER=disabled

LOG_LEVEL=info
ENV
  unset PG_PASSWORD
  ok "Generated: POSTGRES_PASSWORD, AUTH_ACCESS_SECRET, AUTH_TOKEN_PEPPER (random, not shown)"
fi
chown root:deploy "$BASE/.env"
chmod 0640 "$BASE/.env"
ok "Permissions: root:deploy 640"

# ---------------------------------------------------------------- deploy key
say "GitHub Actions deploy key"
AUTH_KEYS=/home/deploy/.ssh/authorized_keys
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
touch "$AUTH_KEYS"
chown deploy:deploy "$AUTH_KEYS"
chmod 0600 "$AUTH_KEYS"

PRIVATE_KEY_B64=""
if grep -q "$KEY_COMMENT" "$AUTH_KEYS" && [[ "${ROTATE_KEY:-0}" != 1 ]]; then
  ok "Deploy key already installed (run with ROTATE_KEY=1 to replace it)."
else
  TMP=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N "" -C "$KEY_COMMENT" -f "$TMP/key"
  # The key may only run the deploy command: no shell, no forwarding, no pty.
  grep -v "$KEY_COMMENT" "$AUTH_KEYS" >"$TMP/keys" || true
  echo "restrict,command=\"$BASE/bin/voidex-deploy\" $(cat "$TMP/key.pub")" >>"$TMP/keys"
  install -o deploy -g deploy -m 0600 "$TMP/keys" "$AUTH_KEYS"
  PRIVATE_KEY_B64=$(base64 -w0 "$TMP/key")
  # The private key is not kept on the server: it lives only in GitHub Secrets.
  shred -u "$TMP/key" 2>/dev/null || rm -f "$TMP/key"
  rm -rf "$TMP"
  ok "New deploy key installed for user 'deploy' (restricted to the deploy command)"
fi

PUBLIC_IP=$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || hostname -I | awk '{print $1}')
KNOWN_HOSTS="$PUBLIC_IP $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"

# ---------------------------------------------------------------- summary
say "Done. Server is ready for its first deployment."
cat <<INFO

  Server IP: $PUBLIC_IP
  Root SSH access was NOT changed.

Add these to GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:

INFO
if [[ -n "$PRIVATE_KEY_B64" ]]; then
  printf '\033[1m────────── SECRET 1   Name: DEPLOY_SSH_KEY   (copy the single line below) ──────────\033[0m\n'
  printf '%s\n' "$PRIVATE_KEY_B64"
  printf '\033[1m────────────────────────────────────────────────────────────────────────────────────\033[0m\n\n'
else
  printf '  (DEPLOY_SSH_KEY: unchanged — already saved in GitHub earlier)\n\n'
fi
printf '\033[1m────────── SECRET 2   Name: DEPLOY_KNOWN_HOSTS   (copy the single line below) ──────\033[0m\n'
printf '%s\n' "$KNOWN_HOSTS"
printf '\033[1m────────────────────────────────────────────────────────────────────────────────────\033[0m\n'
if [[ -n "$PRIVATE_KEY_B64" ]]; then
  printf '\n  The private key above is shown ONCE and is not stored on this server.\n'
  printf '  If you lose it, run:  ROTATE_KEY=1 bash /root/voidex-bootstrap.sh\n'
fi
