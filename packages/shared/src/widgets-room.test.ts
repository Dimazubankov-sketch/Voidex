import { describe, expect, it } from "vitest";
import { WorkspaceLayoutSchema, addWidget, defaultLayout, normalizeLayout, placeWidgetMakingRoom, placementOf, type Place, type WorkspaceLayout } from "./index";

/** Update 4 · B2: a widget moved onto a busy page / desktop makes room for itself; nothing is ever lost. */
const APPS = ["settings", "mail", "notes", "files", "media", "clock", "calculator", "vibex"] as const;
const n = (l: WorkspaceLayout) => normalizeLayout(l, [...APPS]);
const page = (p: number): Place => ({ surface: "mobile", page: p });

/** Every item and widget of a surface, wherever it is. */
function everything(l: WorkspaceLayout, surface: "mobile" | "desktop") {
  const items = surface === "mobile" ? l.mobile.pages.flat() : l.desktop.spaces.flatMap((s) => s.items);
  return [...items.map((i) => `${i.kind}:${i.id}`), ...l.widgets.filter((w) => w.surface === surface).map((w) => `widget:${w.id}`)].sort();
}

/** No overlaps and nothing outside the grid on any page. */
function sane(l: WorkspaceLayout, places: Place[], g: { cols: number; rows: number }) {
  for (const p of places) {
    const seen = new Set<string>();
    for (const q of placementOf(l, p, g).values()) {
      expect(q.c + q.w).toBeLessThanOrEqual(g.cols);
      expect(q.r + q.h).toBeLessThanOrEqual(g.rows);
      for (let y = q.r; y < q.r + q.h; y++)
        for (let x = q.c; x < q.c + q.w; x++) {
          expect(seen.has(`${x},${y}`)).toBe(false);
          seen.add(`${x},${y}`);
        }
    }
  }
}

/** Phone: page 0 holds the 8 apps (two rows), page 1 a clock widget. */
function twoPages() {
  let l = n(defaultLayout([...APPS]));
  l = { ...l, mobile: { ...l.mobile, pages: [l.mobile.pages[0]!, []] } };
  return n(addWidget(l, "clock", { surface: "mobile", page: 1, cell: { c: 0, r: 0 } }, "w_clock001"));
}

describe("Update 4 · B2: a widget makes room for itself", () => {
  it("dropped on icons of another page: they make way to the nearest free cells; nothing is lost or overlapped", () => {
    const l = twoPages();
    const g = { cols: 4, rows: 6 };
    const before = everything(l, "mobile");
    const r = placeWidgetMakingRoom(l, "widget:w_clock001", page(0), { c: 0, r: 0 }, g)!;
    expect(r).not.toBeNull();
    const out = n(r.layout);
    expect(out.widgets[0]!.container).toBe("0");
    expect(placementOf(out, page(0), g).get("widget:w_clock001")).toMatchObject({ c: 0, r: 0, w: 2, h: 2 });
    expect(everything(out, "mobile")).toEqual(before);
    expect(r.moved.length).toBe(4);
    expect(r.spilled).toEqual([]);
    sane(out, [page(0), page(1)], g);
    // The icons that made way went to the nearest free cells (not to the end of the page).
    for (const k of r.moved) expect(placementOf(out, page(0), g).get(k)!.r).toBeLessThanOrEqual(3);
    expect(WorkspaceLayoutSchema.safeParse(out).success).toBe(true);
  });

  it("a full page: what no longer fits goes to the neighbouring page", () => {
    const l = twoPages();
    // Three rows: the 8 apps and a 2 × 2 widget fill page 0 completely.
    const g = { cols: 4, rows: 3 };
    let full = n(addWidget(l, "calculator", { surface: "mobile", page: 0, cell: { c: 0, r: 2 } }, "w_calc0001"));
    full = n(placeWidgetMakingRoom(full, "widget:w_calc0001", page(0), { c: 0, r: 1 }, g)!.layout);
    const before = everything(full, "mobile");
    const r = placeWidgetMakingRoom(full, "widget:w_clock001", page(0), { c: 2, r: 0 }, g)!;
    expect(r).not.toBeNull();
    const out = n(r.layout);
    expect(everything(out, "mobile")).toEqual(before);
    expect(r.spilled.length).toBeGreaterThan(0);
    for (const k of r.spilled) expect(out.mobile.pages[1]!.some((i) => `${i.kind}:${i.id}` === k) || out.widgets.some((w) => `widget:${w.id}` === k && w.container !== "0")).toBe(true);
    sane(out, [page(0), page(1)], g);
  });

  it("no room anywhere (every page full, no new page allowed): the move is refused and nothing changes", () => {
    let l = n(defaultLayout([...APPS]));
    const g = { cols: 4, rows: 2 };
    // Three pages (the limit), each full: page 0 = 8 apps; pages 1 and 2 = two widgets each.
    l = { ...l, mobile: { ...l.mobile, pages: [l.mobile.pages[0]!, [], []] } };
    l = n(addWidget(l, "clock", { surface: "mobile", page: 1, cell: { c: 0, r: 0 } }, "w_a0000001"));
    l = n(addWidget(l, "clock", { surface: "mobile", page: 1, cell: { c: 2, r: 0 } }, "w_b0000001"));
    l = n(addWidget(l, "clock", { surface: "mobile", page: 2, cell: { c: 0, r: 0 } }, "w_c0000001"));
    l = n(addWidget(l, "clock", { surface: "mobile", page: 2, cell: { c: 2, r: 0 } }, "w_d0000001"));
    expect(placeWidgetMakingRoom(l, "widget:w_a0000001", page(0), { c: 0, r: 0 }, g)).toBeNull();
  });

  it("PC: a full desktop sends what no longer fits to a new desktop (within the limit)", () => {
    let l = n(defaultLayout([...APPS]));
    const g = { cols: 4, rows: 2 };
    const d0 = l.desktop.spaces[0]!.id;
    const desk: Place = { surface: "desktop", space: d0 };
    l = n(addWidget(l, "clock", { surface: "desktop", space: d0, cell: { c: 0, r: 0 } }, "w_clock001"));
    const before = everything(l, "desktop");
    // The 8 apps fill the 4 × 2 desktop; the widget takes half: 4 icons must go elsewhere.
    const r = placeWidgetMakingRoom(l, "widget:w_clock001", desk, { c: 0, r: 0 }, g)!;
    expect(r).not.toBeNull();
    const out = n(r.layout);
    expect(everything(out, "desktop")).toEqual(before);
    expect(r.created?.surface).toBe("desktop");
    expect(out.desktop.spaces.length).toBe(2);
    sane(out, out.desktop.spaces.map((s) => ({ surface: "desktop" as const, space: s.id })), g);
  });

  it("a 4 × 2 widget of the same page swaps with nothing lost; 2 × 2 widgets in the way move to a free block", () => {
    let l = twoPages();
    const g = { cols: 4, rows: 6 };
    l = n(addWidget(l, "calculator", { surface: "mobile", page: 1, cell: { c: 0, r: 2 } }, "w_calc0001"));
    l = { ...l, widgets: l.widgets.map((w) => (w.id === "w_clock001" ? { ...w, size: "w" as const } : w)) };
    l = n(l);
    const r = placeWidgetMakingRoom(l, "widget:w_clock001", page(1), { c: 0, r: 2 }, g)!;
    const out = n(r.layout);
    const p = placementOf(out, page(1), g);
    expect(p.get("widget:w_clock001")).toMatchObject({ c: 0, r: 2, w: 4, h: 2 });
    expect(p.get("widget:w_calc0001")).toBeDefined();
    sane(out, [page(0), page(1)], g);
  });
});
