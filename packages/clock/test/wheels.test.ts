import { test } from "node:test";
import assert from "node:assert/strict";
import { FLING_MIN, FLING_ROWS_MAX, ROW_HEIGHT, flingTarget, glideDuration, releaseVelocity, flushWheels, mountWheels, setWheelValue, unmountWheels, wheelPosition, wheelSpec, wrapValue } from "../src/wheels.ts";

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
  assert.ok(v >= 5 && v <= 1 + 2 + FLING_ROWS_MAX, `spun to ${v}`);
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

test("Step 2.16: a short quick nudge goes exactly one row on (either way), never 2–4; a tiny touch stays", async () => {
  const w = wheel(10, 60, "minutes");
  const changes: number[] = [];
  mountWheels(w.root, (_k, v) => changes.push(v));
  const nudge = async (id: number, dy: number) => {
    w.handlers.pointerdown!({ pointerId: id, clientY: 300, button: 0 });
    for (let i = 1; i <= 3; i++) {
      await sleep(6);
      w.handlers.pointermove!({ pointerId: id, clientY: 300 - (dy * i) / 3 });
    }
    w.handlers.pointerup!({ pointerId: id, type: "pointerup" });
    await sleep(500);
    flushWheels(w.root);
  };
  // A fast flick of a third of a row (that used to spin 2–4 rows on).
  await nudge(1, ROW_HEIGHT * 0.35);
  assert.equal(changes.at(-1), 11);
  await nudge(2, -ROW_HEIGHT * 0.4);
  assert.equal(changes.at(-1), 10);
  // A tiny touch (a tenth of a row) moves nothing.
  const n = changes.length;
  await nudge(3, ROW_HEIGHT * 0.1);
  assert.equal(changes.length, n);
  assert.equal(w.el.dataset.value, "10");
  unmountWheels(w.root);
});

test("B1: the release speed decides the travel: slow = the nearest row, medium = a few, fast = many", () => {
  const top = 100 * ROW_HEIGHT;
  // Slow drag (precise): no momentum, nearest row.
  assert.deepEqual(flingTarget(top + 10, 0.1, 3, 97), { row: 100, glide: false });
  // Medium swipe: a few values on.
  const medium = flingTarget(top, 0.9, 2, 98);
  assert.ok(medium.glide && medium.row - 100 >= 3 && medium.row - 100 <= 10, `medium ${medium.row - 100}`);
  // Fast swipe: many values; faster always goes at least as far; never past the cap.
  const fast = flingTarget(top, 3, 3, 97);
  assert.ok(fast.row - 100 >= 15, `fast ${fast.row - 100}`);
  let prev = 0;
  for (const v of [0.4, 0.8, 1.2, 2, 3, 5, 9, 20]) {
    const rows = flingTarget(top, v, 3, 97).row - 100;
    assert.ok(rows >= prev, `monotonic at ${v}`);
    assert.ok(rows <= FLING_ROWS_MAX);
    prev = rows;
  }
  // Downwards the same, mirrored.
  assert.equal(flingTarget(top, -3, -3, 103).row - 100, -(fast.row - 100));
  // Any flick moves at least one row in its direction.
  assert.equal(flingTarget(top + 2, FLING_MIN + 0.01, 2, 98).row, 101);
});

test("B1: the glide starts at the finger's speed and ends in a finite time", () => {
  for (const [d, v] of [[44 * 5, 0.9], [44 * 20, 3], [44 * 60, 8]] as const) {
    const dur = glideDuration(d, v);
    const startSpeed = (3 * d) / dur; // derivative of the cubic ease-out at 0
    assert.ok(dur <= 1800 && dur >= 240);
    if (dur > 240 && dur < 1800) assert.ok(Math.abs(startSpeed - v) < 0.01, `speed ${startSpeed} vs ${v}`);
  }
});

test("B1: release speed comes from the last ~100 ms; a finger held still is no flick", () => {
  const now = 1000;
  assert.equal(releaseVelocity([{ y: 300, t: 900 }, { y: 200, t: 960 }], now + 200), 0);
  const v = releaseVelocity([{ y: 400, t: 700 }, { y: 300, t: 950 }, { y: 250, t: 990 }], now);
  assert.ok(v > 1 && v < 1.4, `v ${v}`);
});

test("B1: a long fast spin crosses 59 → 00 and 23 → 00 and rests on an exact row inside the middle copy", async () => {
  for (const count of [60, 24]) {
    const w = wheel(count - 3, count, "x");
    const changes: number[] = [];
    mountWheels(w.root, (_k, v) => changes.push(v));
    w.handlers.pointerdown!({ pointerId: 1, clientY: 600, button: 0 });
    for (let i = 1; i <= 6; i++) {
      await sleep(8);
      w.handlers.pointermove!({ pointerId: 1, clientY: 600 - i * 40 });
    }
    w.handlers.pointerup!({ pointerId: 1, type: "pointerup" });
    await sleep(1900);
    assert.equal(w.el.scrollTop % ROW_HEIGHT, 0);
    assert.ok(w.el.scrollTop >= count * ROW_HEIGHT * 0.5 && w.el.scrollTop <= count * ROW_HEIGHT * 2.5);
    // Values go one way only, wrapping around (a frame of a fast spin may pass two rows), never back.
    for (let i = 1; i < changes.length; i++) {
      const d = (changes[i]! - changes[i - 1]! + count) % count;
      assert.ok(d >= 1 && d <= 4, `step ${i}: ${changes[i - 1]} → ${changes[i]}`);
    }
    assert.ok(changes.length > 8);
    assert.equal(Number(w.el.dataset.value), changes.at(-1));
    unmountWheels(w.root);
  }
});

test("B1: a child's lost capture (touch: the pressed row held the pointer first) does not end the drag", () => {
  const w = wheel(0, 60, "minutes");
  mountWheels(w.root, () => {});
  w.handlers.pointerdown!({ pointerId: 1, clientY: 300, button: 0 });
  w.handlers.pointermove!({ pointerId: 1, clientY: 290 });
  w.handlers.lostpointercapture!({ pointerId: 1, target: { tagName: "BUTTON" } });
  w.handlers.pointermove!({ pointerId: 1, clientY: 212 });
  assert.equal(w.el.scrollTop, 60 * ROW_HEIGHT + 88); // still following the finger
  unmountWheels(w.root);
});
