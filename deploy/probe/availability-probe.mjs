// VOIDEX availability probe (DRAFT, not merged / not yet run against the live API).
//
// Asks the public Globalping network (https://globalping.io, free, no account) to fetch voidex.su from probes in
// Russia, Germany and the USA, and fails when Russian probes cannot get the page. It fetches a LARGE script, not only
// /api/health: the throttling applied by Russian operators to foreign hosting (about 16 KB per connection) lets small
// answers through, so a health check alone reports "up" while the site cannot load.
//
//   node deploy/probe/availability-probe.mjs            run against https://voidex.su
//   node deploy/probe/availability-probe.mjs --selftest check the evaluation logic offline
import { pathToFileURL } from "node:url";

const SITE = process.env.PROBE_SITE ?? "https://voidex.su";
const API = "https://api.globalping.io/v1/measurements";
const LOCATIONS = [{ country: "RU", limit: 4 }, { country: "DE", limit: 1 }, { country: "US", limit: 1 }];
const MAX_TOTAL_MS = 15_000; // a healthy download of the bundle takes far less; a throttled one stalls or resets

export function evaluate(results, { minOkRu = 0.5 } = {}) {
  const rows = results.map((r) => {
    const t = r.result ?? {};
    const ok = t.status === "finished" && t.statusCode === 200 && (t.timings?.total ?? Infinity) <= MAX_TOTAL_MS;
    return { country: r.probe?.country ?? "?", city: r.probe?.city ?? "", network: r.probe?.network ?? "", asn: r.probe?.asn ?? "", ok, status: t.status, code: t.statusCode, total: t.timings?.total };
  });
  const ru = rows.filter((r) => r.country === "RU");
  const ruOk = ru.length ? ru.filter((r) => r.ok).length / ru.length : null;
  const failed = ruOk !== null ? ruOk < minOkRu : rows.some((r) => !r.ok); // no Russian probe answered: judge on all probes
  return { rows, ruOk, failed };
}

async function jsonFetch(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function measure(path) {
  const start = await jsonFetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "http",
      target: new URL(SITE).hostname,
      locations: LOCATIONS,
      measurementOptions: { request: { method: "GET", path }, protocol: "HTTPS", port: 443 },
    }),
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const m = await jsonFetch(`${API}/${start.id}`);
    if (m.status === "finished") return m.results;
  }
  throw new Error(`measurement ${start.id} did not finish in time`);
}

async function main() {
  const html = await (await fetch(`${SITE}/`, { signal: AbortSignal.timeout(20_000) })).text();
  const asset = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  if (!asset) throw new Error("no /assets/index-*.js in the front page");
  let failed = false;
  for (const path of ["/api/health", asset]) {
    const out = evaluate(await measure(path));
    console.log(`\n== ${path}  (Russian probes ok: ${out.ruOk === null ? "no RU probe" : Math.round(out.ruOk * 100) + "%"})`);
    for (const r of out.rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.country} ${r.city} ${r.network} AS${r.asn} status=${r.status} code=${r.code ?? "-"} total=${r.total ?? "-"} ms`);
    failed ||= out.failed;
  }
  if (failed) {
    console.error("\nAVAILABILITY PROBLEM: see the table above");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--selftest")) {
    const ok = { probe: { country: "RU", city: "Moscow" }, result: { status: "finished", statusCode: 200, timings: { total: 900 } } };
    const stalled = { probe: { country: "RU", city: "Tula", network: "Rostelecom" }, result: { status: "failed", timings: {} } };
    const slow = { probe: { country: "RU" }, result: { status: "finished", statusCode: 200, timings: { total: 40_000 } } };
    const assert = (c, m) => { if (!c) { console.error("selftest failed:", m); process.exit(1); } };
    assert(!evaluate([ok, ok, { ...ok, probe: { country: "DE" } }]).failed, "all ok");
    assert(evaluate([stalled, stalled, ok]).failed, "two of three Russian probes stalled");
    assert(evaluate([slow, slow]).failed, "too slow counts as failed");
    assert(!evaluate([ok, stalled]).failed, "half of the Russian probes ok is tolerated (minOkRu 0.5)");
    assert(evaluate([{ probe: { country: "DE" }, result: { status: "failed" } }]).failed, "no Russian probe: judge on all");
    console.log("selftest ok");
  } else {
    main().catch((e) => { console.error(e.message); process.exit(1); });
  }
}
