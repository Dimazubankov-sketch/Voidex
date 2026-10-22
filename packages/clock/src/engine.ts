/**
 * Voidex Clock engine (ported from Voidex-Clock dist/engine.js): pure time
 * maths, no DOM. Alarms follow the wall clock of the device (setHours on a
 * local Date), so they keep their hour across DST changes; timers and the
 * stopwatch count against absolute deadlines (Date.now()), so a background
 * tab or a sleeping device never makes them drift.
 */

export interface AlarmTime {
  /** "HH:MM", 24 h. */
  time: string;
  /** Days of the week it repeats on (0 = Sunday ... 6 = Saturday); empty = once. */
  days: readonly number[];
}

/** The next moment (ms) the alarm rings after `now`, or null when the time is malformed. */
export function nextAlarm(alarm: AlarmTime, now = Date.now()): number | null {
  const [h, m] = alarm.time.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h! < 0 || h! > 23 || m! < 0 || m! > 59) return null;
  const base = new Date(now);
  for (let day = 0; day < 9; day++) {
    const c = new Date(base);
    c.setDate(base.getDate() + day);
    c.setHours(h!, m!, 0, 0);
    if (c.getTime() > now && (!alarm.days.length || alarm.days.includes(c.getDay()))) return c.getTime();
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 154680 → "02:34" (or "02:34.68" with centiseconds); hours appear only when there are any. */
export function durationText(ms: number, centiseconds = false): string {
  const value = Math.max(0, Math.floor(ms));
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? pad(hours) + ":" : ""}${pad(minutes)}:${pad(seconds % 60)}${centiseconds ? "." + pad(Math.floor((value % 1000) / 10)) : ""}`;
}

export interface StopwatchState {
  elapsed: number;
  running: boolean;
  startedAt: number;
}

export const stopwatchElapsed = (state: StopwatchState, now = Date.now()) => (state.elapsed || 0) + (state.running ? Math.max(0, now - state.startedAt) : 0);

export interface TimerClock {
  running: boolean;
  endsAt?: number;
  remaining?: number;
}

export const timerRemaining = (timer: TimerClock, now = Date.now()) => (timer.running ? Math.max(0, (timer.endsAt ?? 0) - now) : (timer.remaining ?? 0));

/** "11:31" in the given IANA zone. */
export function cityClock(zone: string, now: number | Date = Date.now(), locale = "ru-RU"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Wall-clock parts of a moment in a zone. */
function zoneParts(zone: string, now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Hours between a zone and Moscow right now (DST included): +4, -7.5, 0 ... */
export function offsetFromMoscow(zone: string, now = Date.now()): number {
  const epoch = (p: ReturnType<typeof zoneParts>) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return (epoch(zoneParts(zone, now)) - epoch(zoneParts("Europe/Moscow", now))) / 3600000;
}

/** Day (07:00 to 20:00) or night in a zone: the sun or the moon of the city card. */
export function isDaytime(zone: string, now = Date.now()): boolean {
  const hour = zoneParts(zone, now).hour;
  return hour >= 7 && hour < 20;
}

/** Angles of the analog clock hands (degrees) for a zone. */
export function handAngles(zone: string, now = Date.now()): { hour: number; minute: number; second: number } {
  const p = zoneParts(zone, now);
  // Milliseconds are the same in every zone (offsets are whole minutes): they make the hands glide.
  const ms = ((now % 1000) + 1000) % 1000;
  const sec = p.second + ms / 1000;
  return { hour: (p.hour % 12) * 30 + p.minute / 2 + sec / 120, minute: p.minute * 6 + sec / 10, second: sec * 6 };
}

/** The device's own zone (falls back to Moscow when the browser does not tell). */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
  } catch {
    return "Europe/Moscow";
  }
}

export interface RepeatLabels {
  once: string;
  everyDay: string;
  weekdays: string;
  weekend: string;
  /** Short day names, index 0 = Sunday. */
  short: readonly string[];
}

export const RU_REPEAT: RepeatLabels = { once: "Один раз", everyDay: "Каждый день", weekdays: "По будням", weekend: "По выходным", short: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] };

/** "Один раз", "Каждый день", "По будням" or "Пн · Ср · Пт" (Monday first). */
export function repeatLabel(days: readonly number[], labels: RepeatLabels = RU_REPEAT): string {
  const set = new Set(days);
  if (!set.size) return labels.once;
  if (set.size === 7) return labels.everyDay;
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return labels.weekdays;
  if (set.size === 2 && set.has(0) && set.has(6)) return labels.weekend;
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => set.has(d))
    .map((d) => labels.short[d])
    .join(" · ");
}

/** Minutes until a moment, split for "через 8 ч 5 мин" (at least one minute). */
export function untilParts(at: number, now = Date.now()): { hours: number; minutes: number } {
  const total = Math.max(1, Math.ceil((at - now) / 60000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export const MAX_TIMER_MS = 24 * 3600 * 1000;
export const MIN_TIMER_MS = 1000;
/** An alarm found overdue by less than this (the tab was asleep) still rings; older ones are reported as missed. */
export const LATE_RING_MS = 5 * 60 * 1000;
export const SNOOZE_INTERVALS = [1, 3, 5, 9, 10, 15] as const;
