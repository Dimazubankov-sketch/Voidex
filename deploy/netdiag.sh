#!/usr/bin/env bash
# VOIDEX network / TLS diagnostics — run as root on voidex-01. Read-only except `listener` (opens one
# temporary port, closes it on exit) and `capture` (writes pcaps to /root/netdiag). Changes nothing else.
#
#   netdiag.sh state                    firewall, conntrack, listeners, Caddy TLS errors, MTU of the interface
#   netdiag.sh capture <client-ip> [s]  capture :443 for that client on the host interface AND inside the
#                                       Caddy container, then print a per-connection verdict (default 90 s)
#   netdiag.sh analyze <file.pcap>      verdict for an existing capture
#   netdiag.sh listener [port] [s]      temporary TLS server on another port (default 8443, 300 s) with a
#                                       throw-away self-signed certificate, to test the path without Caddy
#   netdiag.sh mtu <client-ip>          path-MTU probe towards the client (needs it to answer ICMP; many do not)
#
# The workflow is in docs/IPHONE-DIAGNOSTICS.md. Never run this against hosts you do not own.
set -uo pipefail
OUT=/root/netdiag
mkdir -p "$OUT"
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 (apt-get install -y $2)" >&2; exit 2; }; }
CADDY=${CADDY_CONTAINER:-voidex-caddy-1}

state() {
  echo "== date / kernel"; date -u; uname -r
  echo "== interfaces + MTU"; ip -br link; ip -4 -br addr
  echo "== listeners on 80/443"; ss -ltnup | grep -E ':(80|443)\b' || true
  echo "== ufw"; ufw status verbose 2>&1 | head -30
  echo "== nft / iptables (counters; look for DROP/REJECT/limit rules and the DOCKER chains)"
  (nft list ruleset 2>/dev/null || iptables-save -c 2>/dev/null) | grep -Ei 'drop|reject|limit|443|dport' | head -40 || true
  echo "== conntrack"
  if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then
    echo "count=$(cat /proc/sys/net/netfilter/nf_conntrack_count) max=$(cat /proc/sys/net/netfilter/nf_conntrack_max)"
  else echo "conntrack not loaded"; fi
  echo "== docker"; docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo "== Caddy: TLS / handshake errors, last 200 lines"
  docker logs --tail 200 "$CADDY" 2>&1 | grep -Ei 'tls|handshake|error|warn' | tail -25 || true
  echo "== Caddy: certificate"
  echo | openssl s_client -connect 127.0.0.1:443 -servername voidex.su 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true
  echo "== local TLS handshake with ClientHello sizes (TLS1.2 / TLS1.3)"
  for v in -tls1_2 -tls1_3; do
    printf '%s: ' "$v"; echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername voidex.su $v 2>&1 | grep -E 'Protocol|Cipher is' | tr '\n' ' '; echo
  done
  echo "== DigitalOcean: a Cloud Firewall (control panel → Networking → Firewalls) is NOT visible from here — check it by hand"
}

capture() {
  local ip=${1:?client ip}; local secs=${2:-90}
  need tcpdump tcpdump
  [[ $ip =~ ^[0-9a-fA-F.:]+$ ]] || { echo "bad ip" >&2; exit 2; }
  local ts; ts=$(date -u +%Y%m%dT%H%M%SZ)
  local host_pcap="$OUT/$ts-host-$ip.pcap" ns_pcap="$OUT/$ts-caddy-$ip.pcap"
  local pid; pid=$(docker inspect -f '{{.State.Pid}}' "$CADDY" 2>/dev/null || true)
  echo "capturing $secs s for $ip — now run on the iPhone:  curl -v --connect-timeout 20 https://voidex.su/api/health"
  timeout "$secs" tcpdump -i any -nn -s 0 -U -w "$host_pcap" "host $ip and (tcp port 443 or tcp port 8443 or icmp or udp port 443)" 2>/dev/null &
  local p1=$!
  local p2=""
  if [ -n "$pid" ] && command -v nsenter >/dev/null; then
    timeout "$secs" nsenter -t "$pid" -n tcpdump -i any -nn -s 0 -U -w "$ns_pcap" "host $ip and tcp port 443" 2>/dev/null &
    p2=$!
  fi
  wait $p1 ${p2:+$p2} 2>/dev/null
  echo; echo "##### host interface: $host_pcap"; analyze "$host_pcap"
  [ -s "$ns_pcap" ] && { echo; echo "##### inside Caddy's network namespace: $ns_pcap"; analyze "$ns_pcap"; }
  echo
  echo "Compare the two: a ClientHello on the host that never appears in the namespace = lost in Docker/NAT/iptables;"
  echo "no ClientHello on the host at all = lost before the server (path / provider / device)."
}

analyze() {
  local f=${1:?pcap}
  need tcpdump tcpdump; need python3 python3
  tcpdump -r "$f" -nn -S -tt -v 2>/dev/null | python3 -I "$(dirname "$(readlink -f "$0")")/netdiag-analyze.py"
}

listener() {
  local port=${1:-8443} secs=${2:-300}
  need openssl openssl; need ufw ufw
  [[ $port =~ ^[0-9]+$ ]] || exit 2
  local d; d=$(mktemp -d)
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$d/k.pem" -out "$d/c.pem" -days 1 -subj "/CN=netdiag.voidex.su" 2>/dev/null
  ufw allow "$port"/tcp >/dev/null
  trap 'ufw delete allow '"$port"'/tcp >/dev/null 2>&1; rm -rf "$d"; echo "listener closed"' EXIT
  echo "TLS test server on 161.35.135.122:$port for $secs s (self-signed; a client is EXPECTED to report a certificate error)"
  echo "On the iPhone (a-Shell):  curl -v --connect-timeout 20 https://161.35.135.122:$port/"
  echo "  curl error 60 / 'SSL certificate problem' = the ServerHello reached the phone (path is fine on this port)"
  echo "  curl error 28 / timeout during handshake  = the path loses it regardless of port and certificate"
  timeout "$secs" openssl s_server -accept "$port" -cert "$d/c.pem" -key "$d/k.pem" -www -quiet 2>&1 | tail -5
}

mtu() {
  local ip=${1:?client ip}
  echo "path MTU probe to $ip (DF set). A size that fails while smaller ones pass = the path MTU is below it."
  for s in 1472 1452 1432 1400 1372 1272 1172; do
    if ping -c 2 -W 2 -M do -s "$s" "$ip" >/dev/null 2>&1; then echo "payload $s (MTU $((s+28))): ok"; else echo "payload $s (MTU $((s+28))): no reply"; fi
  done
}

case "${1:-}" in
  state) state ;;
  capture) shift; capture "$@" ;;
  analyze) shift; analyze "$@" ;;
  listener) shift; listener "$@" ;;
  mtu) shift; mtu "$@" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
