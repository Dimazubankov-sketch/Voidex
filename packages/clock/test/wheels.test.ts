import { test } from "node:test";
import assert from "node:assert/strict";
import { ROW_HEIGHT, flushWheels, mountWheels, setWheelValue, unmountWheels, wheelPosition, wheelSpec, wrapValue } from "../src/wheels.ts";

// Ported from Voidex-Clock tests/wheels.test.js (same stand-in elements).

function wheel(value = 23, count = 24, key = "hours") {
  const options = Array.from({ length: count * 3 }, () => ({ style: { setProperty() {} } as { setProperty(): void; visibility?: string }, classList: { toggle() {} } }));
  const handlers: Record<string, (e?: unknown) => void> = {};
  const attributes: Record<string, string> = {};
  const el = {
    dataset: { wheel: key, count: String(count), value: String(value) } as Record<string, string | undefined>,
    scrollTop: 0,
    behavior: "" as string | undefined,
    querySelectorAll: () => options,
    setAttribute: (k: string, v: string) => (attributes[k] = v),
    addEventListener: (name: string, fn: (e?: unknown) => void) => (handlers[name] = fn),
    removeEventListener: (name: string) => delete handlers[name],
    scrollTo({ top, behavior }: { top: number; behavior?: string }) {
      this.scrollTop = top;
      this.behavior = behavior;
    },
  };
  return { root: { querySelectorAll: () => [el] }, el, handlers, attributes };
}

test("cyclic values match clock boundaries and nearest centered row", () => {
  assert.equal(wrapValue(24, 24), 0);
  assert.equal(wrapValue(-1, 24), 23);
  assert.equal(wrapValue(60, 60), 0);
  assert.equal(wrapValue(59.7, 60), 0);
  assert.equal(wheelPosition(7, 24), 31);
});

test("wheel is accessible as one spinbutton; options do not create tab stops", () => {
  const spec = wheelSpec("Минуты", 5, 60);
  assert.equal(spec.attrs.role, "spinbutton");
  assert.equal(spec.attrs["aria-valuenow"], 5);
  assert.equal(spec.attrs["aria-valuemax"], 59);
  assert.equal(spec.attrs.tabIndex, 0);
  // The range three times over (cyclic scrolling); every option is a non-tabbable button in the markup.
  assert.equal(spec.options.length, 180);
  assert.equal(spec.options[65], "05");
  assert.equal(wheelSpec("Часы", 3, 24, false).options[3], "3");
});

test("keyboard moves through 23 to 00 and flush captures the selected value", () => {
  const w = wheel();
  const changes: [string, number][] = [];
  mountWheels(w.root, (k, value) => changes.push([k, value]));
  assert.equal(w.el.scrollTop, 47 * ROW_HEIGHT);
  w.handlers.keydown!({ key: "ArrowDown", preventDefault() {} });
  flushWheels(w.root);
  assert.equal(w.el.dataset.value, "0");
  assert.equal(w.el.scrollTop, 24 * ROW_HEIGHT);
  assert.deepEqual(changes.at(-1), ["hours", 0]);
  assert.equal(w.attributes["aria-valuenow"], "0");
  unmountWheels(w.root);
});

test("PageUp / Home / End jump and stay inside the range", () => {
  const w = wheel(5, 60, "minutes");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  w.handlers.keydown!({ key: "PageUp", preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 55);
  w.handlers.keydown!({ key: "Home", preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 0);
  w.handlers.keydown!({ key: "End", preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 59);
  unmountWheels(w.root);
});

test("keys pressed faster than the snap each count (three presses, three steps)", () => {
  const w = wheel(0, 60, "seconds");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  // A smooth scroll that has not moved yet when the next key comes.
  w.el.scrollTo = function () {} as never;
  for (let i = 0; i < 3; i++) w.handlers.keydown!({ key: "ArrowDown", preventDefault() {} });
  w.el.scrollTo = function ({ top }: { top: number }) {
    this.scrollTop = top;
  } as never;
  flushWheels(w.root);
  assert.equal(changes.at(-1), 3);
  unmountWheels(w.root);
});

test("a tap on a row selects it once its snap is flushed", () => {
  const w = wheel(0, 60, "seconds");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  w.handlers.click!({ target: { closest: () => ({ dataset: { wheelOption: String(60 + 42) } }) } });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 42);
  unmountWheels(w.root);
});

test("scroll selection survives a pending snap; minute values are independent", () => {
  const w = wheel(0, 60);
  const changes: number[] = [];
  mountWheels(w.root, (_k, value) => changes.push(value));
  w.el.scrollTop = (60 + 17) * ROW_HEIGHT + 5;
  w.handlers.scroll!();
  assert.equal(w.el.dataset.value, "17");
  flushWheels(w.root);
  assert.equal(w.el.scrollTop, 77 * ROW_HEIGHT);
  assert.equal(changes.at(-1), 17);
  unmountWheels(w.root);
});

test("hours, minutes and seconds drums keep their own values", () => {
  const h = wheel(1, 24, "hours");
  const m = wheel(2, 60, "minutes");
  const s = wheel(3, 60, "seconds");
  const got: Record<string, number> = {};
  const root = { querySelectorAll: () => [h.el, m.el, s.el] };
  mountWheels(root, (k, v) => (got[k] = v));
  m.handlers.keydown!({ key: "ArrowDown", preventDefault() {} });
  s.handlers.keydown!({ key: "ArrowUp", preventDefault() {} });
  flushWheels(root);
  assert.deepEqual(got, { minutes: 3, seconds: 2 });
  assert.equal(h.el.dataset.value, "1");
  unmountWheels(root);
});

test("mounting and restoring a value is silent (no change, so no tick sound)", () => {
  const w = wheel(7, 24);
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  w.handlers.scroll!();
  setWheelValue(w.el as never, 12);
  w.handlers.scroll!();
  flushWheels(w.root);
  assert.deepEqual(changes, []);
  assert.equal(w.el.dataset.value, "12");
  unmountWheels(w.root);
});

test("detached wheel ignores queued scroll events after changing editors", () => {
  const w = wheel();
  const changes: number[] = [];
  mountWheels(w.root, (_k, value) => changes.push(value));
  const scroll = w.handlers.scroll!;
  unmountWheels(w.root);
  w.el.scrollTop = 30 * ROW_HEIGHT;
  scroll();
  assert.deepEqual(changes, []);
});

// Step 2.15: mouse wheel, finger drag with momentum, endless cycling.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("mouse wheel: one notch is one step; a trackpad's small deltas add up to steps", () => {
  const w = wheel(10, 60, "minutes");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  w.handlers.wheel!({ deltaY: 100, deltaMode: 0, preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 11);
  w.handlers.wheel!({ deltaY: -120, deltaMode: 0, preventDefault() {} });
  w.handlers.wheel!({ deltaY: -120, deltaMode: 0, preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 9);
  // Trackpad: 10 px at a time; one row is 44 px.
  for (let i = 0; i < 9; i++) w.handlers.wheel!({ deltaY: 10, deltaMode: 0, preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 11);
  unmountWheels(w.root);
});

test("a drag follows the pointer; a slow release lands on the next row, a fast flick spins on several rows", async () => {
  const w = wheel(0, 60, "seconds");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  // Slow: one row up, held, then lifted.
  w.handlers.pointerdown!({ pointerId: 1, clientY: 300, button: 0 });
  w.handlers.pointermove!({ pointerId: 1, clientY: 290 });
  w.handlers.pointermove!({ pointerId: 1, clientY: 256 });
  assert.equal(w.el.scrollTop, 60 * ROW_HEIGHT + 44); // 1:1 with the finger
  await sleep(120);
  w.handlers.pointerup!({ pointerId: 1, type: "pointerup" });
  flushWheels(w.root);
  assert.equal(changes.at(-1), 1);
  // Fast: a quick flick of two rows keeps turning well past them, then rests on a row.
  w.handlers.pointerdown!({ pointerId: 2, clientY: 300, button: 0 });
  for (let i = 1; i <= 4; i++) {
    await sleep(8);
    w.handlers.pointermove!({ pointerId: 2, clientY: 300 - i * 22 });
  }
  w.handlers.pointerup!({ pointerId: 2, type: "pointerup" });
  await sleep(1100);
  const v = changes.at(-1)!;
  assert.ok(v >= 5 && v <= 1 + 2 + 14, `spun to ${v}`);
  assert.equal(w.el.scrollTop % ROW_HEIGHT, 0);
  unmountWheels(w.root);
});

test("endless both ways: 58, 59, 00, 01 … and back 01, 00, 59, 58, never stopping at an end", () => {
  const w = wheel(58, 60, "minutes");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  for (let i = 0; i < 70; i++) w.handlers.keydown!({ key: "ArrowDown", preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), (58 + 70) % 60);
  for (let i = 0; i < 75; i++) w.handlers.wheel!({ deltaY: -100, deltaMode: 0, preventDefault() {} });
  flushWheels(w.root);
  assert.equal(changes.at(-1), (((58 + 70 - 75) % 60) + 60) % 60);
  // Always back in the middle copy at rest.
  assert.ok(w.el.scrollTop >= 60 * ROW_HEIGHT && w.el.scrollTop < 120 * ROW_HEIGHT);
  unmountWheels(w.root);
});

test("Step 2.15: a late echo of a value the drum already passed does not pull it back (fast keys); a real reset still works", () => {
  const w = wheel(0, 60, "seconds");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  const down = () => {
    w.handlers.keydown!({ key: "ArrowDown", preventDefault() {} });
    w.handlers.scrollend!();
  };
  down();
  down();
  assert.deepEqual(changes, [1, 2]);
  // The app renders the first report only now.
  setWheelValue(w.el as never, 1);
  assert.equal(w.el.dataset.value, "2");
  assert.equal(w.el.scrollTop, wheelPosition(2, 60) * ROW_HEIGHT);
  down();
  setWheelValue(w.el as never, 2);
  setWheelValue(w.el as never, 3);
  assert.equal(w.el.dataset.value, "3");
  // Caught up: a reset to 0 is applied.
  setWheelValue(w.el as never, 0);
  assert.equal(w.el.dataset.value, "0");
  assert.equal(w.el.scrollTop, wheelPosition(0, 60) * ROW_HEIGHT);
  unmountWheels(w.root);
});
