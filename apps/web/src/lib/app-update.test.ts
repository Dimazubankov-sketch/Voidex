import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, blocker, parseVersion, registerUpdateSaver, startUpdateChecks, tryApplyAutomatically, useAppUpdate } from "./app-update";
import { beginCriticalOperation } from "./critical-ops";

const reload = vi.fn();
beforeEach(() => {
  reload.mockReset();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true, writable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  sessionStorage.clear();
  document.body.innerHTML = "";
  useAppUpdate.setState({ available: null, stalled: false, dismissed: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("version.json parsing", () => {
  it("accepts a build id and rejects anything else (error pages, proxies)", () => {
    expect(parseVersion({ build: "abc123" })).toBe("abc123");
    expect(parseVersion({ build: "" })).toBeNull();
    expect(parseVersion({ build: 12 })).toBeNull();
    expect(parseVersion("<html>")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion({ build: "x".repeat(300) })).toBeNull();
  });
});

describe("what blocks an automatic update", () => {
  it("nothing blocks an idle page", () => expect(blocker()).toBeNull());
  it("a running save/send/upload blocks it until it ends", () => {
    const done = beginCriticalOperation();
    expect(blocker()).toBe("busy");
    done();
    expect(blocker()).toBeNull();
  });
  it("half-typed text in a field blocks it; an empty field does not", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(blocker()).toBeNull();
    input.value = "draft";
    expect(blocker()).toBe("typing");
    input.value = "";
    expect(blocker()).toBeNull();
  });
  it("text in a focused textarea / contenteditable blocks it", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    ta.value = "a note";
    expect(blocker()).toBe("typing");
  });
  it("no connection blocks it (nothing to load)", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(blocker()).toBe("offline");
  });
});

describe("applying an update automatically", () => {
  it("does nothing when no newer build is known", async () => {
    expect(await tryApplyAutomatically("return")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("returning to the app reloads once, after savers ran", async () => {
    useAppUpdate.setState({ available: "build-2" });
    const saved = vi.fn(async () => true);
    const off = registerUpdateSaver(saved);
    expect(await tryApplyAutomatically("return")).toBe(true);
    expect(saved).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("vx.reloadedFor")).toBe("build-2");
    off();
  });

  it("never reloads twice for the same build (no reload loop even if the server keeps serving the old one)", async () => {
    useAppUpdate.setState({ available: "build-2" });
    expect(await tryApplyAutomatically("return")).toBe(true);
    expect(await tryApplyAutomatically("return")).toBe(false);
    expect(await tryApplyAutomatically("hidden")).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a saver that fails (unsaved work) cancels the reload", async () => {
    useAppUpdate.setState({ available: "build-3" });
    const off = registerUpdateSaver(async () => false);
    expect(await tryApplyAutomatically("return")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("vx.reloadedFor")).toBeNull();
    off();
  });

  it("a saver that throws also cancels it", async () => {
    useAppUpdate.setState({ available: "build-3" });
    const off = registerUpdateSaver(async () => { throw new Error("disk full"); });
    expect(await tryApplyAutomatically("hidden")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    off();
  });

  it("waits while an operation is running, then goes", async () => {
    useAppUpdate.setState({ available: "build-4" });
    const done = beginCriticalOperation();
    expect(await tryApplyAutomatically("return")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    done();
    expect(await tryApplyAutomatically("return")).toBe(true);
  });

  it("while the person is actively using the app only an idle moment (or leaving / returning) applies it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ build: "unit-build-1" }), { headers: { "content-type": "application/json" } })));
    startUpdateChecks(); // attaches the input listeners
    await vi.advanceTimersByTimeAsync(40_000); // past the "just started" window
    useAppUpdate.setState({ available: "build-5" });
    window.dispatchEvent(new Event("pointerdown")); // the person taps
    expect(await tryApplyAutomatically("idle")).toBe(false);
    expect(await tryApplyAutomatically("idle-ops")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled(); // 60 s of quiet is still not enough
    await vi.advanceTimersByTimeAsync(60_000); // the page's own idle timer finds 2 min of quiet and applies it
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("leaving the app applies it even right after the last tap", async () => {
    useAppUpdate.setState({ available: "build-7" });
    window.dispatchEvent(new Event("pointerdown"));
    expect(await tryApplyAutomatically("hidden")).toBe(true);
  });

  it("the manual path (applyUpdate) also saves first and refuses on failure", async () => {
    useAppUpdate.setState({ available: "build-6" });
    const off = registerUpdateSaver(async () => false);
    expect(await applyUpdate()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    off();
    expect(await applyUpdate()).toBe(true);
  });
});
