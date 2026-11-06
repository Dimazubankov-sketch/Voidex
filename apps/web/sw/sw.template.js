/*
 * VOIDEX service worker — build __VOIDEX_BUILD__ (the placeholder is replaced at build time, so every release
 * ships a byte-different sw.js and browsers install it).
 *
 * What it is for
 *   1. A home-screen launch without a working connection opens the app shell (which then says «Нет связи»)
 *      instead of a blank window.
 *   2. The hashed files (/assets/*) of the last few builds stay available, so a page that is still running an
 *      older build never meets a missing chunk while a new release is rolling out.
 *
 * What it deliberately does NOT do
 *   - It never touches /api/* , non-GET requests, range requests or other origins.
 *   - It never serves an old page when the network works: navigations are network-first (4 s), the cache is the
 *     fallback for a failed / slow / 5xx response only. So "normal open = newest index.html" still holds.
 *   - It never reloads a page by itself. skipWaiting/claim only switch which worker answers fetches; the page
 *     decides when to reload (lib/app-update.tsx), after saving.
 * Kill switch: opening /?nosw (or the boot guard's «Повторить») unregisters it and clears its caches.
 */
"use strict";

var BUILD = "__VOIDEX_BUILD__";
var SHELL = "vx-shell-v1"; // "/" → the newest index.html
var FILES = "vx-files-v1"; // /assets/* of recent builds + /brand/*
var META = "vx-meta-v1"; // which build uses which /assets file (so old ones can be dropped, new ones kept)
var KEEP_BUILDS = 4;
var NAV_TIMEOUT_MS = 4000;
var BRAND_MAX_BYTES = 1500000;

function isHtml(res) {
  return res && res.ok && res.type === "basic" && /text\/html/i.test(res.headers.get("content-type") || "");
}

// ---- bookkeeping: which /assets files belong to which build ---------------------------------------------------
function readMeta() {
  return caches.open(META).then(function (c) {
    return c.match("/meta").then(function (r) {
      return r ? r.json().catch(function () { return { builds: [] }; }) : { builds: [] };
    });
  });
}
function writeMeta(meta) {
  return caches.open(META).then(function (c) {
    return c.put("/meta", new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
  });
}
function noteFiles(paths) {
  return readMeta().then(function (meta) {
    var entry = null;
    for (var i = 0; i < meta.builds.length; i++) if (meta.builds[i].id === BUILD) entry = meta.builds[i];
    if (!entry) {
      entry = { id: BUILD, files: [] };
      meta.builds.push(entry);
    }
    for (var j = 0; j < paths.length; j++) if (entry.files.indexOf(paths[j]) < 0) entry.files.push(paths[j]);
    return writeMeta(meta);
  });
}
function prune() {
  return readMeta().then(function (meta) {
    // Current build goes last (= newest); keep the newest KEEP_BUILDS.
    var cur = meta.builds.filter(function (b) { return b.id === BUILD; });
    var rest = meta.builds.filter(function (b) { return b.id !== BUILD; });
    meta.builds = rest.concat(cur).slice(-KEEP_BUILDS);
    var keep = {};
    meta.builds.forEach(function (b) { b.files.forEach(function (f) { keep[f] = true; }); });
    return writeMeta(meta).then(function () {
      return caches.open(FILES).then(function (c) {
        return c.keys().then(function (reqs) {
          return Promise.all(
            reqs.map(function (r) {
              var p = new URL(r.url).pathname;
              if (p.indexOf("/assets/") === 0 && !keep[p]) return c.delete(r);
              return null;
            }),
          );
        });
      });
    });
  });
}

// ---- storing -----------------------------------------------------------------------------------------------
function assetPathsOf(html) {
  var out = [];
  var re = /(?:src|href)="(\/assets\/[^"?#]+)"/g;
  var m;
  while ((m = re.exec(html))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}
function storeAsset(path, res) {
  return caches.open(FILES).then(function (c) {
    return c.put(path, res);
  });
}
function cacheAssetsOf(htmlRes) {
  return htmlRes.text().then(function (html) {
    var paths = assetPathsOf(html);
    return Promise.all(
      paths.map(function (p) {
        return caches.open(FILES).then(function (c) {
          return c.match(p).then(function (hit) {
            if (hit) return null;
            return fetch(p).then(function (r) {
              if (r.ok && !/text\/html/i.test(r.headers.get("content-type") || "")) return storeAsset(p, r);
              return null;
            });
          });
        });
      }),
    ).then(function () { return noteFiles(paths); });
  });
}
// Files the page needs before anything can run (boot-guard.js is a blocking script in <head>): they must be in the
// cache, or a stalled network would leave the page blank while it waits for them.
var CORE = ["/boot-guard.js", "/manifest.webmanifest"];
function cacheCore() {
  return caches.open(FILES).then(function (c) {
    return Promise.all(
      CORE.map(function (p) {
        return fetch(p, { cache: "reload" }).then(function (r) { return r.ok ? c.put(p, r) : null; }).catch(function () {});
      }),
    );
  });
}
function storeShell(res) {
  var forShell = res.clone();
  var forAssets = res.clone();
  return caches.open(SHELL).then(function (c) { return c.put("/", forShell); }).then(function () { return Promise.all([cacheAssetsOf(forAssets), cacheCore()]); });
}

// ---- lifecycle ---------------------------------------------------------------------------------------------
self.addEventListener("install", function (event) {
  event.waitUntil(
    fetch("/", { cache: "reload", credentials: "omit" })
      .then(function (res) { return isHtml(res) ? storeShell(res) : null; })
      .catch(function () { /* offline install: still take over, the shell is cached by the first navigation */ })
      .then(function () { return self.skipWaiting(); }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    prune()
      .catch(function () {})
      .then(function () { return self.clients.claim(); })
      .then(function () { return self.clients.matchAll({ type: "window" }); })
      .then(function (clients) {
        clients.forEach(function (c) { c.postMessage({ type: "sw-activated", build: BUILD }); });
      }),
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "get-build" && event.source) event.source.postMessage({ type: "sw-build", build: BUILD });
});

// ---- fetching ----------------------------------------------------------------------------------------------
function offlinePage() {
  var html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>VOIDEX</title>" +
    '<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;' +
    'font:15px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#ececed;color:#1d1d1f">' +
    '<div style="padding:32px"><div style="font-weight:600;margin-bottom:8px">Нет связи с VOIDEX · No connection to VOIDEX</div>' +
    '<div style="color:#6e6e73;font-size:13px;margin-bottom:18px">Проверьте интернет и повторите. · Check your connection and try again.</div>' +
    '<a href="/" style="display:inline-block;background:#6c5cff;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:14px">Повторить · Retry</a></div>';
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function navigate(event) {
  var req = event.request;
  var netP = fetch(req);
  // Whatever the network eventually answers is remembered for the next time it is slow or down.
  event.waitUntil(
    netP.then(function (res) { return isHtml(res) ? storeShell(res.clone()) : null; }).catch(function () {}),
  );
  var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error("slow")); }, NAV_TIMEOUT_MS); });
  return Promise.race([netP, timeout]).then(
    function (res) {
      if (res.status >= 500) return fromShell().then(function (hit) { return hit || res; });
      return res;
    },
    function () {
      return fromShell().then(function (hit) {
        if (hit) return hit;
        // Nothing cached yet (first visit): wait for the network for real; if that fails too, a plain message.
        return netP.catch(function () { return offlinePage(); });
      });
    },
  );
}
function fromShell() {
  return caches.open(SHELL).then(function (c) { return c.match("/"); });
}

function assetFirst(req) {
  var path = new URL(req.url).pathname;
  return caches.open(FILES).then(function (c) {
    return c.match(path).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(
        function (res) {
          if (res.ok && res.type === "basic" && !/text\/html/i.test(res.headers.get("content-type") || "")) {
            var copy = res.clone();
            storeAsset(path, copy).then(function () { return noteFiles([path]); }).catch(function () {});
          }
          return res;
        },
        function () { return new Response("", { status: 503, statusText: "offline" }); },
      );
    });
  });
}

function networkFirst(req, ms) {
  var netP = fetch(req);
  var path = new URL(req.url).pathname;
  netP.then(function (res) {
    if (res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(FILES).then(function (c) { return c.put(path, copy); }).catch(function () {});
    }
  }).catch(function () {});
  var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error("slow")); }, ms); });
  return Promise.race([netP, timeout]).catch(function () {
    // Never wait on a stalled network for these: boot-guard.js blocks the parser. No copy yet = fail fast (504).
    return caches.open(FILES).then(function (c) { return c.match(path); }).then(function (hit) {
      return hit || new Response("", { status: 504, statusText: "stalled" });
    });
  });
}

function brandSwr(req) {
  var path = new URL(req.url).pathname;
  return caches.open(FILES).then(function (c) {
    return c.match(path).then(function (hit) {
      var net = fetch(req).then(function (res) {
        var len = parseInt(res.headers.get("content-length") || "0", 10);
        if (res.ok && res.type === "basic" && len <= BRAND_MAX_BYTES) c.put(path, res.clone()).catch(function () {});
        return res;
      });
      return hit || net;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var p = url.pathname;
  if (p.indexOf("/api/") === 0 || p === "/sw.js" || p === "/version.json") return;
  if (req.mode === "navigate") return event.respondWith(navigate(event));
  if (p.indexOf("/assets/") === 0) return event.respondWith(assetFirst(req));
  if (p === "/boot-guard.js" || p === "/manifest.webmanifest") return event.respondWith(networkFirst(req, 3000));
  if (p.indexOf("/brand/") === 0) return event.respondWith(brandSwr(req));
});
