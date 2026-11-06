/**
 * Critical operations: work that must not be cut off by an automatic update (a save, a send, an upload,
 * a presentation export). Anything that starts one calls `beginCriticalOperation()` and the returned function
 * when it ends. The updater only reloads while the count is zero. Dependency-free on purpose (imported by api.ts).
 */
let count = 0;
const listeners = new Set<() => void>();

export function beginCriticalOperation(): () => void {
  count++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count = Math.max(0, count - 1);
    if (count === 0) for (const l of listeners) l();
  };
}

export function criticalOperationsRunning(): number {
  return count;
}

/** Called whenever the count drops to zero. */
export function onCriticalOperationsIdle(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Runs a promise-returning job as a critical operation. */
export async function criticalOperation<T>(job: () => Promise<T>): Promise<T> {
  const done = beginCriticalOperation();
  try {
    return await job();
  } finally {
    done();
  }
}
