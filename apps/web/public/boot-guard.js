/*
 * VOIDEX boot guard (A1). A classic script, revalidated on every load, that runs before the app bundle.
 * If the bundle never starts (a chunk failed to download, an old iPhone could not parse it, the network
 * dropped) the page would stay empty. Instead, after a failure or a long wait, it shows a short message
 * with «Обновить». It never reloads by itself, so a server error is shown, not hidden by reload loops.
 */
(function () {
  var boot = (window.__vxBoot = window.__vxBoot || { ok: false });
  var shown = false;
  var ru = /^(ru|uk|be|kk)/i.test(navigator.language || "");
  function show() {
    if (boot.ok || shown) return;
    var root = document.getElementById("root");
    if (!root || root.childElementCount > 0) return;
    shown = true;
    var box = document.createElement("div");
    var s = box.style;
    s.position = "fixed"; s.inset = "0"; s.display = "flex"; s.flexDirection = "column"; s.alignItems = "center";
    s.justifyContent = "center"; s.gap = "14px"; s.padding = "32px"; s.textAlign = "center";
    s.font = "15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; s.color = "#1d1d1f"; s.background = "#ececed";
    var title = document.createElement("div");
    title.textContent = ru ? "Не удалось загрузить VOIDEX" : "VOIDEX couldn't load";
    title.style.fontWeight = "600";
    var hint = document.createElement("div");
    hint.textContent = ru ? "Проверьте подключение к интернету и обновите страницу." : "Check your connection and reload the page.";
    hint.style.color = "#6e6e73"; hint.style.fontSize = "13px";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = ru ? "Обновить" : "Reload";
    var b = btn.style;
    b.border = "0"; b.borderRadius = "14px"; b.padding = "10px 18px"; b.font = "inherit"; b.fontWeight = "600";
    b.background = "#6c5cff"; b.color = "#fff"; b.cursor = "pointer";
    btn.addEventListener("click", function () { window.location.reload(); });
    box.appendChild(title); box.appendChild(hint); box.appendChild(btn);
    document.body.appendChild(box);
    boot.fallback = box;
  }
  boot.dismiss = function () {
    boot.ok = true;
    if (boot.fallback && boot.fallback.parentNode) boot.fallback.parentNode.removeChild(boot.fallback);
  };
  // A <script>/<link> of the build that failed to load (error events of elements do not bubble: capture).
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK") && /\/assets\//.test(t.src || t.href || "")) setTimeout(show, 1500);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var m = String((e && e.reason && e.reason.message) || "");
    if (/module|import/i.test(m)) setTimeout(show, 1500);
  });
  setTimeout(show, 20000);
})();
