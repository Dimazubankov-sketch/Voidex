import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newAlarmDraft, type Alarm } from "@voidex/clock";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { WindowHeader, useWindow } from "@/os/window-context";
import { AlarmEditor, AlarmPage } from "./alarms";
import { stopPreview } from "./audio";
import { ClockIcon, type ClockIconName } from "./icons";
import { useClock } from "./runtime";
import { useClockT, type ClockKey } from "./strings";
import { StopwatchPage, TimersPage } from "./timers";
import { SheetHost, useArrive } from "./ui";
import { CityPicker, WorldPage } from "./world";
import "./clock.css";

type Tab = "world" | "alarm" | "stopwatch" | "timers";
const TABS: { id: Tab; icon: ClockIconName; label: ClockKey }[] = [
  { id: "world", icon: "world", label: "tab.world" },
  { id: "alarm", icon: "alarm", label: "tab.alarm" },
  { id: "stopwatch", icon: "stopwatch", label: "tab.stopwatch" },
  { id: "timers", icon: "timers", label: "tab.timers" },
];
const isTab = (v: unknown): v is Tab => TABS.some((x) => x.id === v);
const TAB_KEY = "vx.clock.tab";

function savedTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return isTab(v) ? v : "world";
  } catch {
    return "world";
  }
}

/** Below this window width Clock uses its phone layout (bottom navigation), above it the PC one (sidebar). */
const PHONE_MAX = 720;
const WIDE_MIN = 1000;

/**
 * VOIDEX Clock (Step 2.14): Voidex-Clock running natively in a VOIDEX window
 * (no iframe, no page of its own). Its logo is a system icon only: it is
 * never drawn inside the app. Phone: the four sections at the bottom, above
 * the gesture bar. PC: a sidebar and wide panels with mouse and keyboard.
 */
export function ClockApp() {
  const t = useClockT();
  const win = useWindow();
  const ff = useFormFactor();
  const root = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(1200);
  const [tab, setTabState] = useState<Tab>(() => (isTab(win.params.tab) ? win.params.tab : savedTab()));
  const [focus, setFocus] = useState<string | null>(typeof win.params.focus === "string" ? win.params.focus : null);
  const [cityOpen, setCityOpen] = useState(false);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const alarmsCount = useClock((s) => s.state.alarms.length);
  const phone = ff !== "desktop" || width < PHONE_MAX;
  const wide = !phone && width >= WIDE_MIN;
  const content = useArrive(tab);

  useLayoutEffect(() => {
    const el = root.current!;
    setHost(el);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const setTab = (next: Tab) => {
    stopPreview();
    setTabState(next);
    setFocus(null);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* not remembered */
    }
  };

  // A notification (or another app) opens Clock on an alarm or a timer.
  useEffect(() => {
    if (isTab(win.params.tab)) setTabState(win.params.tab);
    if (typeof win.params.focus === "string") setFocus(win.params.focus);
  }, [win.paramsVersion]);

  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => root.current?.querySelector(".vc-focused")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const clear = window.setTimeout(() => setFocus(null), 4000);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(clear);
    };
  }, [focus, tab]);

  // Leaving Clock (window closed) stops a sound preview.
  useEffect(() => () => stopPreview(), []);

  const add = tab === "world" ? () => setCityOpen(true) : tab === "alarm" ? () => setEditing(newAlarmDraft()) : null;
  const addLabel = tab === "world" ? t("add.city") : t("add.alarm");
  const title = t(TABS.find((x) => x.id === tab)!.label);

  // PC: Ctrl/Cmd + 1..4 switch sections; N adds (a city / an alarm) when the focus is not in a field.
  useEffect(() => {
    if (phone || !win.focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest?.("input, textarea, select, [role=dialog]")) return;
      if ((e.ctrlKey || e.metaKey) && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        setTab(TABS[Number(e.key) - 1]!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone, win.focused]);

  const addButton = add && (
    <button type="button" className="vc-icon-button vc-add" onClick={add} aria-label={addLabel} title={addLabel} data-testid="clock-add">
      <ClockIcon name="plus" />
    </button>
  );

  const page =
    tab === "world" ? (
      <WorldPage wide={!phone} />
    ) : tab === "alarm" ? (
      <AlarmPage onEdit={(a) => setEditing({ ...a })} onNew={() => setEditing(newAlarmDraft())} focus={focus} />
    ) : tab === "stopwatch" ? (
      <StopwatchPage />
    ) : (
      <TimersPage phone={phone} wide={wide} focus={focus} />
    );

  return (
    <div ref={root} className={cx("vx-clock vx-app-bg", phone ? "vc-phone" : "vc-desktop", wide && "vc-wide")} data-testid="clock-app" data-layout={phone ? "phone" : "desktop"} data-tab={tab} data-alarms={alarmsCount}>
      <SheetHost.Provider value={host}>
        {ff === "desktop" && (
          <WindowHeader className="vc-titlebar" right={addButton}>
            <h1 className="vc-title" data-testid="clock-title">
              {title}
            </h1>
          </WindowHeader>
        )}
        <div className="vc-body">
          {!phone && (
            <nav className="vc-sidebar" aria-label={t("nav.label")} data-testid="clock-sidebar">
              {TABS.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  className={cx("vc-nav-item", tab === x.id && "selected")}
                  aria-current={tab === x.id ? "page" : undefined}
                  onClick={() => setTab(x.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    e.preventDefault();
                    const n = TABS[(i + (e.key === "ArrowDown" ? 1 : TABS.length - 1)) % TABS.length]!;
                    setTab(n.id);
                    (e.currentTarget.parentElement?.querySelector(`[data-tab="${n.id}"]`) as HTMLElement | null)?.focus();
                  }}
                  data-tab={x.id}
                  data-testid={`clock-tab-${x.id}`}
                >
                  <ClockIcon name={x.icon} />
                  <span>{t(x.label)}</span>
                </button>
              ))}
            </nav>
          )}
          <main className="vc-main">
            {ff !== "desktop" && (
              <div className="vc-topbar">
                <h1 className="vc-title" data-testid="clock-title">
                  {title}
                </h1>
                {addButton}
              </div>
            )}
            <div ref={content} className="vc-content" key="content">
              {page}
            </div>
          </main>
        </div>
        {phone && (
          <nav className="vc-bottom-nav" aria-label={t("nav.label")} data-testid="clock-bottom-nav">
            {TABS.map((x) => (
              <button key={x.id} type="button" className={cx("vc-bottom-item", tab === x.id && "selected")} aria-current={tab === x.id ? "page" : undefined} onClick={() => setTab(x.id)} data-tab={x.id} data-testid={`clock-tab-${x.id}`}>
                <ClockIcon name={x.icon} />
                <span>{t(x.id === "world" ? "tab.world.short" : x.label)}</span>
              </button>
            ))}
          </nav>
        )}
        <CityPicker open={cityOpen} onClose={() => setCityOpen(false)} phone={phone} />
        <AlarmEditor draft={editing} onClose={() => setEditing(null)} phone={phone} />
      </SheetHost.Provider>
    </div>
  );
}
