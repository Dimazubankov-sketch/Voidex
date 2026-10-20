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

/** Rows a flick can travel at most, and the time constant of its glide (ms). */
const FLING_ROWS_MAX = 14;
const FLING_TAU = 300;
/** Release speed (px / ms) below which a drag just snaps to its row. */
const FLING_MIN = 0.55;
/** Step 2.16: a drag shorter than this (rows of finger travel) never spins on: it steps. */
const FLING_MIN_ROWS = 1.5;
/** …and a nudge of at least this much of a row is one row on, never more. */
const NUDGE = 0.2;

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

/**
 * A flick: the drum keeps turning for a moment, longer the faster the flick
 * (a short move is a short turn), then comes to rest exactly on a row. Each
 * row it passes is a real step (the tick sound, the change).
 */
function fling(el: WheelElement, state: WheelState, velocity: number, dragRows = Infinity, startRow?: number) {
  stopSpin(state);
  // Step 2.16: a small move goes exactly one row on (or stays), whatever its speed: the next
  // or the previous number is always easy to reach. Only a real flick spins on.
  if (reduced() || Math.abs(velocity) < FLING_MIN || Math.abs(dragRows) < FLING_MIN_ROWS) {
    state.touching = false;
    const here = el.scrollTop / ROW_HEIGHT;
    let row = Math.round(here);
    if (startRow !== undefined && Math.abs(dragRows) < 1) row = Math.abs(dragRows) >= NUDGE ? startRow + Math.sign(dragRows) : startRow;
    move(el, state, row);
    return;
  }
  // The speed above the flick threshold decides how far it turns (a fair flick: a few rows).
  const speed = Math.abs(velocity) - FLING_MIN * 0.6;
  const travel = Math.sign(velocity) * Math.min(FLING_ROWS_MAX * ROW_HEIGHT, speed * FLING_TAU);
  // Land on a row, inside the middle copy (the same numbers one copy away).
  recentre(el, state, travel);
  const from = el.scrollTop;
  const to = Math.round((from + travel) / ROW_HEIGHT) * ROW_HEIGHT;
  const rows = Math.abs(to - from) / ROW_HEIGHT;
  const duration = Math.max(280, Math.min(950, 240 + rows * 52));
  const start = Date.now();
  state.touching = true;
  state.target = to / ROW_HEIGHT;
  const frame = () => {
    if (!state.active) return;
    const k = Math.min(1, (Date.now() - start) / duration);
    const eased = 1 - (1 - k) ** 3;
    el.scrollTo({ top: from + (to - from) * eased, behavior: "instant" });
    emit(el, state);
    decorate(el, state);
    if (k < 1) {
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
      while (d.samples.length > 2 && now - d.samples[0]!.t > 90) d.samples.shift();
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
      const first = d.samples[0]!;
      const last = d.samples[d.samples.length - 1]!;
      const dt = Math.max(1, last.t - first.t);
      // A finger held still before lifting is no flick.
      const fresh = Date.now() - last.t < 60;
      const velocity = fresh && event?.type !== "pointercancel" ? -(last.y - first.y) / dt : 0;
      // How far the finger took the drum (rows) and the row it started on (recentring moves both alike).
      const dragRows = (el.scrollTop - d.top) / ROW_HEIGHT;
      fling(el, state, velocity, dragRows, Math.round(d.top / ROW_HEIGHT));
    };
    on("pointerup", release);
    on("pointercancel", release);
    on("lostpointercapture", (event: { pointerId: number }) => state.drag && release(event));
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
