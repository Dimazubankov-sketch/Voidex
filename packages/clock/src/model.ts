/**
 * State of Voidex Clock and every change to it, as pure functions (ported
 * from the state handling of Voidex-Clock dist/app.js). The UI, the shell's
 * scheduler and the tests all go through these, so an alarm saved from the
 * editor, toggled from its card or fired by the scheduler follows one rule.
 */
import { DEFAULT_CITIES, isKnownZone } from "./cities.ts";
import { LATE_RING_MS, MAX_TIMER_MS, MIN_TIMER_MS, SNOOZE_INTERVALS, nextAlarm, stopwatchElapsed, timerRemaining, type StopwatchState } from "./engine.ts";
import { DEFAULT_SOUND, isSoundId } from "./sounds.ts";

export interface Alarm {
  id: string;
  /** "HH:MM". */
  time: string;
  name: string;
  /** 0 = Sunday ... 6 = Saturday; empty = rings once. */
  days: number[];
  enabled: boolean;
  sound: string;
  /** «Повтор сигнала»: the ring offers «Ещё N минут». */
  snooze: boolean;
  /** Snooze interval, minutes (1, 3, 5, 9, 10 or 15). */
  interval: number;
  /** When it rings next (ms); null while off. */
  nextAt: number | null;
}

export interface Timer {
  id: string;
  name: string;
  sound: string;
  /** Full length, ms. */
  duration: number;
  /** What is left while paused, ms. */
  remaining: number;
  /** Deadline while running (ms since epoch): the countdown is always computed from it. */
  endsAt: number;
  running: boolean;
}

export interface RecentTimer {
  name: string;
  sound: string;
  duration: number;
}

/** A snoozed ring: it rings again at `at` with the same name and sound. */
export interface Snooze {
  id: string;
  sourceAlarmId: string;
  kind: "alarm" | "timer";
  name: string;
  sound: string;
  snooze: boolean;
  interval: number;
  at: number;
}

export interface TimerSetup {
  hours: number;
  minutes: number;
  seconds: number;
  name: string;
  sound: string;
}

export interface ClockState {
  version: 1;
  cities: string[];
  alarms: Alarm[];
  timers: Timer[];
  history: RecentTimer[];
  snoozes: Snooze[];
  stopwatch: StopwatchState;
  timerSetup: TimerSetup;
  /**
   * The city shown in the world clock's top panel and in the Clock widget (one of `cities`).
   * Absent: this device's own zone. Only Clock and its widget follow it: nothing else's time changes.
   */
  selected?: string;
}

/** One ring of the alarm/timer sheet. */
export interface RingEvent {
  /** Unique per ring (the queue and the notification use it). */
  key: string;
  kind: "alarm" | "timer";
  /** The alarm or timer it belongs to (a snooze points at its original alarm). */
  sourceId: string;
  name: string;
  sound: string;
  snooze: boolean;
  interval: number;
  /** When it was due. */
  at: number;
}

export const MAX_RECENT = 6;
export const MAX_NAME = 50;
/** Enough for real use, small enough for device storage. */
export const MAX_ALARMS = 100;
export const MAX_TIMERS = 30;

let seq = 0;
export function newId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A new account starts with the four Russian cities of the original app, no
 * alarm (none is made up for the person), no timers and a 25 minute timer
 * setup on the drums.
 */
export function defaultState(): ClockState {
  return {
    version: 1,
    cities: [...DEFAULT_CITIES],
    alarms: [],
    timers: [],
    history: [],
    snoozes: [],
    stopwatch: { elapsed: 0, running: false, startedAt: 0 },
    timerSetup: { hours: 0, minutes: 25, seconds: 0, name: "", sound: DEFAULT_SOUND },
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.slice(0, MAX_NAME) : fallback);
const sound = (v: unknown) => (isSoundId(v) ? v : DEFAULT_SOUND);
const interval = (v: unknown) => ((SNOOZE_INTERVALS as readonly number[]).includes(v as number) ? (v as number) : 9);
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Whatever was saved (another version, a damaged entry) becomes a valid
 * state: unknown cities, malformed alarms and timers are dropped, numbers are
 * clamped, unknown sounds become Alert B. Laps of the original stopwatch are
 * not kept (Voidex Clock has none).
 */
export function normalizeState(saved: unknown): ClockState {
  const base = defaultState();
  if (!isObj(saved)) return base;
  const cities = Array.isArray(saved.cities) ? [...new Set(saved.cities.filter(isKnownZone))] : base.cities;
  const alarms: Alarm[] = (Array.isArray(saved.alarms) ? saved.alarms : [])
    .filter((a): a is Record<string, unknown> => isObj(a) && isTime(a.time) && Array.isArray(a.days) && typeof a.id === "string")
    .slice(0, MAX_ALARMS)
    .map((a) => ({
      id: String(a.id),
      time: String(a.time),
      name: str(a.name),
      days: [...new Set((a.days as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort(),
      enabled: a.enabled === true,
      sound: sound(a.sound),
      snooze: a.snooze !== false,
      interval: interval(a.interval),
      nextAt: a.enabled === true && typeof a.nextAt === "number" ? a.nextAt : null,
    }));
  const timers: Timer[] = (Array.isArray(saved.timers) ? saved.timers : [])
    .filter((t): t is Record<string, unknown> => isObj(t) && typeof t.id === "string" && typeof t.duration === "number" && t.duration >= MIN_TIMER_MS && t.duration <= MAX_TIMER_MS)
    .slice(0, MAX_TIMERS)
    .map((t) => {
      const duration = t.duration as number;
      return {
        id: String(t.id),
        name: str(t.name),
        sound: sound(t.sound),
        duration,
        remaining: num(t.remaining, 0, duration, duration),
        endsAt: num(t.endsAt, 0, Number.MAX_SAFE_INTEGER, 0),
        running: t.running === true && typeof t.endsAt === "number",
      };
    });
  const history: RecentTimer[] = (Array.isArray(saved.history) ? saved.history : [])
    .filter((h): h is Record<string, unknown> => isObj(h) && typeof h.duration === "number" && h.duration >= MIN_TIMER_MS && h.duration <= MAX_TIMER_MS)
    .slice(0, MAX_RECENT)
    .map((h) => ({ name: str(h.name), sound: sound(h.sound), duration: h.duration as number }));
  const snoozes: Snooze[] = (Array.isArray(saved.snoozes) ? saved.snoozes : [])
    .filter((s): s is Record<string, unknown> => isObj(s) && typeof s.id === "string" && typeof s.at === "number")
    .map((s) => ({
      id: String(s.id),
      sourceAlarmId: String(s.sourceAlarmId ?? s.id),
      kind: s.kind === "timer" ? "timer" : "alarm",
      name: str(s.name),
      sound: sound(s.sound),
      snooze: s.snooze !== false,
      interval: interval(s.interval),
      at: s.at as number,
    }));
  const sw = isObj(saved.stopwatch) ? saved.stopwatch : {};
  const stopwatch: StopwatchState = { elapsed: num(sw.elapsed, 0, Number.MAX_SAFE_INTEGER, 0), running: sw.running === true && typeof sw.startedAt === "number", startedAt: num(sw.startedAt, 0, Number.MAX_SAFE_INTEGER, 0) };
  const ts = isObj(saved.timerSetup) ? saved.timerSetup : {};
  const timerSetup: TimerSetup = { hours: num(ts.hours, 0, 23, 0), minutes: num(ts.minutes, 0, 59, 25), seconds: num(ts.seconds, 0, 59, 0), name: str(ts.name), sound: sound(ts.sound) };
  const out: ClockState = { version: 1, cities, alarms, timers, history, snoozes, stopwatch, timerSetup };
  if (typeof saved.selected === "string" && cities.includes(saved.selected)) out.selected = saved.selected;
  return out;
}

// ---------------------------------------------------------------------------
// Alarms

/** The editor's starting point for a new alarm. It is a draft: nothing is on until it is saved. */
export function newAlarmDraft(): Alarm {
  // Step 2.15: no day chosen = rings once, at the next such time (today or tomorrow); days make it repeat.
  return { id: newId(), time: "07:00", name: "", days: [], enabled: false, sound: DEFAULT_SOUND, snooze: true, interval: 9, nextAt: null };
}

/** A saved alarm is on and scheduled. Throws when the time cannot ring. */
export function prepareAlarm(draft: Alarm, now = Date.now()): Alarm {
  const record: Alarm = { ...draft, name: draft.name.trim().slice(0, MAX_NAME), days: [...new Set(draft.days)].sort(), interval: interval(draft.interval), sound: sound(draft.sound), enabled: true };
  record.nextAt = nextAlarm(record, now);
  if (!record.nextAt) throw new Error("bad-time");
  return record;
}

export function putAlarm(state: ClockState, record: Alarm): ClockState {
  const i = state.alarms.findIndex((a) => a.id === record.id);
  if (i < 0 && state.alarms.length >= MAX_ALARMS) throw new Error("too-many");
  const alarms = i >= 0 ? state.alarms.map((a) => (a.id === record.id ? record : a)) : [...state.alarms, record];
  // Saving again replaces a pending snooze of the old version.
  return { ...state, alarms, snoozes: state.snoozes.filter((s) => s.sourceAlarmId !== record.id) };
}

export function setAlarmEnabled(state: ClockState, id: string, enabled: boolean, now = Date.now()): ClockState {
  return {
    ...state,
    alarms: state.alarms.map((a) => (a.id === id ? { ...a, enabled, nextAt: enabled ? nextAlarm(a, now) : null } : a)),
    snoozes: enabled ? state.snoozes : state.snoozes.filter((s) => s.sourceAlarmId !== id),
  };
}

export function deleteAlarm(state: ClockState, id: string): ClockState {
  return { ...state, alarms: state.alarms.filter((a) => a.id !== id), snoozes: state.snoozes.filter((s) => s.sourceAlarmId !== id && s.id !== id) };
}

/** The alarm that rings first (with its time), if any is on. */
export function upcomingAlarm(state: ClockState, now = Date.now()): { alarm: Alarm; at: number } | null {
  let best: { alarm: Alarm; at: number } | null = null;
  for (const a of state.alarms) {
    if (!a.enabled) continue;
    const at = a.nextAt && a.nextAt > now ? a.nextAt : nextAlarm(a, now);
    if (at && (!best || at < best.at)) best = { alarm: a, at };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Timers

export const setupDuration = (s: Pick<TimerSetup, "hours" | "minutes" | "seconds">) => (s.hours * 3600 + s.minutes * 60 + s.seconds) * 1000;

/** Starts a timer (1 second to 24 hours) and puts it on top of «Недавние» (no duplicates, 6 at most). */
export function startTimer(state: ClockState, input: { duration: number; name: string; sound: string }, now = Date.now(), id = newId()): { state: ClockState; timer: Timer } {
  const { duration } = input;
  if (!Number.isFinite(duration) || duration < MIN_TIMER_MS || duration > MAX_TIMER_MS) throw new Error("bad-duration");
  if (state.timers.length >= MAX_TIMERS) throw new Error("too-many");
  const name = input.name.trim().slice(0, MAX_NAME);
  const snd = sound(input.sound);
  const timer: Timer = { id, name, duration, remaining: duration, running: true, endsAt: now + duration, sound: snd };
  const history = [{ name, duration, sound: snd }, ...state.history.filter((t) => !(t.duration === duration && t.name === name && t.sound === snd))].slice(0, MAX_RECENT);
  return { state: { ...state, timers: [...state.timers, timer], history }, timer };
}

/** Pause keeps what is left; resume sets a new deadline from it. */
export function toggleTimer(state: ClockState, id: string, now = Date.now()): ClockState {
  return {
    ...state,
    timers: state.timers.map((t) => (t.id !== id ? t : t.running ? { ...t, remaining: timerRemaining(t, now), running: false } : { ...t, endsAt: now + t.remaining, running: true })),
  };
}

export function resetTimer(state: ClockState, id: string): ClockState {
  return { ...state, timers: state.timers.map((t) => (t.id === id ? { ...t, remaining: t.duration, running: false } : t)) };
}

export function removeTimer(state: ClockState, id: string): ClockState {
  return { ...state, timers: state.timers.filter((t) => t.id !== id), snoozes: state.snoozes.filter((s) => s.sourceAlarmId !== id) };
}

export function removeRecent(state: ClockState, index: number): ClockState {
  return { ...state, history: state.history.filter((_, i) => i !== index) };
}

export function setTimerSetup(state: ClockState, patch: Partial<TimerSetup>): ClockState {
  return { ...state, timerSetup: { ...state.timerSetup, ...patch } };
}

// ---------------------------------------------------------------------------
// Stopwatch (Start / Pause and Reset only)

export function toggleStopwatch(state: ClockState, now = Date.now()): ClockState {
  const sw = state.stopwatch;
  return { ...state, stopwatch: sw.running ? { elapsed: stopwatchElapsed(sw, now), running: false, startedAt: 0 } : { elapsed: sw.elapsed, running: true, startedAt: now } };
}

export function resetStopwatch(state: ClockState): ClockState {
  return { ...state, stopwatch: { elapsed: 0, running: false, startedAt: 0 } };
}

// ---------------------------------------------------------------------------
// World clock

export function addCity(state: ClockState, zone: string): ClockState {
  if (!isKnownZone(zone) || state.cities.includes(zone)) return state;
  return { ...state, cities: [...state.cities, zone] };
}

export function removeCity(state: ClockState, zone: string): ClockState {
  const next: ClockState = { ...state, cities: state.cities.filter((c) => c !== zone) };
  // The removed city is no longer shown on top: the device's own time is.
  if (next.selected === zone) delete next.selected;
  return next;
}

/** A1: one city at a time in the top panel; a city that is not in the list is ignored. */
export function selectCity(state: ClockState, zone: string): ClockState {
  if (!state.cities.includes(zone) || state.selected === zone) return state;
  return { ...state, selected: zone };
}

/** The zone the top panel and the widget show: the selected city, else this device's zone. */
export function shownZone(state: Pick<ClockState, "selected" | "cities">, deviceZone: string): string {
  return state.selected && state.cities.includes(state.selected) ? state.selected : deviceZone;
}

// ---------------------------------------------------------------------------
// Scheduler

/**
 * One pass of the scheduler (every 250 ms while VOIDEX is open, and when the
 * tab comes back). Alarms that are due ring; an alarm found more than five
 * minutes late (the device slept, VOIDEX was closed) is reported as missed
 * instead of ringing out of the blue. A repeating alarm moves to its next
 * day, a one-time alarm turns itself off. Finished timers leave the list and
 * ring; due snoozes ring once more.
 */
export function tick(state: ClockState, now = Date.now()): { state: ClockState; rings: RingEvent[]; missed: Alarm[]; changed: boolean } {
  const rings: RingEvent[] = [];
  const missed: Alarm[] = [];
  let changed = false;
  const alarms = state.alarms.map((a) => {
    if (!a.enabled) return a;
    let next = a;
    if (!next.nextAt) {
      next = { ...next, nextAt: nextAlarm(next, now) };
      changed = true;
    }
    if (next.nextAt !== null && next.nextAt <= now) {
      if (now - next.nextAt < LATE_RING_MS) rings.push({ key: `${next.id}:${next.nextAt}`, kind: "alarm", sourceId: next.id, name: next.name, sound: next.sound, snooze: next.snooze, interval: next.interval, at: next.nextAt });
      else missed.push(next);
      next = next.days.length ? { ...next, nextAt: nextAlarm(next, now) } : { ...next, enabled: false, nextAt: null };
      changed = true;
    }
    return next;
  });
  const timers = state.timers.filter((t) => {
    if (t.running && t.endsAt <= now) {
      rings.push({ key: `${t.id}:${t.endsAt}`, kind: "timer", sourceId: t.id, name: t.name, sound: t.sound, snooze: false, interval: 0, at: t.endsAt });
      changed = true;
      return false;
    }
    return true;
  });
  const snoozes = state.snoozes.filter((s) => {
    if (s.at <= now) {
      rings.push({ key: `${s.id}:${s.at}`, kind: s.kind, sourceId: s.sourceAlarmId, name: s.name, sound: s.sound, snooze: s.snooze, interval: s.interval, at: s.at });
      changed = true;
      return false;
    }
    return true;
  });
  return { state: changed ? { ...state, alarms, timers, snoozes } : state, rings, missed, changed };
}

/** «Ещё N минут»: the same ring comes back after its interval; it still belongs to its alarm. */
export function snoozeRing(state: ClockState, ring: RingEvent, now = Date.now(), id = newId()): ClockState {
  if (!ring.snooze || ring.interval <= 0) return state;
  const s: Snooze = { id, sourceAlarmId: ring.sourceId, kind: ring.kind, name: ring.name, sound: ring.sound, snooze: ring.snooze, interval: ring.interval, at: now + ring.interval * 60000 };
  return { ...state, snoozes: [...state.snoozes, s] };
}
