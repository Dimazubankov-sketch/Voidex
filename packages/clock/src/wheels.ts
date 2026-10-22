/**
 * Number drums of Voidex Clock (ported from Voidex-Clock dist/wheels.js).
 *
 * One drum = a scroll container (role="spinbutton", one tab stop) holding the
 * range three times over (count * 3 option buttons, tabindex -1), so it can
 * be scrolled past 23 → 00 and is recentred into the middle copy after every
 * settle: a cyclic range with native scroll snap and momentum. 5 rows are
 * visible (220 px = 5 * 44 px; 88 px padding above and below), the selected
 * row is opaque, its neighbours fade with the distance.
 *
 * The drum is driven by the DOM only (the React component renders the
 * markup and mounts this controller on it), so a value is committed even
 * when a snap has not finished yet (flushWheel), and a drum taken off the
 * screen ignores scroll events still queued for it (unmountWheel).
 */

export const ROW_HEIGHT = 44;
export const VISIBLE_ROWS = 5;
export const wrapValue = (value: number, count: number) => ((Math.round(value) % count) + count) % count;
/** Row index of a value in the middle copy of the range. */
export const wheelPosition = (value: number, count: number) => count + wrapValue(value, count);

/** What a drum element needs (a real HTMLElement, or a stand-in in tests). */
export interface WheelElement {
  dataset: Record<string, string | undefined>;
  scrollTop: number;
  querySelectorAll(selector: string): ArrayLike<WheelOption> | Iterable<WheelOption>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: (event: never) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener?(type: string, fn: (event: never) => void): void;
  scrollTo(options: { top: number; behavior?: ScrollBehavior | "instant" }): void;
  setPointerCapture?(id: number): void;
}
export interface WheelOption {
  style: { setProperty(name: string, value: string): void; visibility?: string };
  classList: { toggle(name: string, on?: boolean): unknown };
}
export interface WheelRoot {
  querySelectorAll(selector: string): ArrayLike<WheelElement> | Iterable<WheelElement>;
}
export type WheelChange = (key: string, value: number) => void;

interface WheelState {
  count: number;
  value: number;
  change: WheelChange;
  active: boolean;
  options: WheelOption[];
  visible: Set<number>;
  touching: boolean;
  target: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: [string, (event: never) => void][];
  /** Step 2.15: a finger / mouse dragging the drum itself (no native scroll), its recent positions. */
  drag: { id: number; y: number; top: number; moved: boolean; samples: { y: number; t: number }[] } | null;
  /** The momentum spin after a flick (animation frame id). */
  spin: number | null;
  /** Mouse-wheel travel not yet turned into steps. */
  wheelAcc: number;
  /** Values this drum reported that the app may still hand back (React renders a step after the drum moved on). */
  echoes: { v: number; t: number }[];
}

const wheelStates = new WeakMap<WheelElement, WheelState>();
const reduced = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const toArray = <T,>(list: ArrayLike<T> | Iterable<T>): T[] => Array.from(list as ArrayLike<T>);

/** Everything the markup of a drum needs: the spinbutton attributes and the option labels. */
export function wheelSpec(label: string, value: number, count: number, padded = true) {
  const selected = wrapValue(value, count);
  return {
    selected,
    attrs: { role: "spinbutton", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": count - 1, "aria-valuenow": selected, tabIndex: 0 },
    options: Array.from({ length: count * 3 }, (_, i) => (padded ? String(i % count).padStart(2, "0") : String(i % count))),
  };
}

function emit(el: WheelElement, state: WheelState) {
  if (!state.active) return;
  const value = wrapValue(el.scrollTop / ROW_HEIGHT, state.count);
  el.dataset.value = String(value);
  el.setAttribute("aria-valuenow", String(value));
  if (state.value !== value) {
    state.value = value;
    state.echoes.push({ v: value, t: Date.now() });
    if (state.echoes.length > 8) state.echoes.shift();
    state.change(el.dataset.wheel ?? "", value);
  }
}

function decorate(el: WheelElement, state: WheelState) {
  if (!state.active) return;
  const center = el.scrollTop / ROW_HEIGHT;
  const visible = new Set<number>();
  for (let i = Math.max(0, Math.floor(center) - 4); i <= Math.min(state.options.length - 1, Math.ceil(center) + 4); i++) visible.add(i);
  for (const i of new Set([...visible, ...state.visible])) {
    const option = state.options[i];
    if (!option) continue;
    const distance = Math.abs(i - center);
    if (distance > 4) {
      option.style.visibility = "hidden";
      continue;
    }
    option.style.visibility = "visible";
    option.style.setProperty("--distance", String(i - center));
    option.style.setProperty("--scale", String(1 - Math.min(3, distance) * 0.08));
    option.style.setProperty("--opacity", String(Math.max(0.08, 1 - distance * 0.28)));
    option.classList.toggle("selected", distance < 0.5);
  }
  state.visible = visible;
}

function settle(el: WheelElement, state: WheelState) {
  if (!state.active || state.touching) return;
  // A key or a tap is still on its way (a newer smooth scroll replaced the one that just ended): let it arrive.
  if (state.target !== null && Math.abs(el.scrollTop - state.target * ROW_HEIGHT) > 0.5) {
    el.scrollTo({ top: state.target * ROW_HEIGHT, behavior: reduced() ? "instant" : "smooth" });
    later(state, () => {
      if (state.target !== null) el.scrollTo({ top: state.target * ROW_HEIGHT, behavior: "instant" });
      settle(el, state);
    }, 400);
    return;
  }
  const index = Math.round(el.scrollTop / ROW_HEIGHT);
  const value = wrapValue(index, state.count);
  state.target = null;
  if (index < state.count || index >= state.count * 2) {
    el.scrollTo({ top: wheelPosition(value, state.count) * ROW_HEIGHT, behavior: "instant" });
  } else if (Math.abs(el.scrollTop - index * ROW_HEIGHT) > 0.5) {
    el.scrollTo({ top: index * ROW_HEIGHT, behavior: reduced() ? "instant" : "smooth" });
  }
  emit(el, state);
  decorate(el, state);
}

/*
 * B1 — momentum like a real drum. The release speed of the finger (px / ms, from its last ~100 ms) decides:
 *   slow (under FLING_MIN)          → no spin: the drum rests on the row nearest to where the finger left it
 *                                     (precise, one value at a time);
 *   a quick nudge of under half a row → exactly one row on (Step 2.16);
 *   otherwise                        → it glides on and slows down by itself (exponential decay with time
 *                                     constant TAU, the way iOS lists coast), landing exactly on a row: a
 *                                     medium swipe goes a few values, a fast one many (up to FLING_ROWS_MAX).
 * The glide starts at the finger's own speed, so there is no jump at the release.
 */
export const FLING_TAU = 325;
/** Release speed (px / ms) below which a drag just snaps to its row. */
export const FLING_MIN = 0.3;
/** A move shorter than this (rows) and slower than NUDGE_FAST is a nudge: one row on, never more. */
const NUDGE_ROWS = 0.5;
const NUDGE_FAST = 1.5;
/** …and a nudge of at least this much of a row is one row on (less: it stays). */
const NUDGE = 0.2;
export const FLING_ROWS_MAX = 80;

/** Duration (ms) of a glide over `distance` px that starts at `velocity` px / ms (cubic ease-out). */
export function glideDuration(distance: number, velocity: number): number {
  return Math.max(240, Math.min(1800, (3 * Math.abs(distance)) / Math.max(0.05, Math.abs(velocity))));
}

/** Finger speed at release from recent samples (px / ms, positive = finger moving up = values grow). */
export function releaseVelocity(samples: { y: number; t: number }[], now: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  // A finger held still before lifting is no flick.
  if (now - last.t > 80) return 0;
  let first = samples[0]!;
  for (const s of samples) if (last.t - s.t <= 100) {
    first = s;
    break;
  }
  const dt = Math.max(8, last.t - first.t);
  return -(last.y - first.y) / dt;
}

/**
 * Where a release ends (pure): the row to land on, from the scroll position, the release speed, how far the
 * finger moved (rows) and the row it started on. `null` = no momentum (the caller snaps).
 */
export function flingTarget(fromPx: number, velocity: number, dragRows: number, startRow: number, row = ROW_HEIGHT): { row: number; glide: boolean } {
  const here = fromPx / row;
  if (Math.abs(dragRows) < NUDGE_ROWS && Math.abs(velocity) < NUDGE_FAST) {
    if (Math.abs(dragRows) < 1) return { row: Math.abs(dragRows) >= NUDGE ? startRow + Math.sign(dragRows) : startRow, glide: false };
  }
  if (Math.abs(velocity) < FLING_MIN) return { row: Math.round(here), glide: false };
  // Only the speed above half the threshold carries the drum on: just over it is one or two rows.
  const projected = here + (Math.sign(velocity) * (Math.abs(velocity) - FLING_MIN / 2) * FLING_TAU) / row;
  let target = Math.round(projected);
  const dir = Math.sign(velocity);
  // At least the next row in the direction of the flick.
  if ((target - here) * dir < 0.5) target = dir > 0 ? Math.ceil(here + 0.5) : Math.floor(here - 0.5);
  const max = FLING_ROWS_MAX;
  if (Math.abs(target - here) > max) target = Math.round(here + dir * max);
  return { row: target, glide: true };
}

const raf = (fn: (t: number) => void): number =>
  typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame(fn) : (setTimeout(() => fn(Date.now()), 16) as unknown as number);
const cancelRaf = (id: number) => (typeof globalThis.cancelAnimationFrame === "function" ? globalThis.cancelAnimationFrame(id) : clearTimeout(id as never));

function stopSpin(state: WheelState) {
  if (state.spin !== null) cancelRaf(state.spin);
  state.spin = null;
}

/**
 * Keeps a position (and the pending target) inside the middle copy of the
 * range: a jump of exactly one copy is invisible (the same numbers), so the
 * drum never reaches the blank padding at either end, however far it turns.
 */
function recentre(el: WheelElement, state: WheelState, extra = 0) {
  const span = state.count * ROW_HEIGHT;
  const top = el.scrollTop + extra;
  let shift = 0;
  if (top < span * 0.5) shift = span;
  else if (top > span * 2.5 - ROW_HEIGHT) shift = -span;
  if (!shift) return 0;
  el.scrollTo({ top: el.scrollTop + shift, behavior: "instant" });
  if (state.target !== null) state.target += shift / ROW_HEIGHT;
  if (state.drag) state.drag.top += shift;
  return shift;
}

/** Releases the drum: a snap, a one-row nudge or a momentum glide (see flingTarget). */
function fling(el: WheelElement, state: WheelState, velocity: number, dragRows = Infinity, startRow?: number) {
  stopSpin(state);
  const plan = flingTarget(el.scrollTop, reduced() ? 0 : velocity, dragRows, startRow ?? Math.round(el.scrollTop / ROW_HEIGHT));
  if (!plan.glide) {
    state.touching = false;
    move(el, state, plan.row);
    return;
  }
  let from = el.scrollTop;
  let to = plan.row * ROW_HEIGHT;
  // A cubic ease-out whose first speed is the finger's (3 · distance / duration = release speed): it starts
  // exactly as fast as the finger left, slows down evenly and stops on the row in a finite time.
  const duration = glideDuration(to - from, velocity);
  const start = Date.now();
  state.touching = true;
  state.target = to / ROW_HEIGHT;
  const frame = () => {
    if (!state.active) return;
    const k = Math.min(1, (Date.now() - start) / duration);
    const done = k >= 1;
    const pos = done ? to : from + (to - from) * (1 - (1 - k) ** 3);
    el.scrollTo({ top: pos, behavior: "instant" });
    // Endless: keep the drum in the middle copy while it coasts (the same numbers one copy away).
    const shift = recentre(el, state);
    if (shift) {
      from += shift;
      to += shift;
    }
    emit(el, state);
    decorate(el, state);
    if (!done) {
      state.spin = raf(frame);
      return;
    }
    state.spin = null;
    state.touching = false;
    settle(el, state);
  };
  state.spin = raf(frame);
}

function later(state: WheelState, fn: () => void, ms: number) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(fn, ms);
}

/**
 * `n` rows on from where the drum is going (keys, the mouse wheel): fast
 * repeats add up. Past the middle copy the drum is moved one copy back first
 * (the same numbers), so it turns on endlessly instead of stopping at the end.
 */
function step(el: WheelElement, state: WheelState, n: number) {
  const current = state.target ?? Math.round(el.scrollTop / ROW_HEIGHT);
  let next = current + n;
  const c = state.count;
  if (next < c * 0.5 || next > c * 2.5) {
    const shift = next < c * 0.5 ? c : -c;
    el.scrollTo({ top: el.scrollTop + shift * ROW_HEIGHT, behavior: "instant" });
    next += shift;
  }
  move(el, state, next);
}

function move(el: WheelElement, state: WheelState, index: number) {
  stopSpin(state);
  state.target = index;
  el.scrollTo({ top: index * ROW_HEIGHT, behavior: reduced() ? "instant" : "smooth" });
  later(state, () => settle(el, state), 180);
}

/** Attaches the drum behaviour to one element (once). Returns its cleanup. */
export function mountWheel(el: WheelElement, onChange: WheelChange): () => void {
  if (!wheelStates.has(el)) {
    const state: WheelState = {
      count: Number(el.dataset.count),
      value: Number(el.dataset.value),
      change: onChange,
      active: true,
      options: toArray(el.querySelectorAll(".wheel-option")),
      visible: new Set(),
      touching: false,
      target: null,
      timer: null,
      listeners: [],
      drag: null,
      spin: null,
      wheelAcc: 0,
      echoes: [],
    };
    wheelStates.set(el, state);
    const on = (type: string, fn: (event: never) => void, options?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, options);
      state.listeners.push([type, fn]);
    };
    el.scrollTo({ top: wheelPosition(state.value, state.count) * ROW_HEIGHT, behavior: "instant" });
    decorate(el, state);
    on(
      "scroll",
      () => {
        if (!state.active) return;
        emit(el, state);
        decorate(el, state);
        later(state, () => settle(el, state), 140);
      },
      { passive: true },
    );
    on("scrollend", () => settle(el, state));
    /*
     * Step 2.15: the drum is turned by the pointer itself (finger or mouse),
     * not by the browser's scroll: it follows the finger 1:1, a flick spins
     * on (momentum), and it recentres on the way so it is endless both ways.
     */
    on("pointerdown", (event: { pointerId: number; clientY: number; button?: number; timeStamp?: number }) => {
      if (event.button !== undefined && event.button !== 0) return;
      stopSpin(state);
      state.touching = true;
      state.target = null;
      if (state.timer) clearTimeout(state.timer);
      state.drag = { id: event.pointerId, y: event.clientY, top: el.scrollTop, moved: false, samples: [{ y: event.clientY, t: Date.now() }] };
    });
    on("pointermove", (event: { pointerId: number; clientY: number; preventDefault?(): void }) => {
      const d = state.drag;
      if (!d || d.id !== event.pointerId) return;
      if (!d.moved) {
        if (Math.abs(event.clientY - d.y) < 4) return;
        d.moved = true;
        // Only a real drag takes the pointer (a tap on a row stays a click on that row).
        try {
          el.setPointerCapture?.(event.pointerId);
        } catch {
          /* a synthetic pointer */
        }
      }
      el.scrollTo({ top: d.top - (event.clientY - d.y), behavior: "instant" });
      recentre(el, state);
      const now = Date.now();
      d.samples.push({ y: event.clientY, t: now });
      while (d.samples.length > 2 && now - d.samples[0]!.t > 140) d.samples.shift();
    });
    const release = (event?: { pointerId?: number; type?: string }) => {
      const d = state.drag;
      if (d && event?.pointerId !== undefined && d.id !== event.pointerId) return;
      state.drag = null;
      if (!d || !d.moved) {
        state.touching = false;
        later(state, () => settle(el, state), 180);
        return;
      }
      const velocity = event?.type !== "pointercancel" ? releaseVelocity(d.samples, Date.now()) : 0;
      // How far the finger took the drum (rows) and the row it started on (recentring moves both alike).
      const dragRows = (el.scrollTop - d.top) / ROW_HEIGHT;
      fling(el, state, velocity, dragRows, Math.round(d.top / ROW_HEIGHT));
    };
    on("pointerup", release);
    on("pointercancel", release);
    // B1: on touch screens the pressed option button holds the pointer first (implicit capture); its "lost
    // capture" when the drum takes the pointer bubbles up here and must not end the drag (it froze the drum).
    on("lostpointercapture", (event: { pointerId: number; target?: unknown }) => {
      if (event.target !== undefined && event.target !== el) return;
      if (state.drag) release(event);
    });
    // PC: the mouse wheel turns the drum row by row (a notch = one step; a trackpad adds up).
    on(
      "wheel",
      (event: { deltaY: number; deltaMode?: number; preventDefault(): void }) => {
        event.preventDefault();
        const px = event.deltaY * (event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? ROW_HEIGHT * 5 : 1);
        let steps: number;
        if (Math.abs(px) >= 50) {
          // A mouse notch: exactly one step.
          steps = Math.sign(px);
          state.wheelAcc = 0;
        } else {
          state.wheelAcc += px;
          steps = Math.trunc(state.wheelAcc / ROW_HEIGHT);
          state.wheelAcc -= steps * ROW_HEIGHT;
        }
        if (!steps) return;
        step(el, state, steps);
      },
      { passive: false },
    );
    on("click", (event: { target?: { closest?: (s: string) => { dataset: Record<string, string | undefined> } | null } }) => {
      const option = event.target?.closest?.("[data-wheel-option]");
      if (option) move(el, state, Number(option.dataset.wheelOption));
    });
    on("keydown", (event: { key: string; preventDefault(): void }) => {
      // Keys pressed faster than the smooth snap step on from where the drum is going, not where it is.
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        move(el, state, wheelPosition(event.key === "Home" ? 0 : state.count - 1, state.count));
        return;
      }
      const n = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "PageDown" ? 10 : event.key === "PageUp" ? -10 : 0;
      if (!n) return;
      event.preventDefault();
      step(el, state, n);
    });
  }
  const state = wheelStates.get(el)!;
  state.change = onChange;
  return () => unmountWheel(el);
}

/** The change callback of a mounted drum (React passes a new closure on every render). */
export function setWheelChange(el: WheelElement, onChange: WheelChange) {
  const state = wheelStates.get(el);
  if (state) state.change = onChange;
}

/**
 * Puts a drum on a value from outside (a reset, a restored editor) without
 * reporting it as a change: no tick sound, no callback.
 */
export function setWheelValue(el: WheelElement, value: number) {
  const state = wheelStates.get(el);
  if (!state) return;
  const v = wrapValue(value, state.count);
  // The drum's own value coming back (a step it reported): nothing to do, and a running snap is left alone.
  if (v === state.value) {
    // The app caught up with the drum: earlier reports can't come back any more.
    state.echoes = [];
    return;
  }
  // An older value it reported, arriving late while the drum already went on (fast keys): not a reset.
  const now = Date.now();
  state.echoes = state.echoes.filter((e) => now - e.t < 1500);
  const echo = state.echoes.findIndex((e) => e.v === v);
  if (echo >= 0) {
    state.echoes.splice(0, echo + 1);
    return;
  }
  stopSpin(state);
  state.value = v;
  state.target = null;
  if (state.timer) clearTimeout(state.timer);
  el.dataset.value = String(v);
  el.setAttribute("aria-valuenow", String(v));
  el.scrollTo({ top: wheelPosition(v, state.count) * ROW_HEIGHT, behavior: "instant" });
  decorate(el, state);
}

/** Commits a drum's pending value (a tap or a key whose smooth snap has not finished). */
export function flushWheel(el: WheelElement) {
  const state = wheelStates.get(el);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  // A spin in progress lands now, on the row it was going to.
  if (state.spin !== null) {
    stopSpin(state);
    state.touching = false;
  }
  state.drag = null;
  if (state.target !== null) el.scrollTo({ top: state.target * ROW_HEIGHT, behavior: "instant" });
  emit(el, state);
  settle(el, state);
}

export function unmountWheel(el: WheelElement) {
  const state = wheelStates.get(el);
  if (!state) return;
  state.active = false;
  if (state.timer) clearTimeout(state.timer);
  stopSpin(state);
  for (const [type, fn] of state.listeners) el.removeEventListener?.(type, fn);
  wheelStates.delete(el);
}

export function mountWheels(root: WheelRoot, onChange: WheelChange) {
  for (const el of toArray(root.querySelectorAll("[data-wheel]"))) mountWheel(el, onChange);
}
export function flushWheels(root: WheelRoot) {
  for (const el of toArray(root.querySelectorAll("[data-wheel]"))) flushWheel(el);
}
export function unmountWheels(root: WheelRoot) {
  for (const el of toArray(root.querySelectorAll("[data-wheel]"))) unmountWheel(el);
}
