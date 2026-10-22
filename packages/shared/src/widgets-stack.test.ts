import { describe, expect, it } from "vitest";
import {
  STACK_MAX,
  WorkspaceLayoutSchema,
  addToStack,
  addWidget,
  carouselSpot,
  defaultLayout,
  deleteWidgetHalf,
  isWidgetCarousel,
  joinWidgets,
  normalizeLayout,
  placementOf,
  setStackActive,
  splitWidgetCarousel,
  stackWidgets,
  unstackActive,
  widgetCells,
  widgetColumns,
  type WorkspaceLayout,
} from "./index";

const APPS = ["settings", "mail"] as const;
const page0 = { surface: "mobile" as const, page: 0 };
const g = { cols: 4, rows: 6 };
const n = (l: WorkspaceLayout) => normalizeLayout(l, [...APPS]);
const ok = (r: { layout?: WorkspaceLayout; error?: string }) => {
  expect(r.error).toBeUndefined();
  return n(r.layout!);
};

function phone(...widgets: [string, "clock" | "calculator", number, number][]) {
  let l = n(defaultLayout([...APPS]));
  for (const [id, type, c, r] of widgets) l = n(addWidget(l, type, { surface: "mobile", page: 0, cell: { c, r } }, id));
  return l;
}

describe("Stage E: widget stacks", () => {
  it("E1: dropping a widget on another makes a stack there; the dropped one is in view; the order is kept", () => {
    let l = phone(["w_aaaa1111", "clock", 0, 1], ["w_bbbb2222", "calculator", 2, 1]);
    l = ok(stackWidgets(l, "w_bbbb2222", "w_aaaa1111"));
    expect(l.widgets).toHaveLength(1);
    const w = l.widgets[0]!;
    expect(widgetColumns(w)[0]!.map((x) => x.type)).toEqual(["clock", "calculator"]);
    expect(w.active).toBe(1);
    expect(widgetCells(w)).toEqual({ w: 2, h: 2 });
    expect(WorkspaceLayoutSchema.safeParse(l).success).toBe(true);
  });

  it("E1: at most 10; adding past it is refused with nothing lost", () => {
    let l = phone(["w_base0000", "clock", 0, 1]);
    for (let i = 1; i < STACK_MAX; i++) l = ok(addToStack(l, "w_base0000", 0, i % 2 ? "calculator" : "clock", `w_item${String(i).padStart(4, "0")}`));
    expect(widgetColumns(l.widgets[0]!)[0]).toHaveLength(10);
    expect(addToStack(l, "w_base0000", 0, "clock", "w_toomany1").error).toBe("full");
    const extra = n(addWidget(l, "clock", { surface: "mobile", page: 0, cell: { c: 2, r: 1 } }, "w_extra001"));
    expect(stackWidgets(extra, "w_extra001", "w_base0000").error).toBe("full");
  });

  it("E1: the active widget is remembered; «Убрать из стопки» keeps both it and the rest; «Удалить стопку» removes only the stack", () => {
    let l = phone(["w_aaaa1111", "clock", 0, 1], ["w_bbbb2222", "calculator", 2, 1]);
    l = ok(stackWidgets(l, "w_bbbb2222", "w_aaaa1111"));
    l = n(setStackActive(l, "w_aaaa1111", 0, 0));
    expect(l.widgets[0]!.active ?? 0).toBe(0);
    // Take out the clock (in view): it gets a free place; the stack (now one widget) stays.
    l = ok(unstackActive(l, "w_aaaa1111", 0, g, "w_newid0001"));
    expect(l.widgets).toHaveLength(2);
    const types = l.widgets.map((w) => w.type).sort();
    expect(types).toEqual(["calculator", "clock"]);
    const p = placementOf(l, page0, g);
    const a = p.get(`widget:${l.widgets[0]!.id}`)!;
    const b = p.get(`widget:${l.widgets[1]!.id}`)!;
    expect(a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h).toBe(false); // no overlap
    // No room: refused, nothing changes.
    const full = { cols: 4, rows: 2 };
    let s = phone(["w_cccc3333", "clock", 0, 0], ["w_dddd4444", "calculator", 2, 0]);
    s = ok(stackWidgets(s, "w_dddd4444", "w_cccc3333"));
    s = n(addWidget(s, "clock", { surface: "mobile", page: 0, cell: { c: 2, r: 0 } }, "w_eeee5555"));
    expect(unstackActive(s, "w_cccc3333", 0, full).error).toBe("room");
    // Delete the stack: the whole stack goes, the other widget stays.
    expect(n(deleteWidgetHalf(s, "w_cccc3333", 0)).widgets.map((w) => w.id)).toEqual(["w_eeee5555"]);
  });
});

describe("Stage E: horizontal carousels", () => {
  it("E2: widget + widget, stack + widget, stack + stack → one 4 × 2 block; only where it fits", () => {
    let l = phone(["w_aaaa1111", "clock", 0, 1], ["w_bbbb2222", "calculator", 2, 1]);
    // The «+» is offered only on a side with room: left of the left one there is none.
    expect(carouselSpot(l, "w_bbbb2222", "w_aaaa1111", "left", g)).toBeNull();
    expect(carouselSpot(l, "w_bbbb2222", "w_aaaa1111", "right", g)).toEqual({ c: 0, r: 1 });
    l = ok(joinWidgets(l, "w_bbbb2222", "w_aaaa1111", "right", g));
    expect(l.widgets).toHaveLength(1);
    const w = l.widgets[0]!;
    expect(isWidgetCarousel(w)).toBe(true);
    expect(widgetCells(w)).toEqual({ w: 4, h: 2 });
    expect(widgetColumns(w).map((c) => c.map((x) => x.type))).toEqual([["clock"], ["calculator"]]);
    // Each half can become a stack (left / right independently), up to 10 each.
    l = ok(addToStack(l, w.id, 1, "clock", "w_right002"));
    l = ok(addToStack(l, w.id, 0, "calculator", "w_left0002"));
    expect(widgetColumns(l.widgets[0]!).map((c) => c.length)).toEqual([2, 2]);
    expect(WorkspaceLayoutSchema.safeParse(l).success).toBe(true);
    // A carousel never goes into a stack.
    l = n(addWidget(l, "clock", { surface: "mobile", page: 0, cell: { c: 0, r: 3 } }, "w_other001"));
    expect(stackWidgets(l, l.widgets[0]!.id, "w_other001").error).toBe("carousel");
    // Something in the way: refused.
    const blocked = phone(["w_aaaa1111", "clock", 0, 1], ["w_bbbb2222", "calculator", 0, 3]);
    const withIcon = n({ ...blocked, mobile: { ...blocked.mobile, cells: { ...blocked.mobile.cells, "app:mail": { c: 2, r: 1 } } } });
    expect(joinWidgets(withIcon, "w_bbbb2222", "w_aaaa1111", "right", g).error).toBe("room");
  });

  it("E3: «Убрать карусель» parts the halves in their places; removing one half keeps the other", () => {
    let l = phone(["w_aaaa1111", "clock", 0, 1], ["w_bbbb2222", "calculator", 2, 1]);
    l = ok(joinWidgets(l, "w_bbbb2222", "w_aaaa1111", "right", g));
    l = ok(addToStack(l, l.widgets[0]!.id, 1, "clock", "w_right002"));
    const split = n(splitWidgetCarousel(l, l.widgets[0]!.id, g));
    expect(split.widgets).toHaveLength(2);
    const p = placementOf(split, page0, g);
    const cells = split.widgets.map((w) => p.get(`widget:${w.id}`)!);
    expect(cells.map((c) => [c.c, c.r])).toEqual([
      [0, 1],
      [2, 1],
    ]);
    expect(widgetColumns(split.widgets[1]!)[0]).toHaveLength(2); // the right half was a stack and stays one
    // Delete the left half: the right half stays where it stood.
    const right = n(deleteWidgetHalf(l, l.widgets[0]!.id, 0, g));
    expect(right.widgets).toHaveLength(1);
    expect(placementOf(right, page0, g).get(`widget:${right.widgets[0]!.id}`)).toMatchObject({ c: 2, r: 1 });
    expect(widgetColumns(right.widgets[0]!)[0]!.map((x) => x.type)).toEqual(["calculator", "clock"]);
  });

  it("older layouts and broken data: plain widgets stay; unknown types and duplicates leave stacks; one item is no stack", () => {
    const l = phone(["w_aaaa1111", "clock", 0, 1]);
    const broken = { ...l, widgets: [{ ...l.widgets[0]!, items: [{ id: "w_aaaa1111", type: "clock" }, { id: "w_gone0001", type: "retired" }, { id: "w_aaaa1111", type: "calculator" }], active: 7 }] };
    const fixed = n(broken as WorkspaceLayout);
    expect(fixed.widgets[0]!.items).toBeUndefined();
    expect(fixed.widgets[0]!.active).toBeUndefined();
    expect(fixed.widgets[0]!.type).toBe("clock");
  });
});
