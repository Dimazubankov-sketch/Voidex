// SMS Aero connectivity diagnostics, run inside the app container by
// `remote-deploy.sh status` (same network path as SmsAeroProvider).
//
// Sends NO SMS. For each official API gateway (gate.smsaero.ru and the
// .org/.net gateways the official clients fail over to): DNS A/AAAA, TCP :443
// per address, TLS handshake, and GET /v2/auth (the documented auth test) —
// without and with credentials. Credentials come from the container
// environment and are never printed, only whether they are set.
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";

const HOSTS = ["gate.smsaero.ru", "gate.smsaero.org", "gate.smsaero.net"];
const STEP_MS = 12_000;
const out = (s) => console.log(`  ${s}`);
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;
const email = (process.env.SMS_AERO_EMAIL ?? "").trim();
const key = (process.env.SMS_AERO_API_KEY ?? "").trim();
const auth = email && key ? `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}` : null;

out(`credentials in container: SMS_AERO_EMAIL ${email ? "set" : "MISSING"}, SMS_AERO_API_KEY ${key ? "set" : "MISSING"} (values not shown)`);
out(`node ${process.version}, SMS_PROVIDER=${process.env.SMS_PROVIDER ?? "?"}`);

const tcp = (address, family) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const s = net.connect({ host: address, port: 443, family, timeout: STEP_MS });
    s.once("connect", () => { resolve({ ok: true, text: `OK ${ms(t0)}` }); s.destroy(); });
    s.once("timeout", () => { resolve({ ok: false, text: `TIMEOUT ${ms(t0)}` }); s.destroy(); });
    s.once("error", (e) => resolve({ ok: false, text: `ERROR ${e.code ?? e.message} ${ms(t0)}` }));
  });

const tlsCheck = (host, address) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const s = tls.connect({ host: address, port: 443, servername: host, timeout: STEP_MS });
    s.once("secureConnect", () => {
      const c = s.getPeerCertificate();
      resolve(`OK ${ms(t0)}, ${s.getProtocol()}, CN=${c?.subject?.CN} issuer=${c?.issuer?.O ?? c?.issuer?.CN} valid_to=${c?.valid_to} authorized=${s.authorized}`);
      s.destroy();
    });
    s.once("timeout", () => { resolve(`TIMEOUT during handshake ${ms(t0)}`); s.destroy(); });
    s.once("error", (e) => resolve(`ERROR ${e.code ?? e.message} ${ms(t0)}`));
  });

const get = (host, path, withAuth) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const marks = {};
    const headers = { Accept: "application/json" };
    if (withAuth && auth) headers.Authorization = auth;
    const req = https.request({ host, port: 443, path, method: "GET", headers, timeout: STEP_MS }, (res) => {
      marks.firstByte = ms(t0);
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        let summary = `non-JSON body (${data.length} bytes, content-type ${res.headers["content-type"] ?? "?"})`;
        try {
          const j = JSON.parse(data);
          summary = JSON.stringify({ success: j.success, message: j.message ?? null });
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
      const stage = !marks.connect ? "TCP connect" : !marks.tls ? "TLS handshake" : "waiting for response";
      resolve(`TIMEOUT at ${stage} ${ms(t0)} (ip ${marks.ip ?? "?"})`);
      req.destroy();
    });
    req.on("error", (e) => resolve(`ERROR ${e.code ?? e.message} ${ms(t0)}`));
    req.end();
  });

for (const host of HOSTS) {
  out(`── ${host}`);
  const v4 = await dns.resolve4(host).catch((e) => (out(`DNS A: ${e.code}`), []));
  const v6 = await dns.resolve6(host).catch((e) => (out(`DNS AAAA: ${e.code}`), []));
  if (v4.length) out(`DNS A: ${v4.join(", ")}`);
  if (v6.length) out(`DNS AAAA: ${v6.join(", ")}`);
  let tlsTarget = null;
  for (const [address, family] of [...v4.slice(0, 2).map((a) => [a, 4]), ...v6.slice(0, 1).map((a) => [a, 6])]) {
    const r = await tcp(address, family);
    out(`TCP ${address}:443 → ${r.text}`);
    if (r.ok && family === 4 && !tlsTarget) tlsTarget = address;
  }
  if (tlsTarget) out(`TLS ${tlsTarget} (SNI ${host}) → ${await tlsCheck(host, tlsTarget)}`);
  out(`GET /v2/auth (no credentials) → ${await get(host, "/v2/auth", false)}`);
  if (auth) out(`GET /v2/auth (Basic auth)     → ${await get(host, "/v2/auth", true)}`);
}
