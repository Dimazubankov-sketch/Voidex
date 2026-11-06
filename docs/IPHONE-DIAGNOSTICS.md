# VOIDEX — iPhone can't reach the server: finding the cause

**Symptom.** From one iPhone, `curl -v https://voidex.su/api/health` (a-Shell) connects over TCP, sends the TLS
ClientHello and never receives a ServerHello (`curl: (28) SSL connection timeout`). Other sites work from the same
phone, other phones reach VOIDEX. This happens *before any HTTP*, so no change in the web app can fix it — the web
app only decides what the person sees when it *is* reachable (see "What the app does" at the end).

What is **not** yet known: where the ClientHello (or the ServerHello) is lost. The steps below find the point.
Do them in order; each step has a decision. Run server commands as root on voidex-01 (DigitalOcean console or SSH).

Scripts: `deploy/netdiag.sh` (+ `deploy/netdiag-analyze.py`). They are read-only except `listener` (one temporary
port, closed on exit) and `capture` (pcap files in `/root/netdiag`). Copy them to the server:
`cd /opt/voidex/repo && git pull` (or paste from GitHub), then `bash deploy/netdiag.sh state`.

## Step 0 — what is the phone's real public IP?

The earlier captures could not be tied to the phone. Fix that first. On the iPhone, a-Shell:

```sh
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|colo|loc)='
```

Note `ip=` (call it `PHONEIP`). Do it once on Wi-Fi and once on mobile data (Wi-Fi off) — they differ.
Also note: is a VPN, a DNS/"ad-block" profile, iCloud Private Relay or a content-blocker app on?
(Settings → General → VPN & Device Management; Settings → Apple ID → iCloud → Private Relay.)

## Step 1 — server side: does the ClientHello arrive?

On the server (replace `PHONEIP`):

```sh
bash deploy/netdiag.sh state                       # firewall / conntrack / listeners / Caddy errors; save the output
bash deploy/netdiag.sh capture PHONEIP 120
```

While it runs (120 s), on the iPhone: `curl -v --connect-timeout 20 https://voidex.su/api/health`.
The script captures on the host interface **and** inside Caddy's network namespace and prints one verdict per
connection:

| Verdict | Meaning | Where to look |
|---|---|---|
| no connection from PHONEIP at all | the SYN never arrives — the phone's route to this IP is cut before TCP | path / provider / device (Steps 2–4) |
| handshake OK, **no data from the client** | ClientHello is dropped *after* the handshake: the classic signature of DPI/SNI filtering on the path (or a firewall that passes SYN only) | Steps 2–3 |
| ClientHello arrived, server sent **nothing** | the server side swallowed it: firewall/Docker/Caddy | `state` output; compare host vs Caddy-namespace capture |
| ClientHello arrived on the host but **not inside Caddy's namespace** | lost in Docker NAT / iptables | `state` (DOCKER chains, ufw), `docker network inspect` |
| server answered, **retransmits** | ServerHello leaves the server but never reaches the phone: return path loss (MTU/MSS or filtering) | Step 4 |
| data both ways | TLS flowed — then the problem is not TLS; look at the phone's app | — |

Keep the two `.pcap` files; the verdict plus the `ip=` value is all that is needed to decide.

## Step 2 — is it the destination IP, the SNI, or the port? (on the iPhone)

These use only the phone and public hosts; no certificate checks are disabled (a certificate error is the *good*
outcome here: it proves a ServerHello arrived).

```sh
# A. Our IP, someone else's SNI.   Certificate error / any reply = ServerHello arrived => SNI "voidex.su" is the trigger
curl -sv --connect-timeout 20 --resolve www.cloudflare.com:443:161.35.135.122 https://www.cloudflare.com/ -o /dev/null 2>&1 | tail -5

# B. Cloudflare's IP, our SNI.     Reply (even 403/421) = SNI is fine => the destination IP is the trigger.   Timeout = SNI "voidex.su" is blocked on the path
curl -sv --connect-timeout 20 --connect-to voidex.su:443:www.cloudflare.com:443 https://voidex.su/ -o /dev/null 2>&1 | tail -5

# C. Another port on our IP (needs the server listener below).
curl -sv --connect-timeout 20 https://161.35.135.122:8443/ -o /dev/null 2>&1 | tail -5
```

For C, on the server first: `bash deploy/netdiag.sh listener 8443 300` (self-signed throw-away certificate; closes
itself).

Reading the results:

* A works (cert error), B times out → **filtering by SNI `voidex.su`**.
* A times out, B works → **filtering by destination IP/range** (161.35.135.122 or the whole hosting range).
* A and B both time out but Cloudflare works plainly → the filter looks at both, or the phone has a profile rule; do Step 3.
* C works but 443 does not → the filter is port-specific.
* Everything times out only on this phone, but another device on the **same network** works → the phone itself
  (VPN/profile/blocker/Private Relay): Step 3.

## Step 3 — separate the phone from the network

1. Another device on the same Wi-Fi: `curl -v https://voidex.su/api/health`.
2. The same phone on mobile data only, **and** on a different Wi-Fi (a friend's, a hotspot from another phone).
3. Phone: turn off VPN, Private Relay, DNS profiles and content blockers; Settings → General → Transfer or Reset →
   Reset → *Reset Network Settings* (removes saved Wi-Fi passwords and VPN configs; does not erase data).
4. Check DNS really gives `161.35.135.122`: `nslookup voidex.su`.

If it works on another network but not on this phone's usual ones → the provider/operator filters this destination.
If it fails on every network only on this phone → a profile/app on the phone.

## Step 4 — MTU / return path (only if the verdict said "retransmits")

```sh
bash deploy/netdiag.sh mtu PHONEIP      # many phones don't answer ping; "no reply" everywhere is inconclusive
```

On the phone: `curl -v --tls-max 1.2 --tlsv1.2 --connect-timeout 20 https://voidex.su/api/health` (smaller
ClientHello, different cipher list). If only a large ClientHello fails, the path drops big first packets.

## What each outcome means for a fix

* **Filtering on the path (SNI or IP):** cannot be fixed by code. Options that keep the domain and the
  infrastructure type: a different public IP on DigitalOcean (Reserved IP → update the `A` records, TTL first lowered
  to 300 s) and re-test Step 2; if the IP range is the trigger, a droplet in another DigitalOcean region/IP range.
  Decide after Step 2; do not change anything before then.
* **Firewall/Docker on the server:** the `state` and double capture point at the exact rule; fix that rule.
* **Phone profile/app:** remove it; nothing to change on the server.
* **MTU:** clamp MSS on the server (`iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu`) and re-test.

Do not use `curl -k`/`--insecure` as a fix and do not weaken TLS settings; neither is needed for any step above.

## When VOIDEX is reachable: acceptance check on the iPhone

1. `curl -v https://voidex.su/api/health` → `HTTP/2 200` and `{"ok":true,"revision":"…"}`.
2. Safari: open `https://voidex.su` → sign-in form or the desktop, never an empty page.
3. Existing account: sign in (a 423 means "locked": the code-password screen appears, that is normal).
4. Home-screen app: delete the old icon, open Safari → Share → *Add to Home Screen*, launch it from the icon.
5. Turn on Airplane mode and launch the icon: the app opens and says it can't reach the server, with «Повторить»
   (not a blank screen). Turn it off and tap «Повторить»: the app loads.
6. Updates: after the next release, `https://voidex.su/version.json` shows the new build. Leave the app in the
   background for a minute and open it again: it restarts into the new build by itself (no button). A half-typed
   text or a running upload is never cut off — the restart waits for it.
7. Failed chunk (only worth testing once): Safari → open VOIDEX, turn on Airplane mode, open an app inside VOIDEX that
   was never opened before. The app shows its error screen with «Повторить»; turn Airplane mode off, tap «Повторить»:
   the app must recover. (Playwright's WebKit could not reproduce the recovery — this is the check that settles it.)

## What the app does when the network is bad (so a blank screen can't come back)

* `boot-guard.js` shows «Не удалось загрузить VOIDEX» with «Повторить» if the app does not report a successful first
  render within 12 s — whether or not React partly mounted. At most two automatic retries (a failed file, or the network coming back), then it waits for the person.
* Service Worker caches the app shell and the hashed files of the current and previous builds, so a home-screen launch
  without a connection shows the app's own "no connection" screen instead of nothing.
* Startup requests have timeouts; a network failure is reported as "no connection" and never as "signed out".
