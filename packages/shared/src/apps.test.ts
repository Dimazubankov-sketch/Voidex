import { describe, expect, it } from "vitest";
import { APP_IDS, APP_REGISTRY, APP_RELEASES, compareVersions, updateAvailable } from "./apps.js";

describe("app releases (Step 2.12)", () => {
  it("every app has releases, newest first, the first being the manifest's version", () => {
    for (const id of APP_IDS) {
      const list = APP_RELEASES[id];
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]!.version).toBe(APP_REGISTRY[id].version);
      for (let i = 1; i < list.length; i++) expect(compareVersions(list[i - 1]!.version, list[i]!.version)).toBeGreaterThan(0);
      for (const r of list) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("an update is available only for an older installed version", () => {
    expect(updateAvailable("0.9.0", "notes")).toBe(true);
    expect(updateAvailable(APP_REGISTRY.notes.version, "notes")).toBe(false);
    expect(updateAvailable("9.9.9", "notes")).toBe(false);
    expect(updateAvailable(undefined, "notes")).toBe(false);
  });
});
