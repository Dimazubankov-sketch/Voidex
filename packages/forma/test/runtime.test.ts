import { describe, expect, it } from "vitest";
import {
  applyBackendCommands,
  applyCommands,
  completeCall,
  createProject,
  dispatch,
  initRuntime,
  isBusy,
  navigate,
  resolveLayout,
  sampleBackendCommands,
  sampleProject,
  snapRect,
  tick,
  timerMs,
  valueOf,
  findElement,
  type Layout,
  type Project,
} from "../src/index.js";

function demo(): Project {
  const fe = sampleProject();
  return applyBackendCommands(fe, sampleBackendCommands(fe), "agent");
}
const el = (p: Project, name: string) => p.frontend.screens.flatMap((s) => s.elements).find((e) => e.name === name)!;

describe("runtime", () => {
  it("starts on the start screen and follows the bottom menu and back", () => {
    const p = demo();
    let { state } = initRuntime(p);
    expect(state.screenId).toBe(p.frontend.screens[0]!.id);
    state = navigate(p, state, p.frontend.screens[1]!.id).state;
    expect(state.screenId).toBe(p.frontend.screens[1]!.id);
    state = navigate(p, state, "back").state;
    expect(state.screenId).toBe(p.frontend.screens[0]!.id);
    expect(state.history).toEqual([]);
  });

  it("a press calls the bound operation with the form values; no answer is invented", () => {
    const p = demo();
    let { state } = initRuntime(p);
    const name = el(p, "Имя");
    const button = el(p, "Поздороваться");
    state = dispatch(p, state, { elementId: name.id, event: "change", value: "Анна" }).state;
    const step = dispatch(p, state, { elementId: button.id, event: "press" });
    const call = step.effects.find((e) => e.type === "call");
    expect(call).toMatchObject({ type: "call", input: { name: "Анна" }, issues: [] });
    expect(isBusy(p, step.state, button.id)).toBe(true);
    // A second press while waiting does nothing.
    expect(dispatch(p, step.state, { elementId: button.id, event: "press" }).effects).toEqual([]);
    const ok = completeCall(p, step.state, p.bindings[0]!.id, { ok: true, output: { message: "Привет, Анна!" } });
    expect(valueOf(p, ok.state, el(p, "Ответ сервера"))).toBe("Привет, Анна!");
    expect(isBusy(p, ok.state, button.id)).toBe(false);
    const fail = completeCall(p, step.state, p.bindings[0]!.id, { ok: false, code: "backend_unavailable", message: "Backend не запущен" });
    expect(valueOf(p, fail.state, el(p, "Ответ сервера"))).toBe("Backend не запущен");
  });

  it("contract issues are reported before any call", () => {
    const p = demo();
    const { state } = initRuntime(p);
    const step = dispatch(p, state, { elementId: el(p, "Поздороваться").id, event: "press" });
    const call = step.effects.find((e) => e.type === "call");
    expect(call && call.type === "call" && call.issues.map((i) => i.code)).toEqual(["required"]);
  });

  it("timer: start, pause, finish fires sound and toast once", () => {
    const p = demo();
    const timer = el(p, "Таймер");
    let state = initRuntime(p).state;
    const p2 = applyCommands(p, [{ type: "addElement", component: "button", screenId: p.frontend.screens[0]!.id }]);
    const startBtn = p2.selectedId!;
    const p3 = applyCommands(p2.project, [{ type: "setEvent", id: startBtn, event: "press", actions: [{ id: "t", type: "timer", targetId: timer.id, command: "start" }] }]).project;
    state = dispatch(p3, state, { elementId: startBtn, event: "press" }, 1000).state;
    expect(timerMs(timer, state.timers[timer.id], 4000)).toBe(7000);
    const mid = tick(p3, state, 5000);
    expect(mid.effects).toEqual([]);
    const done = tick(p3, mid.state, 11_500);
    expect(done.effects.map((e) => e.type)).toEqual(["sound", "toast"]);
    expect(done.state.timers[timer.id]!.running).toBe(false);
    expect(tick(p3, done.state, 20_000).effects).toEqual([]);
  });

  it("dialogs open by action and close on confirm; toggles flip", () => {
    let p = createProject("D");
    const sid = p.frontend.screens[0]!.id;
    const r1 = applyCommands(p, [{ type: "addElement", component: "dialog", screenId: sid }]);
    const dialog = r1.selectedId!;
    const r2 = applyCommands(r1.project, [{ type: "addElement", component: "toggle", screenId: sid }]);
    const toggle = r2.selectedId!;
    const r3 = applyCommands(r2.project, [{ type: "addElement", component: "button", screenId: sid }]);
    p = applyCommands(r3.project, [{ type: "setEvent", id: r3.selectedId!, event: "press", actions: [{ id: "o", type: "openDialog", targetId: dialog }, { id: "t", type: "toggleValue", targetId: toggle }] }]).project;
    let s = initRuntime(p).state;
    s = dispatch(p, s, { elementId: r3.selectedId!, event: "press" }).state;
    expect(s.dialogs).toEqual([dialog]);
    expect(valueOf(p, s, findElement(p, toggle)!)).toBe(false);
    s = dispatch(p, s, { elementId: dialog, event: "confirm" }).state;
    expect(s.dialogs).toEqual([]);
  });
});

describe("layout", () => {
  const design = { width: 390, height: 844 };
  const base: Layout = { x: 28, y: 100, width: 334, height: 52, h: "left", v: "top" };
  it("constraints follow a wider / taller screen", () => {
    const vp = { width: 430, height: 932 };
    expect(resolveLayout(base, design, vp)).toEqual({ x: 28, y: 100, width: 334, height: 52 });
    expect(resolveLayout({ ...base, h: "stretch" }, design, vp).width).toBe(374);
    expect(resolveLayout({ ...base, h: "right" }, design, vp).x).toBe(68);
    expect(resolveLayout({ ...base, h: "center" }, design, vp).x).toBe(48);
    expect(resolveLayout({ ...base, v: "bottom", y: 768 }, design, vp).y).toBe(856);
    expect(resolveLayout({ ...base, h: "scale" }, design, { width: 780, height: 844 })).toMatchObject({ x: 56, width: 668 });
    expect(resolveLayout({ ...base, h: "stretch", maxWidth: 340 }, design, vp)).toMatchObject({ width: 340, x: 45 });
  });
  it("snap: moves on the 8 px grid inside the frame", () => {
    expect(snapRect({ x: 0, y: 0, width: 100, height: 40 }, 13, 3, "move", design)).toEqual({ x: 16, y: 0, width: 100, height: 40 });
    expect(snapRect({ x: 300, y: 0, width: 100, height: 40 }, 200, 0, "move", design).x).toBe(290);
    expect(snapRect({ x: 0, y: 0, width: 100, height: 40 }, -200, 0, "resize", design, { width: 48, height: 24 }).width).toBe(48);
  });
});
