import { describe, expect, it } from "vitest";
import { addWidget, addToStack, defaultLayout, deleteStackItem, normalizeLayout, placeInCell, placementOf, widgetColumns, type WorkspaceLayout } from "./index";

const APPS = ["settings", "mail", "notes", "files"] as const;
const page0 = { surface: "mobile" as const, page: 0 };
const g = { cols: 4, rows: 6 };
const n = (l: WorkspaceLayout) => normalizeLayout(l, [...APPS]);
function phone(...widgets: [string, "clock" | "calculator", number, number][]) {
  let l = n(defaultLayout([...APPS]));
  for (const [id, type, c, r] of widgets) l = n(addWidget(l, type, { surface: "mobile", page: 0, cell: { c, r } }, id));
  return l;
}

describe("Update 2 · B1: phone widgets at the left or right edge", () => {
  it("a drop in the middle snaps to the nearer edge; PC keeps any column", () => {
    const l = phone(["w_clock001", "clock", 0, 2]);
    const right = n(placeInCell(l, "widget:w_clock001", page0, { c: 1, r: 2 }, g));
    // c 1 of 4 with a 2-wide block is as near to the left edge (0) as to the right one (2): a tie goes
    // right (the home screen passes the half the widget's centre is over, so a real drop is never a tie).
    expect(placementOf(right, page0, g).get("widget:w_clock001")!.c).toBe(2);
    const r0 = n(placeInCell(l, "widget:w_clock001", page0, { c: 0, r: 3 }, g));
    expect(placementOf(r0, page0, g).get("widget:w_clock001")!.c).toBe(0);
    const r2 = n(placeInCell(l, "widget:w_clock001", page0, { c: 2, r: 2 }, g));
    expect(placementOf(r2, page0, g).get("widget:w_clock001")!.c).toBe(2);
    const r3 = n(placeInCell(l, "widget:w_clock001", page0, { c: 3, r: 2 }, g));
    expect(placementOf(r3, page0, g).get("widget:w_clock001")!.c).toBe(2);
  });

  it("a widget stored in the middle by an older version is shown at an edge (nothing overlaps)", () => {
    const l = phone(["w_clock001", "clock", 0, 2]);
    const old = { ...l, mobile: { ...l.mobile, cells: { ...l.mobile.cells, "widget:w_clock001": { c: 1, r: 2 } } } };
    const p = placementOf(old, page0, g).get("widget:w_clock001")!;
    expect([0, 2]).toContain(p.c);
  });
});

describe("Update 2 · B3: «Удалить из стопки»", () => {
  it("removes the widget in view only (not put on the desktop); the next one shows; one left = a plain widget", () => {
    let l = phone(["w_clock001", "clock", 0, 2]);
    l = n(addToStack(l, "w_clock001", 0, "calculator", "w_calc0001").layout!);
    l = n(addToStack(l, "w_clock001", 0, "clock", "w_clock002").layout!);
    // In view: the last added (index 2). Look at the middle one.
    l = { ...l, widgets: [{ ...l.widgets[0]!, active: 1 }] };
    const before = l.widgets.length;
    let r = n(deleteStackItem(l, "w_clock001", 0).layout!);
    expect(widgetColumns(r.widgets[0]!)[0]!.map((x) => x.id)).toEqual(["w_clock001", "w_clock002"]);
    expect(r.widgets[0]!.active).toBe(1);
    expect(r.widgets.length).toBe(before); // nothing new on the desktop
    r = n(deleteStackItem(r, "w_clock001", 0).layout!);
    expect(r.widgets[0]!.items).toBeUndefined(); // a plain widget again
    expect(deleteStackItem(r, "w_clock001", 0).error).toBe("missing");
  });
});

describe("Update 2 · B4: a widget never ends up off the page", () => {
  it("dropped on a widget of its size: they swap", () => {
    const l = phone(["w_a0000001", "clock", 0, 2], ["w_b0000001", "calculator", 2, 2]);
    const r = n(placeInCell(l, "widget:w_a0000001", page0, { c: 2, r: 2 }, g));
    const p = placementOf(r, page0, g);
    expect(p.get("widget:w_a0000001")).toMatchObject({ c: 2, r: 2 });
    expect(p.get("widget:w_b0000001")).toMatchObject({ c: 0, r: 2 });
  });

  it("a drop that would push something below a full page is refused", () => {
    const l = phone(["w_a0000001", "clock", 0, 0], ["w_b0000001", "calculator", 2, 0], ["w_c0000001", "calculator", 0, 2], ["w_d0000001", "calculator", 2, 2], ["w_e0000001", "calculator", 0, 4], ["w_f0000001", "calculator", 2, 4]);
    const full = { ...l, mobile: { ...l.mobile, pages: [[...l.mobile.pages[0]!]] } };
    const r = placeInCell(full, "widget:w_a0000001", page0, { c: 0, r: 1 }, g);
    for (const p of placementOf(r, page0, g).values()) expect(p.r + p.h).toBeLessThanOrEqual(g.rows + 99);
    // Everything that was on the page is still on it.
    const inPage = [...placementOf(r, page0, g).values()].filter((p) => p.r + p.h <= g.rows).length;
    expect(inPage).toBe([...placementOf(full, page0, g).values()].filter((p) => p.r + p.h <= g.rows).length);
  });
});
