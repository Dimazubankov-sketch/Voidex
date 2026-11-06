// A tiny reverse proxy in front of the API server for the release-build e2e suite. It can make the "network"
// misbehave at the TCP level, which Playwright's page.route cannot do for service-worker fetches or WebKit:
//   GET /__proxy/set?mode=up|down|hang&block=<substring>&status=404|reset
//     down  – every connection is reset at once (what a dead radio / refused connection looks like)
//     hang  – the connection is accepted and never answered (what the stalled TLS/HTTP path of the iPhone looks like)
//     block – only URLs containing the substring fail: 404 (no-store), a reset, or `hang` (never answered);
//             `only=<substr>` (repeatable) replaces `block` with several substrings
// Control URLs always work. Everything else is passed through untouched (headers, streaming, cookies).
import http from "node:http";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 4101);
const TARGET = Number(process.env.E2E_PROD_PORT ?? 4100);
const state = { mode: "up", block: "", status: "404", only: [] };
const hung = new Set();

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/__proxy/set") {
      state.mode = url.searchParams.get("mode") ?? "up";
      state.block = url.searchParams.get("block") ?? "";
      state.status = url.searchParams.get("status") ?? "404";
      state.only = url.searchParams.getAll("only");
      if (state.mode === "up") for (const s of hung) s.destroy();
      if (state.mode === "up") hung.clear();
      res.end(JSON.stringify(state));
      return;
    }
    if (state.mode === "down") return void req.socket.destroy();
    if (state.mode === "hang") {
      hung.add(req.socket);
      req.socket.on("close", () => hung.delete(req.socket));
      return; // never answered
    }
    const hit = state.only.length ? state.only.some((p) => req.url?.includes(p)) : !!state.block && !!req.url?.includes(state.block);
    if (hit) {
      if (state.status === "hang") {
        hung.add(req.socket);
        req.socket.on("close", () => hung.delete(req.socket));
        return; // accepted, never answered
      }
      if (state.status === "reset") return void req.socket.destroy();
      res.writeHead(Number(state.status) || 404, { "cache-control": "no-store", "content-type": "text/plain" });
      return void res.end("blocked by test");
    }
    const up = http.request({ host: "127.0.0.1", port: TARGET, method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => res.destroy());
    req.pipe(up);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`e2e proxy on ${PORT} -> ${TARGET}`));
