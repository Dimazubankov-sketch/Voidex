import { describe, expect, it } from "vitest";
import { VIBEX_STORY_TTL_MS, canDeleteChatForAll, chatSections, wrapIndex } from "./vibex.js";

type C = { id: string; kind: "direct" | "group"; pinnedPosition: number | null; lastMessageAt: string };
const c = (id: string, kind: C["kind"], at: number, pin: number | null = null): C => ({ id, kind, pinnedPosition: pin, lastMessageAt: new Date(at * 1000).toISOString() });

describe("Step 2.9: chat list sections", () => {
  const list = [c("d1", "direct", 5), c("g1", "group", 9), c("d2", "direct", 7), c("p2", "group", 1, 1), c("p1", "direct", 2, 0), c("g2", "group", 3)];
  const keys = (order: Parameters<typeof chatSections>[1]) => chatSections(list, order).map((s) => [s.key, s.items.map((x) => x.id)]);

  it("pinned always first, in their own order; then chats, then groups (latest first)", () => {
    expect(keys("chats-first")).toEqual([
      ["pinned", ["p1", "p2"]],
      ["chats", ["d2", "d1"]],
      ["groups", ["g1", "g2"]],
    ]);
  });
  it("groups first", () => {
    expect(keys("groups-first")).toEqual([
      ["pinned", ["p1", "p2"]],
      ["groups", ["g1", "g2"]],
      ["chats", ["d2", "d1"]],
    ]);
  });
  it("mixed: one list by activity, pinned still on top", () => {
    expect(keys("mixed")).toEqual([
      ["pinned", ["p1", "p2"]],
      ["all", ["g1", "d2", "d1", "g2"]],
    ]);
  });
  it("empty sections are left out", () => {
    expect(chatSections([c("d", "direct", 1)], "groups-first").map((s) => s.key)).toEqual(["chats"]);
    expect(chatSections([], "mixed")).toEqual([]);
  });
});

describe("Step 2.9: delete for everyone", () => {
  it("either person of a direct chat; only the owner of a group", () => {
    expect(canDeleteChatForAll({ kind: "direct", group: null })).toBe(true);
    expect(canDeleteChatForAll({ kind: "group", group: { role: "owner" } as never })).toBe(true);
    expect(canDeleteChatForAll({ kind: "group", group: { role: "member" } as never })).toBe(false);
  });
});

describe("Step 2.9: circular photo carousel", () => {
  it("wraps both ways: 1 → 2 → 3 → 1 and 1 ← 3 ← 2", () => {
    expect([0, 1, 2, 3, 4].map((i) => wrapIndex(i, 3))).toEqual([0, 1, 2, 0, 1]);
    expect([-1, -2, -3, -4].map((i) => wrapIndex(i, 3))).toEqual([2, 1, 0, 2]);
    expect(wrapIndex(5, 1)).toBe(0);
    expect(wrapIndex(3, 0)).toBe(0);
  });
});

describe("Step 2.9: story lifetime", () => {
  it("is 24 hours", () => {
    expect(VIBEX_STORY_TTL_MS).toBe(86_400_000);
  });
});
