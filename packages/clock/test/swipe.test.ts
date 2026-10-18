import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSwipes, swipeShouldOpen, unmountSwipes } from "../src/swipe.ts";

// Ported from Voidex-Clock tests/swipe.test.js (same stand-in elements).

type Handler = (e: Record<string, unknown>) => void;

function fixture() {
  const handlers: Record<string, Handler> = {};
  const classes = new Set<string>();
  const trash: Record<string, unknown> & { tabIndex: number; focused?: boolean } = {
    tabIndex: -1,
    setAttribute(k: string, v: string) {
      (this as Record<string, unknown>)[k] = v;
    },
    focus() {
      this.focused = true;
    },
  };
  const front = { setPointerCapture() {}, releasePointerCapture() {} };
  const row: Record<string, unknown> & { dataset: Record<string, string> } = {
    dataset: { swipeOpen: "false" },
    classList: {
      add: (...v: string[]) => v.forEach((x) => classes.add(x)),
      remove: (...v: string[]) => v.forEach((x) => classes.delete(x)),
      toggle: (v: string, b?: boolean) => (b ? classes.add(v) : classes.delete(v)),
    },
    style: {
      setProperty(k: string, v: string) {
        row[k] = v;
      },
    },
    querySelector: (s: string) => (s === ".swipe-delete" ? trash : front),
  };
  const target = { closest: (s: string) => (s === "[data-swipe-row]" ? row : s === ".swipe-front" ? front : null) };
  const root = {
    querySelectorAll: () => [row],
    addEventListener(n: string, fn: Handler) {
      handlers[n] = fn;
    },
  };
  mountSwipes(root as never);
  return {
    row,
    trash,
    handlers,
    root,
    classes,
    event(extra: Record<string, unknown> = {}) {
      return {
        target,
        button: 0,
        pointerId: 1,
        clientX: 200,
        clientY: 100,
        preventDefault() {
          (this as Record<string, unknown>).prevented = true;
        },
        stopImmediatePropagation() {
          (this as Record<string, unknown>).stopped = true;
        },
        ...extra,
      } as Record<string, unknown>;
    },
  };
}

test("short and vertical gestures keep trash hidden; left swipe reveals without deleting", () => {
  const f = fixture();
  // Vertical: a scroll, not a swipe.
  f.handlers.pointerdown!(f.event());
  f.handlers.pointermove!(f.event({ clientX: 195, clientY: 160 }));
  f.handlers.pointerup!(f.event());
  assert.equal(f.row.dataset.swipeOpen, "false");
  f.handlers.pointerdown!(f.event());
  f.handlers.pointermove!(f.event({ clientX: 110 }));
  f.handlers.pointerup!(f.event());
  assert.equal(f.row.dataset.swipeOpen, "true");
  assert.equal(f.trash.tabIndex, 0);
  assert.equal(f.trash["aria-hidden"], "false");
  // The click that ends the drag never reaches the row.
  const click = f.event();
  f.handlers.click!(click);
  assert.equal(click.stopped, true);
  assert.equal(f.row.dataset.swipeOpen, "true");
  // The trash itself is a real button: its click goes through (the app deletes there, and only there).
  const trashClick = f.event({ target: { closest: (s: string) => (s === "[data-swipe-row]" ? f.row : s === ".swipe-delete" ? f.trash : null) } });
  f.handlers.click!(trashClick);
  assert.equal(trashClick.stopped, undefined);
  assert.equal(f.row.dataset.swipeOpen, "true");
  unmountSwipes(f.root as never);
});

test("a short drag springs back; a tap on an open row closes it without deleting", async () => {
  const g = fixture();
  g.handlers.pointerdown!(g.event());
  g.handlers.pointermove!(g.event({ clientX: 180 }));
  // A slow finger: the release comes well after the last move, so there is no fling.
  await new Promise((r) => setTimeout(r, 130));
  g.handlers.pointerup!(g.event());
  assert.equal(g.row.dataset.swipeOpen, "false");
  assert.equal(g.row["--swipe-offset"], "0px");
  unmountSwipes(g.root as never);
  const f = fixture();
  f.handlers.keydown!(f.event({ key: "ArrowLeft" }));
  assert.equal(f.row.dataset.swipeOpen, "true");
  const tap = f.event();
  f.handlers.click!(tap);
  assert.equal(tap.stopped, true);
  assert.equal(f.row.dataset.swipeOpen, "false");
  unmountSwipes(f.root as never);
});

test("right swipe closes reveal; keyboard opens accessible trash and Escape closes", () => {
  const f = fixture();
  f.handlers.keydown!(f.event({ key: "ArrowLeft" }));
  assert.equal(f.trash.focused, true);
  f.handlers.pointerdown!(f.event());
  f.handlers.pointermove!(f.event({ clientX: 290 }));
  f.handlers.pointerup!(f.event());
  assert.equal(f.row.dataset.swipeOpen, "false");
  assert.equal(f.trash.tabIndex, -1);
  f.handlers.keydown!(f.event({ key: "Delete" }));
  assert.equal(f.row.dataset.swipeOpen, "true");
  f.handlers.keydown!(f.event({ key: "Escape" }));
  assert.equal(f.row.dataset.swipeOpen, "false");
  assert.equal(swipeShouldOpen(-20, 0), false);
  assert.equal(swipeShouldOpen(-40, 0), true);
  assert.equal(swipeShouldOpen(-10, -0.6), true);
  unmountSwipes(f.root as never);
});
