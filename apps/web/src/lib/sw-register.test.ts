import { afterEach, describe, expect, it, vi } from "vitest";
import { retireServiceWorkers } from "./sw-register";

afterEach(() => vi.unstubAllGlobals());

describe("retireServiceWorkers", () => {
  it("unregisters every worker and deletes only vx-* caches", async () => {
    const unregister = vi.fn(async () => true);
    const del = vi.fn(async (_name: string) => true);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } });
    vi.stubGlobal("caches", { keys: async () => ["vx-shell-v1", "vx-files-v1", "other-app-cache"], delete: del });
    await retireServiceWorkers();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del.mock.calls.map((c) => c[0])).toEqual(["vx-shell-v1", "vx-files-v1"]);
  });
  it("never throws (no support, blocked, or failing)", async () => {
    vi.stubGlobal("navigator", {});
    await expect(retireServiceWorkers()).resolves.toBeUndefined();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: async () => { throw new Error("denied"); } } });
    await expect(retireServiceWorkers()).resolves.toBeUndefined();
  });
});
