import { useMemo, useState } from "react";
import { addCity, cityClock, cityName, handAngles, isDaytime, localZone, offsetFromMoscow, removeCity, searchCities } from "@voidex/clock";
import { useLanguage } from "@/lib/i18n";
import { ClockIcon } from "./icons";
import { change, useClock } from "./runtime";
import { useClockT } from "./strings";
import { ClockSheet, SheetHeader, SwipeList, SwipeRow, useNow } from "./ui";

function offsetText(t: ReturnType<typeof useClockT>, zone: string, now: number) {
  const d = offsetFromMoscow(zone, now);
  if (d === 0) return t("world.same");
  return t("world.diff", { sign: d > 0 ? "+" : "−", n: String(Math.abs(d)).replace(".", ",") });
}

export function AnalogClock({ zone, now, size = "m" }: { zone: string; now: number; size?: "s" | "m" }) {
  const t = useClockT();
  const a = handAngles(zone, now);
  return (
    <div className={size === "s" ? "vc-analog vc-analog-s" : "vc-analog"} role="img" aria-label={t("world.clock", { time: cityClock(zone, now) })} data-testid="clock-analog">
      <div className="vc-face">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ transform: `rotate(${i * 30}deg)` }} />
        ))}
        <span className="n12">12</span>
        <span className="n3">3</span>
        <span className="n6">6</span>
        <span className="n9">9</span>
        <div className="vc-hand hour" style={{ transform: `rotate(${a.hour}deg)` }} data-testid="clock-hand-hour" />
        <div className="vc-hand minute" style={{ transform: `rotate(${a.minute}deg)` }} />
        <div className="vc-pin" />
      </div>
    </div>
  );
}

export function WorldPage({ wide }: { wide: boolean }) {
  const t = useClockT();
  const lang = useLanguage();
  const cities = useClock((s) => s.state.cities);
  const now = useNow(1000);
  const here = localZone();
  const date = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang, { weekday: "long", day: "numeric", month: "long" }).format(now);
  return (
    <div className="vc-page" data-testid="clock-world">
      <section className="vc-hero vc-world-hero">
        <div className="vc-hero-copy">
          <span className="vc-eyebrow">{t("world.eyebrow")}</span>
          <h2 data-testid="clock-here-name">{cityName(here, lang)}</h2>
          <div className="vc-hero-time" data-testid="clock-here-time">
            {cityClock(here, now)}
          </div>
          <p className="vc-hero-date">{date}</p>
        </div>
        <AnalogClock zone={here} now={now} size={wide ? "m" : "s"} />
      </section>
      <div className="vc-section-title">
        <h2>{t("world.cities")}</h2>
        <span>{cities.length}</span>
      </div>
      {cities.length ? (
        <SwipeList className="vc-grid vc-city-grid" testId="clock-city-list">
          {cities.map((zone) => {
            const name = cityName(zone, lang);
            const day = isDaytime(zone, now);
            return (
              <SwipeRow key={zone} id={zone} label={t("swipeHint", { name })} deleteLabel={t("deleteNamed", { name })} onDelete={() => change((s) => removeCity(s, zone))} testId="clock-city">
                <article className="vc-card vc-city-card" data-zone={zone}>
                  <span className="vc-city-symbol" title={t(day ? "world.day" : "world.night")}>
                    <ClockIcon name={day ? "sun" : "moon"} />
                  </span>
                  <span className="vc-city-copy">
                    <h3>{name}</h3>
                    <p data-testid="clock-city-offset">{offsetText(t, zone, now)}</p>
                  </span>
                  <time className="vc-city-time" data-testid="clock-city-time">
                    {cityClock(zone, now)}
                  </time>
                </article>
              </SwipeRow>
            );
          })}
        </SwipeList>
      ) : (
        <p className="vc-empty">{t("world.empty")}</p>
      )}
    </div>
  );
}

export function CityPicker({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const t = useClockT();
  const lang = useLanguage();
  const cities = useClock((s) => s.state.cities);
  const [q, setQ] = useState("");
  const now = useNow(30_000, open);
  const rows = useMemo(() => searchCities(q), [q]);
  const done = () => {
    setQ("");
    onClose();
  };
  return (
    <ClockSheet open={open} onClose={done} labelledBy="clock-city-title" phone={phone} testId="clock-city-picker">
      <SheetHeader id="clock-city-title" title={t("add.city")} onClose={done} closeLabel={t("close")} />
      <label className="vc-search">
        <ClockIcon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("world.search")} aria-label={t("world.search")} autoComplete="off" data-autofocus data-testid="clock-city-search" />
      </label>
      <div className="vc-sheet-scroll">
        {rows.length ? (
          rows.map((c) => {
            const added = cities.includes(c.zone);
            return (
              <button
                key={c.zone}
                type="button"
                className="vc-city-option"
                disabled={added}
                aria-label={added ? `${cityName(c.zone, lang)}. ${t("world.added")}` : `${t("add.city")}: ${cityName(c.zone, lang)}`}
                onClick={() => {
                  change((s) => addCity(s, c.zone));
                  done();
                }}
                data-testid="clock-city-option"
                data-zone={c.zone}
              >
                <span className="min-w-0">
                  <strong>{lang === "ru" ? c.ru : c.en}</strong>
                  <small>{c.zone}</small>
                </span>
                <span className="vc-city-option-end">
                  <span className="tabular-nums">{cityClock(c.zone, now)}</span>
                  <ClockIcon name={added ? "check" : "plus"} />
                </span>
              </button>
            );
          })
        ) : (
          <p className="vc-empty small">{t("world.nothing")}</p>
        )}
      </div>
    </ClockSheet>
  );
}
