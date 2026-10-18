import { test } from "node:test";
import assert from "node:assert/strict";
import { cityClock, durationText, handAngles, isDaytime, nextAlarm, offsetFromMoscow, repeatLabel, stopwatchElapsed, timerRemaining, untilParts } from "../src/engine.ts";
import { cityName, searchCities } from "../src/cities.ts";

// Ported from Voidex-Clock tests/engine.test.js.

test("one-shot alarm rolls into tomorrow after the chosen minute", () => {
  const now = new Date(2026, 9, 18, 8, 0).getTime();
  const next = nextAlarm({ time: "07:00", days: [] }, now)!;
  assert.equal(new Date(next).getDate(), 19);
  assert.equal(new Date(next).getHours(), 7);
});

test("weekday alarm skips weekend and exact current time", () => {
  const friday = new Date(2026, 9, 16, 7, 0).getTime();
  const next = nextAlarm({ time: "07:00", days: [1, 2, 3, 4, 5] }, friday)!;
  assert.equal(new Date(next).getDate(), 19);
  assert.equal(new Date(next).getDay(), 1);
});

test("repeating alarm: every listed day in turn, then back to the first", () => {
  const monday = new Date(2026, 9, 19, 9, 0).getTime();
  const wed = nextAlarm({ time: "08:30", days: [3, 5] }, monday)!;
  assert.equal(new Date(wed).getDay(), 3);
  const fri = nextAlarm({ time: "08:30", days: [3, 5] }, wed)!;
  assert.equal(new Date(fri).getDay(), 5);
  const wed2 = nextAlarm({ time: "08:30", days: [3, 5] }, fri)!;
  assert.equal(new Date(wed2).getDay(), 3);
  assert.equal(wed2 - wed, 7 * 24 * 3600 * 1000);
});

test("a malformed time never schedules", () => {
  assert.equal(nextAlarm({ time: "25:00", days: [] }, Date.now()), null);
  assert.equal(nextAlarm({ time: "7", days: [] }, Date.now()), null);
});

test("local wall-clock schedule follows DST where supported", () => {
  const before = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // The night DST ends in New York (2026-11-01): the alarm still rings at 07:00 wall time.
    const now = new Date(2026, 10, 1, 0, 15).getTime();
    const next = nextAlarm({ time: "07:00", days: [] }, now)!;
    assert.equal(new Date(next).getHours(), 7);
    assert.equal(new Date(next).getDate(), 1);
  } finally {
    if (before) process.env.TZ = before;
    else delete process.env.TZ;
  }
});

test("countdowns use deadlines and paused stopwatch does not drift", () => {
  assert.equal(timerRemaining({ running: true, endsAt: 10000 }, 7000), 3000);
  assert.equal(timerRemaining({ running: true, endsAt: 10000 }, 20000), 0);
  assert.equal(timerRemaining({ running: false, remaining: 3000 }, 99000), 3000);
  assert.equal(stopwatchElapsed({ running: true, elapsed: 2000, startedAt: 1000 }, 6000), 7000);
  assert.equal(stopwatchElapsed({ running: false, elapsed: 7000, startedAt: 0 }, 99000), 7000);
});

test("formatted time and actual timezone conversion", () => {
  assert.equal(durationText(154680, true), "02:34.68");
  assert.equal(durationText(3600000), "01:00:00");
  assert.equal(durationText(-12), "00:00");
  assert.equal(cityClock("Europe/Moscow", Date.UTC(2026, 9, 18, 8, 31)), "11:31");
  assert.equal(cityClock("Asia/Omsk", Date.UTC(2026, 9, 18, 8, 31)), "14:31");
});

test("difference from Moscow follows each city's DST; day and night; clock hands", () => {
  const winter = Date.UTC(2026, 0, 15, 12, 0);
  const summer = Date.UTC(2026, 6, 15, 12, 0);
  assert.equal(offsetFromMoscow("Europe/Moscow", winter), 0);
  assert.equal(offsetFromMoscow("Asia/Omsk", winter), 3);
  assert.equal(offsetFromMoscow("Europe/London", winter), -3);
  assert.equal(offsetFromMoscow("Europe/London", summer), -2);
  assert.equal(offsetFromMoscow("America/New_York", winter), -8);
  assert.equal(offsetFromMoscow("America/New_York", summer), -7);
  assert.equal(isDaytime("Europe/Moscow", Date.UTC(2026, 9, 18, 9, 0)), true);
  assert.equal(isDaytime("Europe/Moscow", Date.UTC(2026, 9, 18, 20, 0)), false);
  const h = handAngles("Europe/Moscow", Date.UTC(2026, 9, 18, 0, 30, 0));
  assert.equal(h.hour, 3 * 30 + 15);
  assert.equal(h.minute, 180);
});

test("repeat labels: once, every day, weekdays, weekend, Monday-first list", () => {
  assert.equal(repeatLabel([]), "Один раз");
  assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6]), "Каждый день");
  assert.equal(repeatLabel([1, 2, 3, 4, 5]), "По будням");
  assert.equal(repeatLabel([6, 0]), "По выходным");
  assert.equal(repeatLabel([0, 3, 1]), "Пн · Ср · Вс");
  assert.deepEqual(untilParts(Date.now() + 125 * 60000 - 10), { hours: 2, minutes: 5 });
});

test("cities: one row per zone, search in both languages, names per language", () => {
  const all = searchCities("");
  assert.equal(new Set(all.map((c) => c.zone)).size, all.length);
  assert.deepEqual(searchCities("тула").map((c) => c.zone), ["Europe/Moscow"]);
  assert.deepEqual(searchCities("tokyo").map((c) => c.zone), ["Asia/Tokyo"]);
  assert.equal(cityName("Asia/Shanghai", "ru"), "Пекин");
  assert.equal(cityName("Asia/Shanghai", "en"), "Beijing");
  assert.equal(cityName("America/Argentina/Buenos_Aires", "en"), "Buenos Aires");
});
