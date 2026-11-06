/*
 * VOIDEX boot guard. A classic ES5 script, revalidated on every load, that runs before the app bundle.
 *
 * Contract: the app calls `window.__vxBoot.ready()` from an effect of its root component, i.e. only after React
 * has committed the first render. Until that call the page is NOT considered started — whatever is (or is not)
 * inside #root. If it does not arrive (a chunk failed, an old iPhone could not parse the bundle, React crashed
 * half-way, the network stalled) a full-screen message with «Повторить» covers the page. The message goes away
 * by itself if the app does start late.
 *
 * Loop safety: at most TWO automatic recoveries per tab session (clear the service worker + caches, reload);
 * after that only the person's tap reloads. A server error is therefore shown, never hidden by reload loops.
 * The guard never stores anything but a counter in sessionStorage and sends no personal data (see report()).
 */
(function () {
  var TRIES_KEY = "vx.bootTries";
  var WATCHDOG_MS = 12000;
  var startedAt = Date.now();
  var boot = (window.__vxBoot = window.__vxBoot || {});
  boot.ok = false;
  boot.phase = "html";
  boot.build = boot.build || null;
  var box = null;
  var shownReason = null;
  var timers = [];
  var ru = /^(ru|uk|be|kk)/i.test(navigator.language || "");

  function store(op, value) {
    try {
      if (op === "get") return window.sessionStorage.getItem(TRIES_KEY);
      if (op === "set") window.sessionStorage.setItem(TRIES_KEY, value);
      else window.sessionStorage.removeItem(TRIES_KEY);
    } catch (e) {
      /* private mode / storage blocked */
    }
    return null;
  }
  function tries() {
    var n = parseInt(store("get") || "0", 10);
    return n > 0 ? n : 0;
  }

  // One small anonymous diagnostic record: what failed, in which phase, how long after page start.
  function report(kind, reason) {
    try {
      var body = JSON.stringify({
        kind: kind,
        phase: String(boot.phase || "html").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40) || "html",
        build: boot.build ? String(boot.build).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) : undefined,
        online: navigator.onLine !== false,
        standalone: !!(window.navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)),
        sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        ms: Date.now() - startedAt,
        attempt: tries(),
        detail: String(reason || "").slice(0, 200),
      });
      if (window.fetch) {
        window.fetch("/api/client-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Voidex-Client": "web" },
          body: body,
          keepalive: true,
          credentials: "omit",
        }).catch(function () {});
      }
    } catch (e) {
      /* diagnostics must never break the guard */
    }
  }

  // Unregister service workers and drop caches (bounded wait), then call done. Best effort, never throws.
  function cleanup(done) {
    var finished = false;
    function fin() {
      if (finished) return;
      finished = true;
      done();
    }
    setTimeout(fin, 2500);
    try {
      var jobs = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(
          navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          }),
        );
      }
      if (window.caches && window.caches.keys) {
        jobs.push(
          window.caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return window.caches.delete(k); }));
          }),
        );
      }
      Promise.all(jobs).then(fin, fin);
    } catch (e) {
      fin();
    }
  }

  function retryNow() {
    store("set", String(tries() + 1));
    cleanup(function () {
      // A distinct URL (throw-away "_r" parameter, removed by the app once it starts) makes WebKit load every file
      // afresh; a plain reload() can keep serving a module script that failed before.
      try {
        var u = new URL(window.location.href);
        u.searchParams.set("_r", Date.now().toString(36));
        window.location.replace(u.toString());
      } catch (e) {
        window.location.reload();
      }
    });
  }

  function show(reason) {
    if (boot.ok || box) return;
    var body = document.body || document.documentElement;
    if (!body) return;
    shownReason = reason;
    box = document.createElement("div");
    box.setAttribute("data-testid", "boot-fallback");
    box.setAttribute("role", "alert");
    var s = box.style;
    s.position = "fixed"; s.top = "0"; s.right = "0"; s.bottom = "0"; s.left = "0"; s.zIndex = "2147483000";
    s.display = "flex"; s.flexDirection = "column"; s.alignItems = "center"; s.justifyContent = "center";
    s.padding = "32px"; s.textAlign = "center";
    s.font = "15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    s.color = "#1d1d1f"; s.background = "#ececed";
    var title = document.createElement("div");
    title.textContent = ru ? "Не удалось загрузить VOIDEX" : "VOIDEX couldn't load";
    title.style.fontWeight = "600";
    title.style.marginBottom = "10px";
    var hint = document.createElement("div");
    hint.textContent = ru
      ? "Проверьте подключение к интернету и повторите. Ваши данные в безопасности."
      : "Check your connection and try again. Your data is safe.";
    hint.style.color = "#6e6e73"; hint.style.fontSize = "13px"; hint.style.marginBottom = "18px"; hint.style.maxWidth = "320px";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-testid", "boot-retry");
    btn.textContent = ru ? "Повторить" : "Try again";
    var b = btn.style;
    b.border = "0"; b.borderRadius = "14px"; b.padding = "10px 20px"; b.font = "inherit"; b.fontWeight = "600";
    b.background = "#6c5cff"; b.color = "#fff"; b.cursor = "pointer";
    btn.addEventListener("click", retryNow);
    var code = document.createElement("div");
    code.textContent = (ru ? "Код: " : "Code: ") + reason;
    code.style.marginTop = "22px"; code.style.fontSize = "11px"; code.style.color = "#9a9aa0";
    box.appendChild(title); box.appendChild(hint); box.appendChild(btn); box.appendChild(code);
    body.appendChild(box);
    boot.fallback = box;
    report("boot_failed", reason);
    // One automatic recovery per tab session, only for a resource that failed to load (not for a plain timeout).
    if (tries() < 1 && /^(asset|syntax|import)/.test(reason)) setTimeout(retryNow, 1500);
  }

  function schedule(reason, delay) {
    timers.push(setTimeout(function () { show(reason); }, delay));
  }

  boot.mark = function (phase) {
    if (!boot.ok) boot.phase = phase;
  };

  // The app itself reports an unrecoverable start-up error (React root crashed before it could show anything).
  boot.fail = function (reason) {
    if (!boot.ok) show(String(reason || "react").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40) || "react");
  };

  // The one success signal. Idempotent.
  boot.ready = function () {
    if (boot.ok) return;
    boot.ok = true;
    boot.phase = "ready";
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    store("remove");
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    boot.fallback = null;
  };
  boot.dismiss = boot.ready; // name used by builds before this guard

  // A <script>/<link> of the build that failed to load (error events of elements do not bubble: capture).
  window.addEventListener(
    "error",
    function (e) {
      if (boot.ok) return;
      var t = e && e.target;
      if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK") && /\/assets\//.test(t.src || t.href || "")) {
        schedule("asset-load", 1500);
        return;
      }
      // A script error before the app started: a syntax error in an old browser, or a throw while the bundle runs.
      var file = (e && e.filename) || "";
      var msg = String((e && e.message) || "");
      if (/\/assets\//.test(file) || /SyntaxError|Unexpected token|Unexpected identifier/i.test(msg)) schedule("syntax", 2500);
    },
    true,
  );
  window.addEventListener("unhandledrejection", function (e) {
    if (boot.ok) return;
    var m = String((e && e.reason && e.reason.message) || "");
    if (/module|import|chunk|Loading|preload/i.test(m)) schedule("import", 2000);
  });
  // Back online while the message is up: one more automatic try.
  window.addEventListener("online", function () {
    if (box && !boot.ok && tries() < 2) retryNow();
  });

  timers.push(setTimeout(function () { show("timeout"); }, WATCHDOG_MS));
})();
