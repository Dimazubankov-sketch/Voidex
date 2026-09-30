// SMS Aero connectivity diagnostics, run inside the app container by
// `remote-deploy.sh status` (same network path as SmsAeroProvider).
//
// Sends NO SMS. Only: DNS, TCP :443, TLS handshake, and the documented
// read-only endpoints GET/POST /v2/auth (auth test) and GET /v2/balance.
// Credentials come from the container environment and are never printed —
// only whether they are set.
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";

const HOST = "gate.smsaero.ru";
const STEP_MS = 12_000;
const out = (s) => console.log(`  ${s}`);
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;
const email = (process.env.SMS_AERO_EMAIL ?? "").trim();
const key = (process.env.SMS_AERO_API_KEY ?? "").trim();
const auth = email && key ? `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}` : null;

out(`credentials in container: SMS_AERO_EMAIL ${email ? "set" : "MISSING"}, SMS_AERO_API_KEY ${key ? "set" : "MISSING"} (values not shown)`);
out(`node ${process.version}, SMS_PROVIDER=${process.env.SMS_PROVIDER ?? "?"}`);

// 1. DNS
let addrs = [];
{
  const t0 = performance.now();
  try {
    addrs = await dns.lookup(HOST, { all: true });
    out(`DNS ${HOST}: ${addrs.map((a) => `${a.address} (IPv${a.family})`).join(", ")} in ${ms(t0)}`);
  } catch (e) {
    out(`DNS ${HOST}: FAILED ${e.code ?? e.message} after ${ms(t0)}`);
  }
  for (const alt of ["gate.smsaero.org", "gate.smsaero.net"]) {
    try {
      const a = await dns.lookup(alt, { all: true });
      out(`DNS ${alt} (official mirror): ${a.map((x) => x.address).join(", ")}`);
    } catch (e) {
      out(`DNS ${alt}: FAILED ${e.code ?? e.message}`);
    }
  }
}

// 2. TCP :443 per address
const tcp = (address, family) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const s = net.connect({ host: address, port: 443, family, timeout: STEP_MS });
    s.once("connect", () => { resolve(`OK in ${ms(t0)}`); s.destroy(); });
    s.once("timeout", () => { resolve(`TIMEOUT (no SYN-ACK) after ${ms(t0)}`); s.destroy(); });
    s.once("error", (e) => resolve(`ERROR ${e.code ?? e.message} after ${ms(t0)}`));
  });
const reachable = [];
for (const a of addrs) {
  const r = await tcp(a.address, a.family);
  out(`TCP ${a.address}:443 → ${r}`);
  if (r.startsWith("OK")) reachable.push(a);
}

// 3. TLS handshake (SNI = gate.smsaero.ru)
for (const a of reachable.slice(0, 2)) {
  const r = await new Promise((resolve) => {
    const t0 = performance.now();
    const s = tls.connect({ host: a.address, port: 443, servername: HOST, timeout: STEP_MS });
    s.once("secureConnect", () => {
      const c = s.getPeerCertificate();
      resolve(`OK in ${ms(t0)}, ${s.getProtocol()}, cert CN=${c?.subject?.CN} issuer=${c?.issuer?.O ?? c?.issuer?.CN} valid_to=${c?.valid_to} authorized=${s.authorized}${s.authorizationError ? ` (${s.authorizationError})` : ""}`);
      s.destroy();
    });
    s.once("timeout", () => { resolve(`TIMEOUT during handshake after ${ms(t0)}`); s.destroy(); });
    s.once("error", (e) => resolve(`ERROR ${e.code ?? e.message} after ${ms(t0)}`));
  });
  out(`TLS ${a.address} → ${r}`);
}

// 4. HTTP with per-stage timings (node:https), read-only endpoints only
const request = (method, path, { body, withAuth = true } = {}) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const marks = {};
    const headers = { Accept: "application/json" };
    if (withAuth && auth) headers.Authorization = auth;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const req = https.request({ host: HOST, port: 443, path, method, headers, timeout: STEP_MS }, (res) => {
      marks.firstByte = ms(t0);
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        let summary = data.slice(0, 160).replace(/\s+/g, " ");
        try {
          const j = JSON.parse(data);
          summary = JSON.stringify({ success: j.success, message: j.message ?? null, ...(path.endsWith("balance") && j.data ? { balance: j.data.balance } : {}) });
        } catch {}
        resolve(`HTTP ${res.statusCode} ${summary} | connect ${marks.connect ?? "-"}, tls ${marks.tls ?? "-"}, first byte ${marks.firstByte}, total ${ms(t0)}`);
      });
    });
    req.on("socket", (s) => {
      s.once("lookup", (_e, address) => (marks.ip = address));
      s.once("connect", () => (marks.connect = ms(t0)));
      s.once("secureConnect", () => (marks.tls = ms(t0)));
    });
    req.on("timeout", () => {
      const stage = !marks.connect ? "TCP connect" : !marks.tls ? "TLS handshake" : "waiting for response (read)";
      resolve(`TIMEOUT at ${stage} after ${ms(t0)} (ip ${marks.ip ?? "?"}, connect ${marks.connect ?? "-"}, tls ${marks.tls ?? "-"})`);
      req.destroy();
    });
    req.on("error", (e) => resolve(`ERROR ${e.code ?? e.message} after ${ms(t0)}`));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

out(`GET  /v2/auth (no credentials)      → ${await request("GET", "/v2/auth", { withAuth: false })}`);
if (auth) {
  out(`GET  /v2/auth (Basic auth)          → ${await request("GET", "/v2/auth")}`);
  // Same method / headers / body type as SmsAeroProvider, on the auth-test endpoint.
  out(`POST /v2/auth (JSON, as provider)   → ${await request("POST", "/v2/auth", { body: {} })}`);
  out(`GET  /v2/balance (Basic auth)       → ${await request("GET", "/v2/balance")}`);
  // Same HTTP client as SmsAeroProvider (global fetch / undici), 10 s like the provider.
  {
    const t0 = performance.now();
    try {
      const r = await fetch(`https://${HOST}/v2/auth`, {
        method: "POST",
        headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => null);
      out(`fetch POST /v2/auth (provider stack) → HTTP ${r.status} ${JSON.stringify({ success: j?.success, message: j?.message ?? null })} in ${ms(t0)}`);
    } catch (e) {
      out(`fetch POST /v2/auth (provider stack) → ${e.name} ${e.cause?.code ?? e.message} after ${ms(t0)}`);
    }
  }
} else {
  out("authenticated checks skipped: credentials missing in the container");
}

// 5. Outgoing IP as seen from the internet
for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip"]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    out(`outgoing IP (${new URL(url).host}): ${(await r.text()).trim()}`);
    break;
  } catch (e) {
    out(`outgoing IP (${new URL(url).host}): ${e.name}`);
  }
}
