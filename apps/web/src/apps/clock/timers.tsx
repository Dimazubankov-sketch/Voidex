import { useEffect, useRef, useState } from "react";
import {
  durationText,
  flushWheels,
  removeRecent,
  removeTimerVia,
  resetStopwatch,
  resetTimer,
  setTimerSetup,
  setupDuration,
  soundById,
  startTimerVia,
  stopwatchElapsed,
  timerRemaining,
  toggleStopwatch,
  toggleTimerVia,
  type TimerSetup,
} from "@voidex/clock";
import { cx } from "@/lib/cx";
import { ClockIcon } from "./icons";
import { change, changeVia, useClock } from "./runtime";
import { SoundPicker } from "./sounds";
import { useClockT } from "./strings";
import { ClockSheet, SwipeList, SwipeRow, useNow, Wheel } from "./ui";

/** Stopwatch: Start / Pause and Reset. No laps. */
export function StopwatchPage() {
  const t = useClockT();
  const sw = useClock((s) => s.state.stopwatch);
  const now = useNow(sw.running ? 50 : 1000);
  const elapsed = stopwatchElapsed(sw, now);
  const C = 2 * Math.PI * 147;
  return (
    <div className="vc-page vc-stopwatch" data-testid="clock-stopwatch" data-running={sw.running ? "true" : "false"}>
      <section className="vc-dial">
        <svg className="vc-dial-svg" viewBox="0 0 320 320" aria-hidden="true">
          <circle className="vc-dial-track" cx="160" cy="160" r="147" />
          <circle className="vc-dial-arc" cx="160" cy="160" r="147" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - (elapsed % 60000) / 60000) }} />
        </svg>
        <div className="vc-dial-values">
          <span className="vc-eyebrow">{t("sw.eyebrow")}</span>
          <div className="vc-stopwatch-time" role="timer" aria-live="off" data-testid="clock-stopwatch-time">
            {durationText(elapsed, true)}
          </div>
          <span className="vc-unit-label">{t("sw.units")}</span>
        </div>
      </section>
      <div className="vc-round-controls">
        <button type="button" className="vc-round secondary" onClick={() => change(resetStopwatch)} aria-label={t("sw.resetLabel")} data-testid="clock-stopwatch-reset">
          <ClockIcon name="reset" />
          <span>{t("sw.reset")}</span>
        </button>
        <button type="button" className="vc-round primary" onClick={() => change((s) => toggleStopwatch(s))} data-testid="clock-stopwatch-toggle">
          <ClockIcon name={sw.running ? "pause" : "play"} />
          <span>{sw.running ? t("sw.pause") : elapsed > 0 ? t("sw.resume") : t("sw.start")}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Timers: the drums are the page (no «+», no presets): set h / m / s, a
 * name and a sound, start. Several timers run at once; «Недавние» start an
 * earlier one again. The countdown always comes from its deadline.
 */
export function TimersPage({ phone, wide, focus }: { phone: boolean; wide: boolean; focus: string | null }) {
  const t = useClockT();
  const saved = useClock((s) => s.state.timerSetup);
  const timers = useClock((s) => s.state.timers);
  const history = useClock((s) => s.state.history);
  const [setup, setSetup] = useState<TimerSetup>(saved);
  const ref = useRef(setup);
  const composer = useRef<HTMLDivElement>(null);
  const [sounds, setSounds] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const now = useNow(250, timers.some((x) => x.running));

  const update = (patch: Partial<TimerSetup>) => {
    ref.current = { ...ref.current, ...patch };
    setSetup(ref.current);
    // As in Voidex-Clock: the drums are remembered a moment after they stop.
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => change((s) => setTimerSetup(s, ref.current)), 180);
  };
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      change((s) => setTimerSetup(s, ref.current));
    },
    [],
  );

  const start = async () => {
    if (composer.current) flushWheels(composer.current as never);
    const s = ref.current;
    change((st) => setTimerSetup(st, s));
    await changeVia("timer:new", (st, sch) => startTimerVia(sch, st, { duration: setupDuration(s), name: s.name, sound: s.sound }));
  };

  const composerBlock = (
    <section className="vc-timer-composer" ref={composer} data-testid="clock-timer-composer">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="vc-wheel-panel vc-timer-wheel-panel">
          <div className="vc-wheel-columns vc-timer-wheels">
            <Wheel name="hours" label={t("hours")} unit={t("unit.h")} value={setup.hours} count={24} padded={false} onChange={(v) => update({ hours: v })} testId="clock-wheel-hours" />
            <Wheel name="minutes" label={t("minutes")} unit={t("unit.m")} value={setup.minutes} count={60} padded={false} onChange={(v) => update({ minutes: v })} testId="clock-wheel-minutes" />
            <Wheel name="seconds" label={t("seconds")} unit={t("unit.s")} value={setup.seconds} count={60} padded={false} onChange={(v) => update({ seconds: v })} testId="clock-wheel-seconds" />
          </div>
        </div>
        <div className="vc-round-controls">
          <button type="button" className="vc-round secondary small" onClick={() => update({ hours: 0, minutes: 0, seconds: 0 })} aria-label={t("timer.clear")} data-testid="clock-timer-clear">
            <ClockIcon name="x" />
          </button>
          <button type="submit" className="vc-round primary small" aria-label={t("timer.start")} data-testid="clock-timer-start">
            <ClockIcon name="play" />
          </button>
        </div>
        <div className="vc-form-card">
          <label className="vc-form-row">
            <span>{t("timer.name")}</span>
            <input value={setup.name} maxLength={50} placeholder={t("timer.default")} onChange={(e) => update({ name: e.target.value })} data-testid="clock-timer-name" />
          </label>
          <button type="button" className="vc-form-row" onClick={() => setSounds(true)} data-testid="clock-timer-sound">
            <span>{t("timer.sound")}</span>
            <span className="vc-form-value">
              {soundById(setup.sound).name}
              <ClockIcon name="next" />
            </span>
          </button>
        </div>
      </form>
    </section>
  );

  const lists = (
    <div className="vc-timer-lists">
      {timers.length > 0 && (
        <section data-testid="clock-timers-current">
          <div className="vc-section-title">
            <h2>{t("timer.current")}</h2>
            <span>{timers.length}</span>
          </div>
          <SwipeList className="vc-grid vc-timer-grid">
            {timers.map((x) => {
              const left = timerRemaining(x, now);
              const name = x.name || t("timer.default");
              const C = 2 * Math.PI * 22;
              return (
                <SwipeRow key={x.id} id={x.id} label={t("swipeHint", { name })} deleteLabel={t("deleteNamed", { name })} onDelete={() => void changeVia(`timer:${x.id}`, (s, sch) => removeTimerVia(sch, s, x.id))} testId="clock-timer" focused={focus === x.id}>
                  <article className={cx("vc-card vc-running-timer", !x.running && "paused")} data-timer={x.id} data-running={x.running ? "true" : "false"}>
                    <svg className="vc-timer-ring" viewBox="0 0 52 52" aria-hidden="true">
                      <circle cx="26" cy="26" r="22" className="track" />
                      <circle cx="26" cy="26" r="22" className="arc" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - left / x.duration) }} />
                    </svg>
                    <div className="vc-running-copy">
                      <strong role="timer" data-testid="clock-timer-left">
                        {durationText(left)}
                      </strong>
                      <h3>{name}</h3>
                      <small>{x.running ? t("timer.of", { d: durationText(x.duration) }) : `${t("timer.paused")} · ${t("timer.of", { d: durationText(x.duration) })}`}</small>
                    </div>
                    <div className="vc-timer-controls">
                      <button type="button" className="vc-icon-button" onClick={() => change((s) => resetTimer(s, x.id))} aria-label={t("timer.reset", { name })} data-testid="clock-timer-reset">
                        <ClockIcon name="reset" />
                      </button>
                      <button
                        type="button"
                        className="vc-icon-button primary"
                        onClick={() => void changeVia(`timer:${x.id}`, (s, sch) => toggleTimerVia(sch, s, x.id))}
                        aria-label={t(x.running ? "timer.pause" : "timer.resume", { name })}
                        data-testid="clock-timer-toggle"
                      >
                        <ClockIcon name={x.running ? "pause" : "play"} />
                      </button>
                    </div>
                  </article>
                </SwipeRow>
              );
            })}
          </SwipeList>
        </section>
      )}
      {history.length > 0 && (
        <section data-testid="clock-timers-recent">
          <div className="vc-section-title">
            <h2>{t("timer.recent")}</h2>
          </div>
          <SwipeList className="vc-grid vc-timer-grid">
            {history.map((h, i) => {
              const name = h.name || t("timer.default");
              return (
                <SwipeRow key={`${h.duration}:${h.name}:${h.sound}`} id={`recent-${i}`} label={t("swipeHint", { name })} deleteLabel={t("deleteNamed", { name })} onDelete={() => change((s) => removeRecent(s, i))} testId="clock-recent">
                  <article className="vc-card vc-recent-timer">
                    <div className="min-w-0">
                      <strong className="vc-recent-duration">{durationText(h.duration)}</strong>
                      <h3>{name}</h3>
                    </div>
                    <button
                      type="button"
                      className="vc-icon-button primary"
                      onClick={() => void changeVia("timer:new", (s, sch) => startTimerVia(sch, s, { duration: h.duration, name: h.name, sound: h.sound }))}
                      aria-label={t("timer.restart", { name })}
                      data-testid="clock-recent-start"
                    >
                      <ClockIcon name="play" />
                    </button>
                  </article>
                </SwipeRow>
              );
            })}
          </SwipeList>
        </section>
      )}
    </div>
  );

  return (
    <div className={cx("vc-page vc-timers", wide && "vc-timers-wide")} data-testid="clock-timers">
      {composerBlock}
      {lists}
      <ClockSheet open={sounds} onClose={() => setSounds(false)} labelledBy="clock-sound-title" phone={phone} testId="clock-timer-sounds">
        <SoundPicker
          value={setup.sound}
          backIsClose
          onBack={() => setSounds(false)}
          onPick={(id) => {
            update({ sound: id });
            setSounds(false);
          }}
        />
      </ClockSheet>
    </div>
  );
}
