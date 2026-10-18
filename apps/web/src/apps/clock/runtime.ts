import { create } from "zustand";
import {
  defaultState,
  deviceClockStorage,
  pickScheduler,
  tick,
  type ClockSchedulerAdapter,
  type ClockState,
  type ClockStorageAdapter,
  type RingEvent,
  snoozeVia,
} from "@voidex/clock";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { ringSound, stopRing, unlockAudio, useClockAudio } from "./audio";
import { clockDeviceId } from "./device";
import { clockText } from "./strings";

/**
 * Step 2.14: Clock's runtime, part of the shell (not of the Clock window):
 * the state of the signed-in account on this device, the scheduler loop and
 * the queue of rings. Alarms and timers therefore ring whether the Clock
 * window is open or not, on the home screen, over another app and over the
 * lock screen, as long as VOIDEX is open on the device (the browser fallback
 * has no background alarms: it says so, it never pretends).
 */

interface ClockStore {
  account: string | null;
  state: ClockState;
  /** Rings waiting for the sheet; the first one is on screen. */
  rings: RingEvent[];
  /** A Stop / Snooze is being handled (no double taps, no close race). */
  dismissing: boolean;
  /** Keys of changes still waiting for the scheduler (one per alarm / timer). */
  busy: string[];
}

export const useClock = create<ClockStore>(() => ({ account: null, state: defaultState(), rings: [], dismissing: false, busy: [] }));

let storage: ClockStorageAdapter | null = null;
let scheduler: ClockSchedulerAdapter = pickScheduler(typeof window === "undefined" ? undefined : (window as never));
let saveWarned = false;

export const clockScheduler = () => scheduler;
export const clockBytes = () => storage?.bytes() ?? 0;
const lang = () => useI18n.getState().language;

/** Loads (or switches to) an account's Clock on this device. */
export function loadClock(account: string) {
  if (useClock.getState().account === account) return;
  storage = deviceClockStorage(typeof localStorage === "undefined" ? null : localStorage, account);
  scheduler = pickScheduler(window as never);
  saveWarned = false;
  stopRing();
  useClock.setState({ account, state: storage.load() ?? defaultState(), rings: [], dismissing: false, busy: [] });
}

/** Signed out: nothing of the account stays in memory, nothing rings. */
export function unloadClock() {
  stopRing();
  storage = null;
  useClock.setState({ account: null, state: defaultState(), rings: [], dismissing: false, busy: [] });
}

/** Applies a change and writes it to the device. */
export function commit(next: ClockState) {
  if (next === useClock.getState().state) return;
  useClock.setState({ state: next });
  if (storage && !storage.save(next) && !saveWarned) {
    saveWarned = true;
    toast({ title: clockText(lang(), "storage.failed"), tone: "danger" });
  }
}

export const change = (fn: (s: ClockState) => ClockState) => commit(fn(useClock.getState().state));

/**
 * A change that goes through the scheduler first (save / toggle / delete an
 * alarm, start / pause a timer). One at a time per key; a failure shows a
 * message and leaves the state as it was.
 */
export async function changeVia(key: string, fn: (s: ClockState, scheduler: ClockSchedulerAdapter) => Promise<ClockState>, errorKey: Parameters<typeof clockText>[1] = "failed"): Promise<boolean> {
  if (useClock.getState().busy.includes(key)) return false;
  useClock.setState((s) => ({ busy: [...s.busy, key] }));
  try {
    const next = await fn(useClock.getState().state, scheduler);
    commit(next);
    return true;
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    toast({ title: clockText(lang(), code === "bad-time" ? "alarm.badTime" : code === "bad-duration" ? "timer.badDuration" : errorKey), tone: "danger" });
    return false;
  } finally {
    useClock.setState((s) => ({ busy: s.busy.filter((k) => k !== key) }));
  }
}

// ---------------------------------------------------------------------------
// Rings

function ringTime(at: number) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** The ring also goes to the account's Notification Center (a pop-up on this device when Clock is not in front). */
function notify(r: RingEvent) {
  const title = r.name || clockText(lang(), r.kind === "alarm" ? "alarm.default" : "timer.default");
  void api
    .post("/api/notifications/clock", { type: r.kind === "alarm" ? "clock.alarm" : "clock.timer", title, body: ringTime(r.at), id: r.sourceId, device: clockDeviceId() })
    .catch(() => {
      /* offline or locked: the ring sheet still shows it */
    });
}

function enqueue(rings: RingEvent[]) {
  if (!rings.length) return;
  const queue = useClock.getState().rings;
  const fresh = rings.filter((r) => !queue.some((q) => q.key === r.key));
  if (!fresh.length) return;
  useClock.setState({ rings: [...queue, ...fresh] });
  for (const r of fresh) notify(r);
  // The first ring of an empty queue starts its sound now (resuming the audio if the page may play sound).
  if (!queue.length) void ringSound(fresh[0]!.sound, { force: true });
}

/** Stop (or «Ещё N минут») for the ring on screen; the next one in the queue follows. */
export async function dismissRing(snooze: boolean) {
  const { rings, dismissing } = useClock.getState();
  const current = rings[0];
  if (!current || dismissing) return;
  useClock.setState({ dismissing: true });
  try {
    if (snooze && current.snooze) commit(await snoozeVia(scheduler, useClock.getState().state, current));
  } catch {
    toast({ title: clockText(lang(), "failed"), tone: "danger" });
  } finally {
    stopRing();
    const rest = useClock.getState().rings.filter((r) => r.key !== current.key);
    useClock.setState({ rings: rest, dismissing: false });
    if (rest[0]) void ringSound(rest[0].sound, { force: true });
  }
}

/** Starts the sound of the ring on screen (a tap, or a retry once the page may play sound). */
export async function enableRingSound(): Promise<boolean> {
  const current = useClock.getState().rings[0];
  if (!current) return false;
  return ringSound(current.sound, { force: true });
}

// ---------------------------------------------------------------------------
// The scheduler loop

function pass() {
  if (!useClock.getState().account) return;
  const now = Date.now();
  const r = tick(useClock.getState().state, now);
  if (r.changed) commit(r.state);
  for (const a of r.missed) toast({ title: clockText(lang(), "alarm.missed", { name: a.name || clockText(lang(), "alarm.default") }), tone: "danger", duration: 8000 });
  enqueue(r.rings);
}

/** Something will ring: the next tap anywhere in VOIDEX unlocks the sound (browsers need a gesture). */
function hasPending(s: ClockState) {
  return s.alarms.some((a) => a.enabled) || s.timers.some((t) => t.running) || s.snoozes.length > 0;
}

/** Starts the loop (every 250 ms, and as soon as the tab is visible again). Returns its stop. */
export function startClockLoop(): () => void {
  const id = window.setInterval(pass, 250);
  const onVisible = () => pass();
  const onTap = (e: Event) => {
    const { state, rings } = useClock.getState();
    if (!hasPending(state) && !rings.length) return;
    unlockAudio();
    // A ring already on screen whose sound the browser held back starts with this tap (not with a tap on its own buttons).
    if (rings.length && !useClockAudio.getState().ringing && !(e.target as Element | null)?.closest?.("[data-clock-ring] button")) void enableRingSound();
  };
  document.addEventListener("visibilitychange", onVisible);
  document.addEventListener("pointerdown", onTap, { capture: true, passive: true });
  document.addEventListener("keydown", onTap, { capture: true, passive: true });
  pass();
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("pointerdown", onTap, { capture: true });
    document.removeEventListener("keydown", onTap, { capture: true });
  };
}
