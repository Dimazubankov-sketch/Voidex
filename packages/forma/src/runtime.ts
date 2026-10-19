import { COMPONENTS } from "./components.js";
import { validateAgainst, type ContractIssue } from "./backend.js";
import { findElement, findScreen, startScreen } from "./project.js";
import type { Action, Binding, ElementNode, EventName, Operation, Project } from "./types.js";

/**
 * The Forma runtime: one pure state machine for the editor's preview and for
 * a published app. The host (React) draws the state and performs the effects
 * (sounds, toasts, backend calls); the rules live here, so a press does the
 * same thing everywhere.
 */

export interface TimerState {
  running: boolean;
  /** Time counted before `startedAt` (ms). */
  elapsedMs: number;
  startedAt: number | null;
}

export interface RuntimeState {
  screenId: string;
  history: string[];
  /** Current value per element (inputs, toggles, texts changed by actions or results). */
  values: Record<string, unknown>;
  dialogs: string[];
  timers: Record<string, TimerState>;
  /** Bindings waiting for the backend. */
  pending: Record<string, true>;
  drawer: boolean;
}

export type Effect =
  | { type: "sound"; resourceId: string }
  | { type: "toast"; text: string; tone: "info" | "error" }
  | { type: "call"; binding: Binding; operation: Operation | null; input: Record<string, unknown>; issues: ContractIssue[] };

export interface Step {
  state: RuntimeState;
  effects: Effect[];
}

export type CallResult = { ok: true; output: Record<string, unknown> } | { ok: false; code: string; message: string };

const MAX_DEPTH = 4;

export function initRuntime(p: Project): Step {
  const start = startScreen(p);
  const state: RuntimeState = { screenId: start.id, history: [], values: {}, dialogs: [], timers: {}, pending: {}, drawer: false };
  const effects: Effect[] = [];
  runActions(p, state, start.events.open ?? [], effects, 0, 0);
  return { state, effects };
}

/** The value an element shows now: set at runtime, else its design-time prop. */
export function valueOf(p: Project, state: RuntimeState, el: ElementNode): unknown {
  if (el.id in state.values) return state.values[el.id];
  const prop = COMPONENTS[el.type].value.prop;
  return prop ? el.props[prop] : undefined;
}

/** Remaining (timer) or elapsed (stopwatch) milliseconds at `now`. */
export function timerMs(el: ElementNode, t: TimerState | undefined, now: number): number {
  const elapsed = (t?.elapsedMs ?? 0) + (t?.running && t.startedAt !== null ? now - t.startedAt : 0);
  if (el.type === "timer") return Math.max(0, Number(el.props.seconds) * 1000 - elapsed);
  return elapsed;
}

/** The trigger of a running backend call is disabled while it waits (when the binding says so). */
export function isBusy(p: Project, state: RuntimeState, elementId: string): boolean {
  return p.bindings.some((b) => state.pending[b.id] && b.elementId === elementId && b.loading.disable);
}

export function busyText(p: Project, state: RuntimeState, elementId: string): string | null {
  const b = p.bindings.find((x) => state.pending[x.id] && x.elementId === elementId && x.loading.text);
  return b ? b.loading.text : null;
}

function clone(s: RuntimeState): RuntimeState {
  return { ...s, history: [...s.history], values: { ...s.values }, dialogs: [...s.dialogs], timers: { ...s.timers }, pending: { ...s.pending } };
}

function coerce(el: ElementNode, value: unknown): unknown {
  const kind = COMPONENTS[el.type].value.kind;
  if (kind === "boolean") return value === true || value === "true" || value === 1;
  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return typeof value === "string" ? value : String(value ?? "");
}

function goTo(p: Project, s: RuntimeState, screenId: string, effects: Effect[], depth: number, now: number, back = false) {
  const target = findScreen(p, screenId);
  if (!target || target.id === s.screenId) return;
  if (!back) s.history.push(s.screenId);
  s.screenId = target.id;
  s.dialogs = [];
  s.drawer = false;
  runActions(p, s, target.events.open ?? [], effects, depth + 1, now);
}

function runActions(p: Project, s: RuntimeState, actions: Action[], effects: Effect[], depth: number, now: number) {
  if (depth > MAX_DEPTH) return;
  for (const a of actions) {
    switch (a.type) {
      case "navigate":
        goTo(p, s, a.screenId, effects, depth, now);
        break;
      case "back": {
        const prev = s.history.pop() ?? startScreen(p).id;
        goTo(p, s, prev, effects, depth, now, true);
        break;
      }
      case "playSound":
        if (p.frontend.resources.some((r) => r.id === a.resourceId)) effects.push({ type: "sound", resourceId: a.resourceId });
        break;
      case "setValue": {
        const t = findElement(p, a.targetId);
        if (t) s.values[t.id] = coerce(t, a.value);
        break;
      }
      case "toggleValue": {
        const t = findElement(p, a.targetId);
        if (t && COMPONENTS[t.type].value.kind === "boolean") s.values[t.id] = !valueOf(p, s, t);
        break;
      }
      case "openDialog":
        if (findElement(p, a.targetId)?.type === "dialog" && !s.dialogs.includes(a.targetId)) s.dialogs.push(a.targetId);
        break;
      case "closeDialog":
        s.dialogs = s.dialogs.filter((d) => d !== a.targetId);
        break;
      case "showToast":
        effects.push({ type: "toast", text: a.text, tone: "info" });
        break;
      case "timer": {
        const t = findElement(p, a.targetId);
        if (!t || (t.type !== "timer" && t.type !== "stopwatch")) break;
        s.timers[t.id] = timerCommand(t, s.timers[t.id], a.command, now);
        break;
      }
    }
  }
}

export function timerCommand(el: ElementNode, t: TimerState | undefined, command: "start" | "pause" | "reset", now: number): TimerState {
  const cur = t ?? { running: false, elapsedMs: 0, startedAt: null };
  if (command === "reset") return { running: false, elapsedMs: 0, startedAt: null };
  if (command === "start") {
    if (cur.running) return cur;
    // A finished timer starts over.
    const finished = el.type === "timer" && timerMs(el, cur, now) <= 0;
    return { running: true, elapsedMs: finished ? 0 : cur.elapsedMs, startedAt: now };
  }
  if (!cur.running) return cur;
  return { running: false, elapsedMs: cur.elapsedMs + (cur.startedAt === null ? 0 : now - cur.startedAt), startedAt: null };
}

export interface RuntimeEvent {
  elementId: string;
  event: EventName;
  /** New value for change events; item index for itemPress. */
  value?: unknown;
  index?: number;
}

/** A component event: its visual actions in order, then its backend bindings. */
export function dispatch(p: Project, state: RuntimeState, ev: RuntimeEvent, now = Date.now()): Step {
  const s = clone(state);
  const effects: Effect[] = [];
  const el = findElement(p, ev.elementId);
  if (!el) return { state: s, effects };
  if (isBusy(p, s, el.id)) return { state: s, effects };
  if (ev.event === "change" && ev.value !== undefined) s.values[el.id] = coerce(el, ev.value);
  if (ev.event === "itemPress" && typeof ev.index === "number") s.values[el.id] = ev.index;
  if (el.type === "dialog" && (ev.event === "confirm" || ev.event === "cancel")) s.dialogs = s.dialogs.filter((d) => d !== el.id);
  runActions(p, s, el.events[ev.event] ?? [], effects, 0, now);
  for (const b of p.bindings) {
    if (b.elementId !== el.id || b.event !== ev.event || s.pending[b.id]) continue;
    const operation = p.backend.operations.find((o) => o.name === b.operation) ?? null;
    const input = buildInput(p, s, b);
    const issues = operation ? validateAgainst(operation.input, input) : [];
    s.pending[b.id] = true;
    effects.push({ type: "call", binding: b, operation, input, issues });
  }
  return { state: s, effects };
}

/** Builds the request of a binding from the current values of the interface. */
export function buildInput(p: Project, s: RuntimeState, b: Binding): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, src] of Object.entries(b.input)) {
    if (src.from === "const") out[field] = src.value;
    else {
      const el = findElement(p, src.elementId);
      if (el) out[field] = valueOf(p, s, el);
    }
  }
  return out;
}

/** The backend answered (or the host could not call it): show the result or the error. */
export function completeCall(p: Project, state: RuntimeState, bindingId: string, result: CallResult, now = Date.now()): Step {
  const s = clone(state);
  const effects: Effect[] = [];
  delete s.pending[bindingId];
  const b = p.bindings.find((x) => x.id === bindingId);
  if (!b) return { state: s, effects };
  if (result.ok) {
    if (b.errorTargetId && findElement(p, b.errorTargetId)) s.values[b.errorTargetId] = "";
    if (b.output) {
      const t = findElement(p, b.output.targetId);
      if (t && b.output.field in result.output) s.values[t.id] = coerce(t, result.output[b.output.field]);
    }
    runActions(p, s, b.onSuccess, effects, 0, now);
  } else {
    const t = b.errorTargetId ? findElement(p, b.errorTargetId) : undefined;
    if (t) s.values[t.id] = coerce(t, result.message);
    else effects.push({ type: "toast", text: result.message, tone: "error" });
    runActions(p, s, b.onError, effects, 0, now);
  }
  return { state: s, effects };
}

/** Advances timers: a timer that reaches zero stops and fires its finish event. */
export function tick(p: Project, state: RuntimeState, now = Date.now()): Step {
  let s = state;
  const effects: Effect[] = [];
  for (const [elId, t] of Object.entries(state.timers)) {
    if (!t.running) continue;
    const el = findElement(p, elId);
    if (!el || el.type !== "timer" || timerMs(el, t, now) > 0) continue;
    if (s === state) s = clone(state);
    s.timers[elId] = { running: false, elapsedMs: Number(el.props.seconds) * 1000, startedAt: null };
    const step = dispatch(p, s, { elementId: elId, event: "finish" }, now);
    s = step.state;
    effects.push(...step.effects);
  }
  return { state: s, effects };
}

/** Built-in navigation (menu items, back button, drawer): not configured actions, part of the component. */
export function navigate(p: Project, state: RuntimeState, target: string | "back", now = Date.now()): Step {
  const s = clone(state);
  const effects: Effect[] = [];
  runActions(p, s, [target === "back" ? { id: "nav", type: "back" } : { id: "nav", type: "navigate", screenId: target }], effects, 0, now);
  s.drawer = false;
  return { state: s, effects };
}

export function setDrawer(state: RuntimeState, open: boolean): RuntimeState {
  return { ...clone(state), drawer: open };
}
