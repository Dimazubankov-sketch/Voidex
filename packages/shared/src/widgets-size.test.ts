import { describe, expect, it } from "vitest";
import { WorkspaceLayoutSchema, addWidget, defaultLayout, joinWidgets, normalizeLayout, placementOf, resizeWidget, stackWidgets, widgetCells, widgetSizesOf, type WorkspaceLayout } from "./index";

const APPS = ["settings", "mail", "notes", "files", "media", "clock", "calculator", "vibex"] as const;
const page0 = { surface: "mobile" as const, page: 0 };
const g = { cols: 4, rows: 6 };
const n = (l: WorkspaceLayout) => normalizeLayout(l, [...APPS]);

function phone(...widgets: [string, "clock" | "calculator", number, number][]) {
  let l = n(defaultLayout([...APPS]));
  for (const [id, type, c, r] of widgets) l = n(addWidget(l, type, { surface: "mobile", page: 0, cell: { c, r } }, id));
  return l;
}
const keysOnPage = (l: WorkspaceLayout) => [...placementOf(l, page0, g).keys()].sort();

describe("A2: widget sizes", () => {
  it("only Clock offers two sizes; the menu never shows a size a widget cannot draw", () => {
    expect(widgetSizesOf("clock")).toEqual(["s", "w"]);
    expect(widgetSizesOf("calculator")).toEqual(["s"]);
    const l = phone(["w_calc0001", "calculator", 0, 0]);
    expect(resizeWidget(l, "w_calc0001", "w", g).error).toBe("missing");
  });

  it("2 × 2 → 4 × 2 and back: the widget grows in place, icons under it move to the nearest free cells, nothing is lost", () => {
    const l = phone(["w_clock001", "clock", 0, 0]);
    const before = keysOnPage(l);
    const r = resizeWidget(l, "w_clock001", "w", g);
    expect(r.error).toBeUndefined();
    const big = n(r.layout!);
    expect(big.widgets[0]!.size).toBe("w");
    const p = placementOf(big, page0, g);
    expect(p.get("widget:w_clock001")).toMatchObject({ c: 0, r: 0, w: 4, h: 2 });
    expect(keysOnPage(big)).toEqual(before);
    // No overlaps.
    const seen = new Set<string>();
    for (const q of p.values()) for (let y = q.r; y < q.r + q.h; y++) for (let x = q.c; x < q.c + q.w; x++) {
      expect(seen.has(`${x},${y}`)).toBe(false);
      seen.add(`${x},${y}`);
    }
    // Survives validation and a reload; back to small.
    expect(WorkspaceLayoutSchema.safeParse(big).success).toBe(true);
    const small = n(resizeWidget(big, "w_clock001", "s", g).layout!);
    expect(small.widgets[0]!.size).toBeUndefined();
    expect(widgetCells(small.widgets[0]!)).toEqual({ w: 2, h: 2 });
    expect(keysOnPage(small)).toEqual(before);
  });

  it("on the right half it is pulled left to fit; another widget in the way moves too", () => {
    const l = phone(["w_clock001", "clock", 2, 0], ["w_calc0001", "calculator", 0, 0]);
    const big = n(resizeWidget(l, "w_clock001", "w", g).layout!);
    const p = placementOf(big, page0, g);
    expect(p.get("widget:w_clock001")).toMatchObject({ c: 0, r: 0, w: 4 });
    const calc = p.get("widget:w_calc0001")!;
    expect(calc.r).toBeGreaterThanOrEqual(2);
  });

  it("a full page refuses (nothing changes)", () => {
    const l = phone(["w_clock001", "clock", 0, 0], ["w_a0000001", "calculator", 2, 0], ["w_b0000001", "calculator", 0, 2], ["w_c0000001", "calculator", 2, 2], ["w_d0000001", "calculator", 0, 4], ["w_e0000001", "calculator", 2, 4]);
    expect(resizeWidget(l, "w_clock001", "w", g).error).toBe("room");
  });

  it("a wide widget never joins a stack or a carousel; a stack keeps its base size", () => {
    let l = phone(["w_clock001", "clock", 0, 0], ["w_calc0001", "calculator", 0, 2]);
    l = n(resizeWidget(l, "w_clock001", "w", g).layout!);
    expect(stackWidgets(l, "w_calc0001", "w_clock001").error).toBe("wide");
    expect(joinWidgets(l, "w_calc0001", "w_clock001", "right", g).error).toBe("room");
    // A stored size on a stack is dropped by the model.
    const bad = { ...l, widgets: [{ ...l.widgets[0]!, items: [{ id: "w_clock001", type: "clock" }, { id: "w_x0000001", type: "calculator" }] }, l.widgets[1]!] };
    expect(n(bad as WorkspaceLayout).widgets[0]!.size).toBeUndefined();
  });
});
