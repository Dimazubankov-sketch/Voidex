import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCity,
  defaultState,
  deleteAlarm,
  newAlarmDraft,
  normalizeState,
  removeCity,
  removeRecent,
  resetStopwatch,
  resetTimer,
  snoozeRing,
  startTimer,
  tick,
  toggleStopwatch,
  toggleTimer,
  upcomingAlarm,
  type ClockState,
} from "../src/model.ts";
import { browserScheduler, deleteAlarmVia, deviceClockStorage, nativeScheduler, pickScheduler, saveAlarmVia, setAlarmEnabledVia, snoozeVia, startTimerVia, type ClockSchedulerAdapter } from "../src/adapters.ts";
import { DEFAULT_SOUND } from "../src/sounds.ts";
import { nextAlarm } from "../src/engine.ts";

// The behaviours of Voidex-Clock tests/interactions.test.js, on the state model.

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo, d, h, mi, s).getTime();

function recording(fail = false) {
  const calls: [string, unknown][] = [];
  const bridge = {
    scheduleAlarm: async (a: unknown) => {
      calls.push(["scheduleAlarm", a]);
      if (fail) throw new Error("native refused");
    },
    cancelAlarm: async (id: string) => void calls.push(["cancelAlarm", id]),
    snoozeAlarm: async (s: unknown) => void calls.push(["snoozeAlarm", s]),
    scheduleTimer: async (t: unknown) => void calls.push(["scheduleTimer", t]),
    cancelTimer: async (id: string) => void calls.push(["cancelTimer", id]),
  };
  return { calls, scheduler: nativeScheduler(bridge) as ClockSchedulerAdapter };
}

test("a fresh Clock has no made-up alarm, four cities and the 25 minute timer on the drums", () => {
  const s = defaultState();
  assert.deepEqual(s.alarms, []);
  assert.equal(s.cities.length, 4);
  assert.deepEqual([s.timerSetup.hours, s.timerSetup.minutes, s.timerSetup.seconds], [0, 25, 0]);
  assert.equal(s.timerSetup.sound, DEFAULT_SOUND);
  assert.equal(upcomingAlarm(s), null);
});

test("new alarm defaults to Alert B, is off until saved, saves edits and supports enable/delete", async () => {
  const draft = newAlarmDraft();
  assert.equal(draft.sound, "reference-alert-b");
  assert.equal(draft.enabled, false);
  const now = at(2026, 9, 18, 8, 30);
  let s = defaultState();
  const saved = await saveAlarmVia(browserScheduler, s, { ...draft, time: "09:15", name: "  Работа  ", days: [] }, now);
  s = saved.state;
  assert.equal(s.alarms.length, 1);
  assert.equal(s.alarms[0]!.enabled, true);
  assert.equal(s.alarms[0]!.name, "Работа");
  assert.equal(s.alarms[0]!.nextAt, at(2026, 9, 18, 9, 15));
  // Edit: same id, replaced in place.
  s = (await saveAlarmVia(browserScheduler, s, { ...s.alarms[0]!, time: "10:00" }, now)).state;
  assert.equal(s.alarms.length, 1);
  assert.equal(s.alarms[0]!.time, "10:00");
  s = await setAlarmEnabledVia(browserScheduler, s, draft.id, false, now);
  assert.equal(s.alarms[0]!.enabled, false);
  assert.equal(s.alarms[0]!.nextAt, null);
  s = await setAlarmEnabledVia(browserScheduler, s, draft.id, true, now);
  assert.equal(s.alarms[0]!.nextAt, at(2026, 9, 18, 10, 0));
  s = await deleteAlarmVia(browserScheduler, s, draft.id);
  assert.deepEqual(s.alarms, []);
});

test("native schedule failure never saves a false success", async () => {
  const { calls, scheduler } = recording(true);
  const s = defaultState();
  await assert.rejects(saveAlarmVia(scheduler, s, newAlarmDraft(), at(2026, 9, 18, 8, 30)));
  assert.deepEqual(s.alarms, []);
  assert.equal(calls[0]![0], "scheduleAlarm");
  // The native shell receives the documented alarm shape.
  const sent = calls[0]![1] as Record<string, unknown>;
  for (const k of ["id", "time", "name", "days", "enabled", "sound", "snooze", "interval", "nextAt"]) assert.ok(k in sent, k);
});

test("the native bridge is used when the shell provides it; otherwise the browser fallback says it cannot ring in the background", async () => {
  assert.equal(pickScheduler({}).kind, "browser");
  assert.equal(pickScheduler({}).background, false);
  const { calls } = recording();
  const native = pickScheduler({ VoidexClock: { cancelAlarm: async (id: string) => void calls.push(["cancel", id]) } });
  assert.equal(native.kind, "native");
  // A call the bridge lacks is a no-op, never an exception.
  await native.scheduleTimer({ id: "t", name: "", sound: DEFAULT_SOUND, endsAt: 1 });
  await native.cancelAlarm("a");
  assert.deepEqual(calls, [["cancel", "a"]]);
});

test("timer pause/resume uses remaining duration and rings once at deadline", () => {
  const t0 = 1_000_000;
  let { state: s, timer } = startTimer(defaultState(), { duration: 60_000, name: "Чай", sound: DEFAULT_SOUND }, t0, "t1");
  assert.equal(timer.endsAt, t0 + 60_000);
  s = toggleTimer(s, "t1", t0 + 20_000);
  assert.equal(s.timers[0]!.running, false);
  assert.equal(s.timers[0]!.remaining, 40_000);
  // Paused: nothing rings however long it waits.
  assert.equal(tick(s, t0 + 500_000).rings.length, 0);
  s = toggleTimer(s, "t1", t0 + 500_000);
  assert.equal(s.timers[0]!.endsAt, t0 + 540_000);
  assert.equal(tick(s, t0 + 539_999).rings.length, 0);
  const r = tick(s, t0 + 540_000);
  assert.equal(r.rings.length, 1);
  assert.equal(r.rings[0]!.kind, "timer");
  assert.equal(r.rings[0]!.name, "Чай");
  assert.deepEqual(r.state.timers, []);
  // Once: the next pass has nothing left to ring.
  assert.equal(tick(r.state, t0 + 541_000).rings.length, 0);
});

test("several timers run at once; reset stops one; recent list keeps 6 without duplicates", () => {
  let s: ClockState = defaultState();
  for (let i = 1; i <= 8; i++) s = startTimer(s, { duration: i * 1000, name: `T${i}`, sound: DEFAULT_SOUND }, 0, `t${i}`).state;
  s = startTimer(s, { duration: 8000, name: "T8", sound: DEFAULT_SOUND }, 0, "t9").state;
  assert.equal(s.timers.length, 9);
  assert.equal(s.history.length, 6);
  assert.equal(s.history.filter((h) => h.name === "T8").length, 1);
  assert.equal(s.history[0]!.name, "T8");
  s = resetTimer(s, "t3");
  assert.equal(s.timers.find((t) => t.id === "t3")!.running, false);
  assert.equal(s.timers.find((t) => t.id === "t3")!.remaining, 3000);
  s = removeRecent(s, 0);
  assert.equal(s.history.length, 5);
  assert.throws(() => startTimer(s, { duration: 500, name: "", sound: DEFAULT_SOUND }), /bad-duration/);
  assert.throws(() => startTimer(s, { duration: 25 * 3600 * 1000, name: "", sound: DEFAULT_SOUND }), /bad-duration/);
});

test("stopwatch: start / pause / reset only, no laps, no drift while paused", () => {
  let s = toggleStopwatch(defaultState(), 1000);
  assert.equal(s.stopwatch.running, true);
  s = toggleStopwatch(s, 4500);
  assert.deepEqual(s.stopwatch, { elapsed: 3500, running: false, startedAt: 0 });
  s = toggleStopwatch(s, 10_000);
  s = toggleStopwatch(s, 10_250);
  assert.equal(s.stopwatch.elapsed, 3750);
  assert.ok(!("laps" in s.stopwatch));
  s = resetStopwatch(s);
  assert.deepEqual(s.stopwatch, { elapsed: 0, running: false, startedAt: 0 });
});

test("one-shot alarm disables after firing; snooze belongs to its original alarm", async () => {
  const now = at(2026, 9, 18, 6, 59);
  const { calls, scheduler } = recording();
  let s = (await saveAlarmVia(scheduler, defaultState(), { ...newAlarmDraft(), id: "a1", time: "07:00", days: [], name: "Подъём", interval: 5 }, now)).state;
  const r = tick(s, at(2026, 9, 18, 7, 0, 1));
  assert.equal(r.rings.length, 1);
  assert.equal(r.rings[0]!.sourceId, "a1");
  assert.equal(r.state.alarms[0]!.enabled, false);
  assert.equal(r.state.alarms[0]!.nextAt, null);
  s = await snoozeVia(scheduler, r.state, r.rings[0]!, at(2026, 9, 18, 7, 0, 5));
  assert.equal(s.snoozes.length, 1);
  assert.equal(s.snoozes[0]!.sourceAlarmId, "a1");
  assert.equal(s.snoozes[0]!.at, at(2026, 9, 18, 7, 5, 5));
  assert.equal(calls.at(-1)![0], "snoozeAlarm");
  // The snooze rings again as the same alarm, then is gone.
  const again = tick(s, at(2026, 9, 18, 7, 5, 5));
  assert.equal(again.rings[0]!.sourceId, "a1");
  assert.equal(again.rings[0]!.name, "Подъём");
  assert.deepEqual(again.state.snoozes, []);
  // Deleting the alarm drops its pending snooze too.
  assert.deepEqual(deleteAlarm(s, "a1").snoozes, []);
});

test("repeating alarm moves to its next day; an alarm found long overdue is missed, not rung", () => {
  const s0 = defaultState();
  const alarm = { ...newAlarmDraft(), id: "w", time: "07:00", days: [1, 2, 3, 4, 5], enabled: true, nextAt: at(2026, 9, 16, 7, 0) };
  const s = { ...s0, alarms: [alarm] };
  // Friday 07:00:30: rings, next is Monday.
  const r = tick(s, at(2026, 9, 16, 7, 0, 30));
  assert.equal(r.rings.length, 1);
  assert.equal(r.state.alarms[0]!.nextAt, at(2026, 9, 19, 7, 0));
  // Friday 09:00 (the device slept): missed, still rescheduled.
  const late = tick(s, at(2026, 9, 16, 9, 0));
  assert.equal(late.rings.length, 0);
  assert.equal(late.missed.length, 1);
  assert.equal(late.state.alarms[0]!.enabled, true);
  assert.equal(late.state.alarms[0]!.nextAt, at(2026, 9, 19, 7, 0));
});

test("snooze is offered only when the alarm repeats its signal", () => {
  const ring = { key: "k", kind: "alarm" as const, sourceId: "a", name: "", sound: DEFAULT_SOUND, snooze: false, interval: 9, at: 0 };
  const s = defaultState();
  assert.equal(snoozeRing(s, ring, 0), s);
  assert.equal(snoozeRing(s, { ...ring, snooze: true }, 0).snoozes.length, 1);
});

test("world clock: add once, remove; unknown zones never enter", () => {
  let s = addCity(defaultState(), "Asia/Tokyo");
  s = addCity(s, "Asia/Tokyo");
  assert.equal(s.cities.filter((c) => c === "Asia/Tokyo").length, 1);
  assert.equal(addCity(s, "Mars/Olympus"), s);
  s = removeCity(s, "Europe/Moscow");
  assert.ok(!s.cities.includes("Europe/Moscow"));
});

test("saved state is validated: damaged entries are dropped, laps forgotten, sounds known", () => {
  const s = normalizeState({
    cities: ["Europe/Moscow", "Nowhere/City", "Europe/Moscow"],
    alarms: [{ id: "ok", time: "07:30", days: [1, 9, 1], enabled: true, sound: "nope", interval: 4 }, { id: "bad", time: "7:30", days: [] }, null],
    timers: [{ id: "t", duration: 5000, remaining: 99999, running: false }, { id: "x", duration: 0 }],
    history: [{ name: "a", duration: 3000, sound: DEFAULT_SOUND }, { duration: -1 }],
    stopwatch: { elapsed: 1200, running: false, startedAt: 0, laps: [{ total: 1 }] },
    timerSetup: { hours: 99, minutes: -3, seconds: 12, name: "x".repeat(80) },
  });
  assert.deepEqual(s.cities, ["Europe/Moscow"]);
  assert.equal(s.alarms.length, 1);
  assert.deepEqual(s.alarms[0]!.days, [1]);
  assert.equal(s.alarms[0]!.sound, DEFAULT_SOUND);
  assert.equal(s.alarms[0]!.interval, 9);
  assert.equal(s.timers.length, 1);
  assert.equal(s.timers[0]!.remaining, 5000);
  assert.equal(s.history.length, 1);
  assert.ok(!("laps" in s.stopwatch));
  assert.deepEqual([s.timerSetup.hours, s.timerSetup.minutes, s.timerSetup.seconds], [23, 0, 12]);
  assert.equal(s.timerSetup.name.length, 50);
  assert.deepEqual(normalizeState("garbage"), defaultState());
});

test("device storage: one key per account, survives a reload, refuses quietly when full", async () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  const a = deviceClockStorage(store, "user-a");
  const b = deviceClockStorage(store, "user-b");
  assert.equal(a.load(), null);
  const s = await startTimerVia(browserScheduler, defaultState(), { duration: 5000, name: "A", sound: DEFAULT_SOUND });
  assert.equal(a.save(s), true);
  assert.equal(a.load()!.timers.length, 1);
  assert.equal(b.load(), null);
  assert.ok(a.bytes() > 50);
  const full = deviceClockStorage({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, "c");
  assert.equal(full.save(s), false);
});

test("Step 2.15: a new alarm has no day chosen: it rings once, at the next such time", () => {
  const draft = newAlarmDraft();
  assert.deepEqual(draft.days, []);
  // 07:00 now, set for 21:00: today at 21:00.
  const morning = new Date(2026, 9, 18, 7, 0, 0).getTime();
  assert.equal(nextAlarm({ ...draft, time: "21:00" }, morning), new Date(2026, 9, 18, 21, 0, 0).getTime());
  // 21:00 now, set for 07:00: tomorrow at 07:00.
  const evening = new Date(2026, 9, 18, 21, 0, 0).getTime();
  assert.equal(nextAlarm({ ...draft, time: "07:00" }, evening), new Date(2026, 9, 19, 7, 0, 0).getTime());
  // Monday chosen: every Monday (18 Oct 2026 is a Sunday → Monday 19th, then the 26th).
  assert.equal(nextAlarm({ ...draft, time: "07:00", days: [1] }, evening), new Date(2026, 9, 19, 7, 0, 0).getTime());
  assert.equal(nextAlarm({ ...draft, time: "07:00", days: [1] }, new Date(2026, 9, 19, 8, 0, 0).getTime()), new Date(2026, 9, 26, 7, 0, 0).getTime());
});
