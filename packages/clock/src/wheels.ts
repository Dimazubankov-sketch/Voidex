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

function later(state: WheelState, fn: () => void, ms: number) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(fn, ms);
}

function move(el: WheelElement, state: WheelState, index: number) {
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
    on("pointerdown", () => {
      state.touching = true;
      state.target = null;
      if (state.timer) clearTimeout(state.timer);
    });
    const release = () => {
      state.touching = false;
      later(state, () => settle(el, state), 180);
    };
    on("pointerup", release);
    on("pointercancel", release);
    on("lostpointercapture", release);
    on("click", (event: { target?: { closest?: (s: string) => { dataset: Record<string, string | undefined> } | null } }) => {
      const option = event.target?.closest?.("[data-wheel-option]");
      if (option) move(el, state, Number(option.dataset.wheelOption));
    });
    on("keydown", (event: { key: string; preventDefault(): void }) => {
      // Keys pressed faster than the smooth snap step on from where the drum is going, not where it is.
      const current = state.target ?? Math.round(el.scrollTop / ROW_HEIGHT);
      let next: number;
      if (event.key === "ArrowDown") next = current + 1;
      else if (event.key === "ArrowUp") next = current - 1;
      else if (event.key === "PageDown") next = current + 10;
      else if (event.key === "PageUp") next = current - 10;
      else if (event.key === "Home") next = wheelPosition(0, state.count);
      else if (event.key === "End") next = wheelPosition(state.count - 1, state.count);
      else return;
      event.preventDefault();
      move(el, state, Math.max(0, Math.min(state.count * 3 - 1, next)));
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
  if (v === state.value) return;
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
  if (state.target !== null) el.scrollTo({ top: state.target * ROW_HEIGHT, behavior: "instant" });
  emit(el, state);
  settle(el, state);
}

export function unmountWheel(el: WheelElement) {
  const state = wheelStates.get(el);
  if (!state) return;
  state.active = false;
  if (state.timer) clearTimeout(state.timer);
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
