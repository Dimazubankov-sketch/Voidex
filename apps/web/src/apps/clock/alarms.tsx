import { useRef, useState } from "react";
import {
  deleteAlarmVia,
  flushWheels,
  newAlarmDraft,
  nextAlarm,
  repeatLabel,
  saveAlarmVia,
  setAlarmEnabledVia,
  SNOOZE_INTERVALS,
  soundById,
  untilParts,
  upcomingAlarm,
  type Alarm,
} from "@voidex/clock";
import { cx } from "@/lib/cx";
import { useLanguage } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { stopPreview } from "./audio";
import { ClockIcon } from "./icons";
import { changeVia, useClock } from "./runtime";
import { SoundPicker } from "./sounds";
import { repeatLabels, untilText, useClockT } from "./strings";
import { ClockSheet, SheetHeader, Switch, SwipeList, SwipeRow, useNow, Wheel } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
/** Monday first, as the day picker shows them. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function AlarmPage({ onEdit, onNew, focus }: { onEdit: (a: Alarm) => void; onNew: () => void; focus: string | null }) {
  const t = useClockT();
  const lang = useLanguage();
  const state = useClock((s) => s.state);
  const busy = useClock((s) => s.busy);
  const now = useNow(15_000);
  const next = upcomingAlarm(state, now);
  return (
    <div className="vc-page" data-testid="clock-alarms">
      <section className="vc-hero vc-alarm-hero" data-testid="clock-alarm-hero" data-state={next ? "next" : "none"}>
        <div className="vc-hero-copy">
          {next ? (
            <>
              <span className="vc-eyebrow">{t("alarm.next")}</span>
              <div className="vc-hero-time">{next.alarm.time}</div>
              <h2>{next.alarm.name || t("alarm.default")}</h2>
              <p className="vc-hero-date">{t("alarm.in", { time: untilText(lang, untilParts(next.at, now)) })}</p>
            </>
          ) : (
            <>
              <h2 className="vc-hero-none">{t("alarm.none")}</h2>
              <p className="vc-hero-date">{t("alarm.noneHint")}</p>
            </>
          )}
        </div>
        <div className="vc-sunrise" aria-hidden="true">
          <span />
          <i />
          <b />
        </div>
      </section>
      <div className="vc-section-title">
        <h2>{t("alarm.mine")}</h2>
        <span>{state.alarms.length}</span>
      </div>
      {state.alarms.length ? (
        <SwipeList className="vc-grid vc-alarm-grid" testId="clock-alarm-list">
          {state.alarms.map((a) => {
            const name = a.name || t("alarm.default");
            return (
              <SwipeRow
                key={a.id}
                id={a.id}
                label={t("swipeHint", { name: `${a.time} ${name}` })}
                deleteLabel={t("deleteNamed", { name })}
                onDelete={() => void changeVia(`alarm:${a.id}`, (s, sch) => deleteAlarmVia(sch, s, a.id))}
                testId="clock-alarm"
                focused={focus === a.id}
              >
                <article className={cx("vc-card vc-alarm-card", !a.enabled && "off")} data-alarm={a.id} data-enabled={a.enabled ? "true" : "false"}>
                  <button type="button" className="vc-alarm-open" onClick={() => onEdit(a)} data-testid="clock-alarm-open">
                    <span className="vc-alarm-time">{a.time}</span>
                    <strong>{name}</strong>
                    <small>{repeatLabel(a.days, repeatLabels(lang))}</small>
                    <span className="vc-alarm-sound">
                      <ClockIcon name="sound" />
                      {soundById(a.sound).name}
                    </span>
                  </button>
                  <Switch
                    checked={a.enabled}
                    disabled={busy.includes(`alarm:${a.id}`)}
                    label={t(a.enabled ? "alarm.off" : "alarm.on", { name })}
                    onChange={(v) => void changeVia(`alarm:${a.id}`, (s, sch) => setAlarmEnabledVia(sch, s, a.id, v))}
                    testId="clock-alarm-toggle"
                  />
                </article>
              </SwipeRow>
            );
          })}
        </SwipeList>
      ) : (
        <div className="vc-empty-block">
          <p className="vc-empty">{t("alarm.empty")}</p>
          <button type="button" className="vc-pill primary" onClick={onNew} data-testid="clock-alarm-create">
            <ClockIcon name="plus" />
            {t("alarm.create")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The alarm editor: the hour and minute drums, the days, the name, the
 * sound (its own page in the same sheet), «Повтор сигнала» and its
 * interval. Nothing changes until ✓: then the scheduler is asked first and
 * the alarm is saved on (a refused registration keeps everything as it was).
 */
export function AlarmEditor({ draft, onClose, phone }: { draft: Alarm | null; onClose: () => void; phone: boolean }) {
  return (
    <ClockSheet open={!!draft} onClose={() => (stopPreview(), onClose())} labelledBy="clock-alarm-title" phone={phone} testId="clock-alarm-editor">
      {draft && <AlarmForm key={draft.id} initial={draft} onClose={onClose} />}
    </ClockSheet>
  );
}

function AlarmForm({ initial, onClose }: { initial: Alarm; onClose: () => void }) {
  const t = useClockT();
  const lang = useLanguage();
  const exists = useClock((s) => s.state.alarms.some((a) => a.id === initial.id));
  const busy = useClock((s) => s.busy.includes(`alarm:${initial.id}`));
  const [draft, setDraftState] = useState<Alarm>(initial);
  const ref = useRef(draft);
  const root = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<"form" | "sounds">("form");
  const now = useNow(30_000);
  const set = (patch: Partial<Alarm>) => {
    ref.current = { ...ref.current, ...patch };
    setDraftState(ref.current);
  };
  const [h, m] = draft.time.split(":").map(Number) as [number, number];
  const setTime = (hh: number, mm: number) => set({ time: `${pad(hh)}:${pad(mm)}` });
  const at = nextAlarm(draft, now);

  const save = async () => {
    // A drum still snapping after a tap or a key: take the value it is going to.
    if (root.current) flushWheels(root.current as never);
    const record = ref.current;
    const ok = await changeVia(`alarm:${record.id}`, (s, sch) => saveAlarmVia(sch, s, record).then((r) => r.state));
    if (ok) {
      onClose();
      toast({ title: t("alarm.saved"), tone: "success" });
    }
  };

  if (page === "sounds")
    return (
      <SoundPicker
        value={draft.sound}
        onBack={() => setPage("form")}
        onPick={(id) => {
          set({ sound: id });
          setPage("form");
        }}
      />
    );

  return (
    <div
      ref={root}
      className="vc-editor"
      onKeyDown={(e) => {
        // Enter saves (not inside the name field's composition, not on a button that does its own thing).
        if (e.key === "Enter" && !e.nativeEvent.isComposing && !(e.target as HTMLElement).closest("button, select")) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <SheetHeader id="clock-alarm-title" title={exists ? t("alarm.title") : t("alarm.new")} onClose={onClose} closeLabel={t("close")} onSave={() => void save()} saveLabel={t("save")} saving={busy} />
      <div className="vc-sheet-scroll">
        <div className="vc-wheel-panel">
          <span className="vc-picker-caption">{t("alarm.wake")}</span>
          <div className="vc-wheel-columns vc-alarm-wheels">
            <Wheel name="alarmHours" label={t("hours")} value={h} count={24} onChange={(v) => setTime(v, Number(ref.current.time.split(":")[1]))} testId="clock-wheel-alarm-hours" />
            <span className="vc-wheel-colon" aria-hidden="true">
              :
            </span>
            <Wheel name="alarmMinutes" label={t("minutes")} value={m} count={60} onChange={(v) => setTime(Number(ref.current.time.split(":")[0]), v)} testId="clock-wheel-alarm-minutes" />
          </div>
        </div>
        <div className="vc-form-card">
          <div className="vc-form-title">
            <strong>{t("alarm.repeat")}</strong>
            <span data-testid="clock-repeat-label">{repeatLabel(draft.days, repeatLabels(lang))}</span>
          </div>
          <div className="vc-day-picker" role="group" aria-label={t("alarm.repeat")}>
            {WEEK.map((d) => {
              const on = draft.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={cx(on && "active")}
                  onClick={() => set({ days: on ? ref.current.days.filter((x) => x !== d) : [...ref.current.days, d] })}
                  data-testid="clock-day"
                  data-day={d}
                >
                  {repeatLabels(lang).short[d]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="vc-form-card">
          <label className="vc-form-row">
            <span>{t("alarm.name")}</span>
            <input value={draft.name} maxLength={50} placeholder={t("alarm.default")} onChange={(e) => set({ name: e.target.value })} data-testid="clock-alarm-name" />
          </label>
          <button type="button" className="vc-form-row" onClick={() => setPage("sounds")} data-testid="clock-alarm-sound">
            <span>{t("alarm.sound")}</span>
            <span className="vc-form-value">
              {soundById(draft.sound).name}
              <ClockIcon name="next" />
            </span>
          </button>
          <div className="vc-form-row">
            <span id="clock-snooze-label">{t("alarm.snooze")}</span>
            <Switch checked={draft.snooze} onChange={(v) => set({ snooze: v })} label={t("alarm.snooze")} testId="clock-alarm-snooze" />
          </div>
          <label className={cx("vc-form-row", !draft.snooze && "muted")}>
            <span>{t("alarm.interval")}</span>
            <select value={draft.interval} disabled={!draft.snooze} onChange={(e) => set({ interval: Number(e.target.value) })} data-testid="clock-alarm-interval">
              {SNOOZE_INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {t("alarm.min", { n })}
                </option>
              ))}
            </select>
          </label>
        </div>
        {at && (
          <p className="vc-next-label" data-testid="clock-alarm-fires">
            {t("alarm.fires", { time: untilText(lang, untilParts(at, now)) })}
          </p>
        )}
        {exists && (
          <button
            type="button"
            className="vc-pill danger vc-delete-alarm"
            onClick={async () => {
              const ok = await changeVia(`alarm:${initial.id}`, (s, sch) => deleteAlarmVia(sch, s, initial.id));
              if (ok) onClose();
            }}
            data-testid="clock-alarm-delete"
          >
            <ClockIcon name="trash" />
            {t("alarm.deleteThis")}
          </button>
        )}
      </div>
    </div>
  );
}

export { newAlarmDraft };
