/**
 * Where Voidex Clock keeps its data and who wakes it up.
 *
 * ClockStorageAdapter: the state lives on this device (localStorage, one key
 * per VOIDEX account). Nothing is synced between devices yet; the interface
 * is what an account / ViCloud sync will implement later (async-ready: the
 * UI never assumes the write went further than the device).
 *
 * ClockSchedulerAdapter: the browser fallback can only ring while VOIDEX is
 * open (any app, any tab state the browser keeps running); it says so with
 * `background: false`. A native shell (the future VOIDEX app) provides
 * `window.VoidexClock` with the same calls and real OS alarms; registration
 * failures reject, and the UI then keeps the previous setting.
 */
import type { Alarm, ClockState, RingEvent, Snooze, Timer } from "./model.ts";
import { deleteAlarm, normalizeState, prepareAlarm, putAlarm, removeTimer, setAlarmEnabled, snoozeRing, startTimer, toggleTimer } from "./model.ts";

export interface ClockStorageAdapter {
  /** "device": this browser only. */
  readonly kind: "device";
  load(): ClockState | null;
  /** False when the device refused the write (storage full, private mode). */
  save(state: ClockState): boolean;
  /** Bytes the saved state takes (Settings → Applications → Часы). */
  bytes(): number;
}

/** Minimal Storage (window.localStorage or a stand-in). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = "voidex-clock-v1";
export const storageKey = (account: string) => `${STORAGE_KEY}:${account}`;

export function deviceClockStorage(store: KeyValueStore | null | undefined, account: string): ClockStorageAdapter {
  const key = storageKey(account);
  return {
    kind: "device",
    load() {
      try {
        const raw = store?.getItem(key);
        return raw ? normalizeState(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        if (!store) return false;
        store.setItem(key, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },
    bytes() {
      try {
        const raw = store?.getItem(key);
        return raw ? new TextEncoder().encode(key + raw).length : 0;
      } catch {
        return 0;
      }
    },
  };
}

/** What an OS alarm needs (the shape `window.VoidexClock.scheduleAlarm` receives). */
export type ScheduledAlarm = Pick<Alarm, "id" | "time" | "name" | "days" | "enabled" | "sound" | "snooze" | "interval" | "nextAt">;
export type ScheduledTimer = Pick<Timer, "id" | "name" | "sound" | "endsAt">;
export type ScheduledSnooze = Pick<Snooze, "id" | "sourceAlarmId" | "name" | "sound" | "at" | "interval">;

export interface ClockSchedulerAdapter {
  readonly kind: "browser" | "native";
  /** True only when alarms ring with VOIDEX closed (a native shell). */
  readonly background: boolean;
  scheduleAlarm(alarm: ScheduledAlarm): Promise<void>;
  cancelAlarm(id: string): Promise<void>;
  snoozeAlarm(snooze: ScheduledSnooze): Promise<void>;
  scheduleTimer(timer: ScheduledTimer): Promise<void>;
  cancelTimer(id: string): Promise<void>;
}

/** The bridge a native VOIDEX shell may put on window (every call optional). */
export interface VoidexClockBridge {
  scheduleAlarm?(alarm: ScheduledAlarm): Promise<unknown> | unknown;
  cancelAlarm?(id: string): Promise<unknown> | unknown;
  snoozeAlarm?(snooze: ScheduledSnooze): Promise<unknown> | unknown;
  scheduleTimer?(timer: ScheduledTimer): Promise<unknown> | unknown;
  cancelTimer?(id: string): Promise<unknown> | unknown;
}

/** In-page scheduling: the shell's scheduler loop rings; nothing to register. */
export const browserScheduler: ClockSchedulerAdapter = {
  kind: "browser",
  background: false,
  scheduleAlarm: async () => {},
  cancelAlarm: async () => {},
  snoozeAlarm: async () => {},
  scheduleTimer: async () => {},
  cancelTimer: async () => {},
};

/** Native scheduling through the bridge; a call the bridge lacks is a no-op, a failing one rejects. */
export function nativeScheduler(bridge: VoidexClockBridge): ClockSchedulerAdapter {
  const call = async <A,>(fn: ((a: A) => unknown) | undefined, arg: A) => {
    if (fn) await fn.call(bridge, arg);
  };
  return {
    kind: "native",
    background: true,
    scheduleAlarm: (a) => call(bridge.scheduleAlarm, { ...a }),
    cancelAlarm: (id) => call(bridge.cancelAlarm, id),
    snoozeAlarm: (s) => call(bridge.snoozeAlarm, { ...s }),
    scheduleTimer: (t) => call(bridge.scheduleTimer, { ...t }),
    cancelTimer: (id) => call(bridge.cancelTimer, id),
  };
}

/** Native when the shell provides `window.VoidexClock`, otherwise the browser fallback. */
export function pickScheduler(host: { VoidexClock?: VoidexClockBridge } | undefined = globalThis as { VoidexClock?: VoidexClockBridge }): ClockSchedulerAdapter {
  return host?.VoidexClock ? nativeScheduler(host.VoidexClock) : browserScheduler;
}

// ---------------------------------------------------------------------------
// Changes that need the scheduler: it is asked first, the state changes only
// when it agreed (a native registration failure never shows a false success).

export async function saveAlarmVia(scheduler: ClockSchedulerAdapter, state: ClockState, draft: Alarm, now = Date.now()): Promise<{ state: ClockState; alarm: Alarm }> {
  const alarm = prepareAlarm(draft, now);
  await scheduler.scheduleAlarm({ ...alarm });
  return { state: putAlarm(state, alarm), alarm };
}

export async function setAlarmEnabledVia(scheduler: ClockSchedulerAdapter, state: ClockState, id: string, enabled: boolean, now = Date.now()): Promise<ClockState> {
  const next = setAlarmEnabled(state, id, enabled, now);
  const a = next.alarms.find((x) => x.id === id);
  if (!a) return state;
  if (enabled) await scheduler.scheduleAlarm({ ...a });
  else await scheduler.cancelAlarm(id);
  return next;
}

export async function deleteAlarmVia(scheduler: ClockSchedulerAdapter, state: ClockState, id: string): Promise<ClockState> {
  await scheduler.cancelAlarm(id);
  return deleteAlarm(state, id);
}

export async function startTimerVia(scheduler: ClockSchedulerAdapter, state: ClockState, input: { duration: number; name: string; sound: string }, now = Date.now()): Promise<ClockState> {
  const r = startTimer(state, input, now);
  await scheduler.scheduleTimer({ ...r.timer });
  return r.state;
}

export async function toggleTimerVia(scheduler: ClockSchedulerAdapter, state: ClockState, id: string, now = Date.now()): Promise<ClockState> {
  const next = toggleTimer(state, id, now);
  const t = next.timers.find((x) => x.id === id);
  if (!t) return state;
  if (t.running) await scheduler.scheduleTimer({ ...t });
  else await scheduler.cancelTimer(id);
  return next;
}

export async function removeTimerVia(scheduler: ClockSchedulerAdapter, state: ClockState, id: string): Promise<ClockState> {
  await scheduler.cancelTimer(id);
  return removeTimer(state, id);
}

export async function snoozeVia(scheduler: ClockSchedulerAdapter, state: ClockState, ring: RingEvent, now = Date.now()): Promise<ClockState> {
  const next = snoozeRing(state, ring, now);
  const s = next.snoozes[next.snoozes.length - 1];
  if (s && next !== state) await scheduler.snoozeAlarm({ ...s });
  return next;
}
