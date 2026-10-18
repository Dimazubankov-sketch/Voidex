/**
 * Step 2.14: an id for this browser, so a Clock ring pops up only on the
 * device it rang on (the Notification Center of the other devices just lists
 * it). Kept on the device; not tied to the account.
 */
const KEY = "vx.clock.device";
let cached: string | null = null;

export function clockDeviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 40);
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached ??= "this-device";
  }
  return cached;
}
