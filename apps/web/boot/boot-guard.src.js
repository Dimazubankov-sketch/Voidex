/* VOIDEX boot guard: loaded async (never blocks the first paint); minified at build. The app calls __vxBoot.ready()
   after its first commit (or sets __vxBootOk first if this file arrives later). No ready within 12 s, or a failed
   /assets file: a full-screen message with «Повторить». At most 2 automatic retries per tab session. */
(function () {
  var w = window, d = document, boot = (w.__vxBoot = w.__vxBoot || {}), box = null, timers = [], K = "vx.bootTries", t0 = Date.now();
  var ru = /^(ru|uk|be|kk)/i.test(navigator.language || "");
  if (w.__vxBootOk) boot.ok = true;
  function tries() { try { return parseInt(w.sessionStorage.getItem(K) || "0", 10) || 0; } catch (e) { return 0; } }
  function report(reason) {
    try {
      var b = { kind: "boot_failed", phase: String(boot.phase || "html").replace(/[^\w.:-]/g, "").slice(0, 40) || "html",
        build: boot.build ? String(boot.build).replace(/[^\w.:-]/g, "").slice(0, 64) : undefined, online: navigator.onLine !== false,
        standalone: !!(navigator.standalone || (w.matchMedia && w.matchMedia("(display-mode: standalone)").matches)),
        sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), ms: Date.now() - t0, attempt: tries(), detail: String(reason).slice(0, 200) };
      w.fetch("/api/client-events", { method: "POST", headers: { "Content-Type": "application/json", "X-Voidex-Client": "web" }, body: JSON.stringify(b), keepalive: true, credentials: "omit" }).catch(function () {});
    } catch (e) {}
  }
  function retry() {
    try { w.sessionStorage.setItem(K, String(tries() + 1)); } catch (e) {}
    try { var u = new URL(w.location.href); u.searchParams.set("_r", Date.now().toString(36)); w.location.replace(u.toString()); } catch (e) { w.location.reload(); }
  }
  function show(reason) {
    if (boot.ok || w.__vxBootOk || box || !d.body) return;
    box = d.createElement("div");
    box.setAttribute("data-testid", "boot-fallback");
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;font:15px -apple-system,Roboto,sans-serif;background:#ececed;color:#1d1d1f";
    var h = d.createElement("div"); h.style.cssText = "font-weight:600;margin-bottom:10px";
    h.textContent = ru ? "Не удалось загрузить VOIDEX" : "VOIDEX couldn't load";
    var p = d.createElement("div"); p.style.cssText = "color:#6e6e73;font-size:13px;margin-bottom:18px;max-width:320px";
    p.textContent = ru ? "Проверьте подключение к интернету и повторите. Ваши данные в безопасности." : "Check your connection and try again. Your data is safe.";
    var b = d.createElement("button"); b.type = "button"; b.setAttribute("data-testid", "boot-retry");
    b.style.cssText = "border:0;border-radius:14px;padding:10px 20px;font:inherit;font-weight:600;background:#6c5cff;color:#fff";
    b.textContent = ru ? "Повторить" : "Try again"; b.onclick = retry;
    var c = d.createElement("div"); c.style.cssText = "margin-top:22px;font-size:11px;color:#9a9aa0"; c.textContent = (ru ? "Код: " : "Code: ") + reason;
    box.appendChild(h); box.appendChild(p); box.appendChild(b); box.appendChild(c); d.body.appendChild(box);
    report(reason);
    if (tries() < 1 && /^(asset|syntax|import)/.test(reason)) setTimeout(retry, 1500);
  }
  function later(r, ms) { timers.push(setTimeout(function () { show(r); }, ms)); }
  boot.mark = function (p) { if (!boot.ok) boot.phase = p; };
  boot.fail = function (r) { if (!boot.ok) show(String(r || "react").replace(/[^\w.:-]/g, "").slice(0, 40) || "react"); };
  boot.ready = function () {
    if (boot.ok && !box) return;
    boot.ok = true; boot.phase = "ready";
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    try { w.sessionStorage.removeItem(K); } catch (e) {}
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
  };
  boot.dismiss = boot.ready;
  w.addEventListener("error", function (e) {
    if (boot.ok || w.__vxBootOk) return;
    var t = e && e.target, f = (e && e.filename) || "", m = String((e && e.message) || "");
    if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK") && /\/assets\//.test(t.src || t.href || "")) later("asset-load", 1500);
    else if (/\/assets\//.test(f) || /SyntaxError|Unexpected (token|identifier)/i.test(m)) later("syntax", 2500);
  }, true);
  w.addEventListener("unhandledrejection", function (e) {
    if (!boot.ok && /module|import|chunk|Loading|preload/i.test(String((e && e.reason && e.reason.message) || ""))) later("import", 2000);
  });
  w.addEventListener("online", function () { if (box && !boot.ok && tries() < 2) retry(); });
  if (boot.ok) return;
  later("timeout", 12000);
})();
