import { describe, expect, it, vi } from "vitest";
import { beginCriticalOperation, criticalOperation, criticalOperationsRunning, onCriticalOperationsIdle } from "./critical-ops";

describe("critical operations", () => {
  it("counts running operations and tells listeners when the last one ends", async () => {
    const idle = vi.fn();
    const off = onCriticalOperationsIdle(idle);
    const a = beginCriticalOperation();
    const b = beginCriticalOperation();
    expect(criticalOperationsRunning()).toBe(2);
    a();
    expect(idle).not.toHaveBeenCalled();
    b();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(criticalOperationsRunning()).toBe(0);
    off();
  });
  it("ending twice does not go negative or notify twice", () => {
    const idle = vi.fn();
    const off = onCriticalOperationsIdle(idle);
    const done = beginCriticalOperation();
    done();
    done();
    expect(criticalOperationsRunning()).toBe(0);
    expect(idle).toHaveBeenCalledTimes(1);
    off();
  });
  it("criticalOperation() ends even when the job throws", async () => {
    await expect(criticalOperation(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(criticalOperationsRunning()).toBe(0);
  });
});
