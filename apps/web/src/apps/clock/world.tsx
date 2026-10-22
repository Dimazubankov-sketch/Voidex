import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { addCity, cityClock, cityName, isDaytime, offsetFromMoscow, removeCity, searchCities, selectCity } from "@voidex/clock";
import { AnalogFace, useShownZone } from "./analog";
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

export function WorldPage({ wide }: { wide: boolean }) {
  const t = useClockT();
  const lang = useLanguage();
  const cities = useClock((s) => s.state.cities);
  const selected = useClock((s) => s.state.selected);
  const now = useNow(1000);
  const zone = useShownZone();
  const reduced = useReducedMotion();
  const locale = lang === "ru" ? "ru-RU" : lang;
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(now);
  // A1: the new city comes in with a short rise and fade; the panel keeps its height (no jump, no flash).
  const enter = reduced ? { opacity: 1 } : { opacity: 0, y: 8 };
  return (
    <div className="vc-page" data-testid="clock-world">
      <section className="vc-hero vc-world-hero" data-testid="clock-world-hero" data-zone={zone}>
        <div className="vc-hero-copy vc-hero-swap">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={zone} initial={enter} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <span className="vc-eyebrow">{t(selected ? "world.selected" : "world.eyebrow")}</span>
              <h2 data-testid="clock-here-name">{cityName(zone, lang)}</h2>
              <div className="vc-hero-time" data-testid="clock-here-time">
                {cityClock(zone, now)}
              </div>
              <p className="vc-hero-date">{date}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <AnalogFace zone={zone} size={wide ? "m" : "s"} label={t("world.clock", { time: `${cityName(zone, lang)}, ${cityClock(zone, now)}` })} />
      </section>
      <div className="vc-section-title">
        <h2>{t("world.cities")}</h2>
        <span>{cities.length}</span>
      </div>
      {cities.length ? (
        <SwipeList className="vc-grid vc-city-grid" testId="clock-city-list">
          {cities.map((c) => {
            const name = cityName(c, lang);
            const day = isDaytime(c, now);
            const on = c === zone && !!selected;
            return (
              <SwipeRow key={c} id={c} label={t("swipeHint", { name })} deleteLabel={t("deleteNamed", { name })} onDelete={() => change((s) => removeCity(s, c))} testId="clock-city">
                <button
                  type="button"
                  className={on ? "vc-card vc-city-card is-selected" : "vc-card vc-city-card"}
                  data-zone={c}
                  aria-pressed={on}
                  aria-label={t("world.select", { name })}
                  onClick={() => change((s) => selectCity(s, c))}
                  data-testid="clock-city-select"
                >
                  <span className="vc-city-symbol" title={t(day ? "world.day" : "world.night")}>
                    <ClockIcon name={day ? "sun" : "moon"} />
                  </span>
                  <span className="vc-city-copy">
                    <h3>{name}</h3>
                    <p data-testid="clock-city-offset">{offsetText(t, c, now)}</p>
                  </span>
                  <time className="vc-city-time" data-testid="clock-city-time">
                    {cityClock(c, now)}
                  </time>
                </button>
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
