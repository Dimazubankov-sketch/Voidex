import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RiArrowRightSLine, RiCheckLine, RiMenuLine, RiArrowLeftLine, RiSearchLine, RiPlayFill, RiPauseFill, RiRefreshLine, RiArrowUpSLine, RiArrowDownSLine } from "@remixicon/react";
import { timerMs, type ElementNode, type EventName, type ListItem, type NavItem, type TimerState } from "@voidex/forma";
import { AppIcon } from "./icons";

/**
 * Draws one Forma component inside its box (the box itself is positioned by
 * the canvas or the runtime). The same renderer runs in the editor and in
 * the preview / app runtime, so what the person designs is what runs.
 */
export interface RenderProps {
  el: ElementNode;
  /** Interactive (preview / canvas with move mode off). */
  live: boolean;
  screenId: string;
  value: unknown;
  timer?: TimerState;
  now: number;
  busy: boolean;
  busyText: string | null;
  fire: (event: EventName, payload?: { value?: unknown; index?: number }) => void;
  navigate: (target: string) => void;
  openDrawer: () => void;
  timerControl: (command: "start" | "pause" | "reset") => void;
}

const font = (el: ElementNode): CSSProperties => ({
  color: el.style.text,
  fontSize: el.style.fontSize,
  fontWeight: el.style.fontWeight,
  textAlign: el.style.align,
});

const box = (el: ElementNode, extra: CSSProperties = {}): CSSProperties => ({
  background: el.style.fill,
  color: el.style.text,
  borderRadius: el.style.radius,
  border: el.style.border ? `1px solid ${el.style.border}` : undefined,
  ...extra,
});

const tab = (live: boolean) => (live ? 0 : -1);

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

function Segments({ el, options, index, live, onPick }: { el: ElementNode; options: string[]; index: number; live: boolean; onPick: (i: number) => void }) {
  return (
    <div className="fx-r-seg" style={box(el, { padding: 3 })} role="tablist">
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === index}
          tabIndex={tab(live)}
          className={i === index ? "on" : ""}
          style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight, borderRadius: Math.max(0, el.style.radius - 3), color: el.style.text }}
          onClick={() => live && onPick(i)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Drum({ value, max, live, onChange, size }: { value: number; max: number; live: boolean; onChange: (v: number) => void; size: number }) {
  const wrap = (v: number) => (v + max) % max;
  const step = (d: number) => live && onChange(wrap(value + d));
  return (
    <div
      className="fx-r-drum"
      onWheel={(e) => {
        if (!live) return;
        e.stopPropagation();
        step(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <button type="button" tabIndex={tab(live)} aria-label="Больше" onClick={() => step(-1)}>
        <RiArrowUpSLine size={16} />
      </button>
      <span className="dim">{String(wrap(value - 1)).padStart(2, "0")}</span>
      <span className="cur" style={{ fontSize: size }}>
        {String(value).padStart(2, "0")}
      </span>
      <span className="dim">{String(wrap(value + 1)).padStart(2, "0")}</span>
      <button type="button" tabIndex={tab(live)} aria-label="Меньше" onClick={() => step(1)}>
        <RiArrowDownSLine size={16} />
      </button>
    </div>
  );
}

function LiveClock({ el, now }: { el: ElementNode; now: number }) {
  const d = new Date(now);
  const t = el.props.showSeconds ? d.toLocaleTimeString("ru-RU") : d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="fx-r-text" style={{ ...font(el), fontVariantNumeric: "tabular-nums" }}>
      {t}
    </div>
  );
}

export function RenderElement(r: RenderProps): ReactNode {
  const { el, live, value, fire } = r;
  const p = el.props;
  switch (el.type) {
    case "bottomNav": {
      const items = (p.items as NavItem[]) ?? [];
      return (
        <nav className="fx-r-bottomnav" style={box(el)} aria-label="Нижнее меню">
          {items.map((i) => {
            const on = i.screenId === r.screenId;
            return (
              <button key={i.id} type="button" tabIndex={tab(live)} aria-current={on ? "page" : undefined} className={on ? "on" : ""} onClick={() => live && r.navigate(i.screenId)}>
                <AppIcon name={i.icon} size={21} />
                <span style={{ fontSize: el.style.fontSize }}>{i.label}</span>
              </button>
            );
          })}
        </nav>
      );
    }
    case "sideNav":
      return (
        <button type="button" className="fx-r-center" style={box(el)} tabIndex={tab(live)} aria-label="Открыть меню" onClick={() => live && r.openDrawer()}>
          <RiMenuLine size={20} />
        </button>
      );
    case "back":
      return (
        <button type="button" className="fx-r-center fx-r-gap" style={box(el, { fontSize: el.style.fontSize, fontWeight: el.style.fontWeight })} tabIndex={tab(live)} onClick={() => live && r.navigate("back")}>
          <RiArrowLeftLine size={18} />
          <span>{String(p.label ?? "")}</span>
        </button>
      );
    case "topBar":
      return (
        <header className="fx-r-topbar" style={box(el, { borderRadius: 0, border: undefined, borderBottom: el.style.border ? `1px solid ${el.style.border}` : undefined, justifyContent: el.style.align === "left" ? "flex-start" : el.style.align === "right" ? "flex-end" : "center" })}>
          <span style={font(el)}>{String(p.title ?? "")}</span>
        </header>
      );
    case "tabs":
    case "segmented":
      return <Segments el={el} options={(p.options as string[]) ?? []} index={Number(value ?? 0)} live={live} onPick={(i) => fire("change", { value: i })} />;
    case "button": {
      const variant = String(p.variant ?? "primary");
      const style: CSSProperties =
        variant === "primary"
          ? box(el)
          : variant === "secondary"
            ? box(el, { background: `color-mix(in srgb, ${el.style.fill} 14%, transparent)`, color: el.style.fill })
            : box(el, { background: "transparent", color: el.style.fill, border: undefined });
      return (
        <button
          type="button"
          className="fx-r-button"
          disabled={r.busy}
          tabIndex={tab(live)}
          style={{ ...style, fontSize: el.style.fontSize, fontWeight: el.style.fontWeight, justifyContent: el.style.align === "left" ? "flex-start" : el.style.align === "right" ? "flex-end" : "center" }}
          onClick={() => live && fire("press")}
        >
          {r.busy && <span className="fx-r-spin" aria-hidden />}
          <span>{r.busy && r.busyText ? r.busyText : String(p.label ?? "")}</span>
        </button>
      );
    }
    case "iconButton":
      return (
        <button type="button" className="fx-r-center" disabled={r.busy} aria-label={String(p.label ?? "")} tabIndex={tab(live)} style={box(el)} onClick={() => live && fire("press")}>
          {r.busy ? <span className="fx-r-spin" aria-hidden /> : <AppIcon name={String(p.icon)} size={el.style.fontSize} />}
        </button>
      );
    case "toggle": {
      const on = value === true;
      return (
        <label className="fx-r-row" style={box(el, { padding: "0 14px" })}>
          <span style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight, flex: 1 }}>{String(p.label ?? "")}</span>
          <button type="button" role="switch" aria-checked={on} tabIndex={tab(live)} className={`fx-r-switch${on ? " on" : ""}`} onClick={() => live && fire("change", { value: !on })}>
            <i />
          </button>
        </label>
      );
    }
    case "checkbox": {
      const on = value === true;
      return (
        <label className="fx-r-row" style={{ color: el.style.text, fontSize: el.style.fontSize, gap: 10 }}>
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            tabIndex={tab(live)}
            className="fx-r-check"
            style={{ borderRadius: el.style.radius, background: on ? el.style.fill : "transparent", borderColor: on ? el.style.fill : "#c9c8d3" }}
            onClick={() => live && fire("change", { value: !on })}
          >
            {on && <RiCheckLine size={15} color="#fff" />}
          </button>
          <span>{String(p.label ?? "")}</span>
        </label>
      );
    }
    case "slider": {
      const min = Number(p.min ?? 0);
      const max = Math.max(min + 1, Number(p.max ?? 100));
      const v = Number(value ?? min);
      return (
        <div className="fx-r-slider" style={{ color: el.style.text, fontSize: el.style.fontSize }}>
          <div>
            <span>{String(p.label ?? "")}</span>
            <b>{v}</b>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            value={v}
            tabIndex={tab(live)}
            disabled={!live}
            style={{ accentColor: el.style.fill, ["--fx-fill" as string]: el.style.fill, ["--fx-pct" as string]: `${((v - min) / (max - min)) * 100}%` }}
            onChange={(e) => fire("change", { value: Number(e.target.value) })}
          />
        </div>
      );
    }
    case "textInput": {
      const kind = String(p.inputType ?? "text");
      return (
        <label className="fx-r-field" style={{ color: el.style.text }}>
          {p.label ? <span>{String(p.label)}</span> : null}
          <input
            type={kind}
            inputMode={kind === "tel" ? "tel" : kind === "number" ? "decimal" : undefined}
            readOnly={!live}
            tabIndex={tab(live)}
            placeholder={String(p.placeholder ?? "")}
            value={String(value ?? "")}
            style={box(el, { fontSize: el.style.fontSize })}
            onChange={(e) => fire("change", { value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && live && fire("submit")}
          />
        </label>
      );
    }
    case "searchField":
      return (
        <label className="fx-r-search" style={box(el, { fontSize: el.style.fontSize })}>
          <RiSearchLine size={18} aria-hidden />
          <input
            type="search"
            readOnly={!live}
            tabIndex={tab(live)}
            placeholder={String(p.placeholder ?? "")}
            value={String(value ?? "")}
            onChange={(e) => fire("change", { value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && live && fire("submit")}
          />
        </label>
      );
    case "textArea":
      return (
        <textarea
          className="fx-r-area"
          readOnly={!live}
          tabIndex={tab(live)}
          placeholder={String(p.placeholder ?? "")}
          value={String(value ?? "")}
          style={box(el, { fontSize: el.style.fontSize })}
          onChange={(e) => fire("change", { value: e.target.value })}
        />
      );
    case "heading":
    case "text":
      return (
        <div className={el.type === "heading" ? "fx-r-heading" : "fx-r-text"} style={font(el)}>
          {String(value ?? "")}
        </div>
      );
    case "image": {
      const avatar = p.shape === "avatar";
      return (
        <button
          type="button"
          tabIndex={tab(live && !!el.events.press)}
          className="fx-r-center fx-r-image"
          style={box(el, { borderRadius: avatar ? "50%" : el.style.radius, background: `linear-gradient(135deg, ${el.style.fill}, color-mix(in srgb, ${el.style.text} 30%, ${el.style.fill}))` })}
          onClick={() => live && fire("press")}
        >
          {p.label ? <span style={{ fontSize: avatar ? el.style.fontSize : 15, fontWeight: 600 }}>{String(p.label)}</span> : <AppIcon name={String(p.icon)} size={el.style.fontSize} />}
        </button>
      );
    }
    case "icon":
      return (
        <button type="button" tabIndex={tab(live && !!el.events.press)} className="fx-r-center fx-r-bare" style={{ color: el.style.text }} onClick={() => live && fire("press")}>
          <AppIcon name={String(p.icon)} size={Math.min(el.layouts.phone.height, el.style.fontSize)} />
        </button>
      );
    case "badge":
      return (
        <div className="fx-r-center" style={box(el, { fontSize: el.style.fontSize, fontWeight: el.style.fontWeight })}>
          {String(value ?? "")}
        </div>
      );
    case "panel":
      return <div className="fx-r-fill" style={box(el)} />;
    case "card":
      return (
        <button type="button" tabIndex={tab(live)} className="fx-r-card" style={box(el)} onClick={() => live && fire("press")}>
          <span className="fx-r-tile" style={{ color: "#6c5cff" }}>
            <AppIcon name={String(p.icon)} size={22} />
          </span>
          <span className="fx-r-lines">
            <b style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight }}>{String(p.title ?? "")}</b>
            <small>{String(p.subtitle ?? "")}</small>
          </span>
          <RiArrowRightSLine size={20} className="fx-r-chev" />
        </button>
      );
    case "dialog":
      return (
        <div className="fx-r-dialog" role="dialog" aria-label={String(p.title ?? "")} style={box(el)}>
          <b style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight }}>{String(p.title ?? "")}</b>
          <p>{String(p.message ?? "")}</p>
          <div>
            {p.cancelLabel ? (
              <button type="button" tabIndex={tab(live)} className="ghost" onClick={() => live && fire("cancel")}>
                {String(p.cancelLabel)}
              </button>
            ) : null}
            <button type="button" tabIndex={tab(live)} onClick={() => live && fire("confirm")}>
              {String(p.confirmLabel ?? "")}
            </button>
          </div>
        </div>
      );
    case "divider":
      return (
        <div className="fx-r-center fx-r-fill">
          <i className="fx-r-line" style={{ background: el.style.fill }} />
        </div>
      );
    case "list": {
      const items = (p.items as ListItem[]) ?? [];
      const settings = p.variant === "settings";
      return (
        <div className="fx-r-list" style={box(el)}>
          {items.map((i, k) => (
            <button key={i.id} type="button" tabIndex={tab(live)} onClick={() => live && fire("itemPress", { index: k })} className={value === k ? "on" : ""}>
              <span className="fx-r-tile sm" style={{ color: "#6c5cff" }}>
                <AppIcon name={i.icon} size={18} />
              </span>
              <span className="fx-r-lines">
                <b style={{ fontSize: el.style.fontSize }}>{i.title}</b>
                {i.subtitle ? <small>{i.subtitle}</small> : null}
              </span>
              {settings && <RiArrowRightSLine size={18} className="fx-r-chev" />}
            </button>
          ))}
        </div>
      );
    }
    case "grid": {
      const items = (p.items as ListItem[]) ?? [];
      return (
        <div className="fx-r-grid" style={{ gridTemplateColumns: `repeat(${Number(p.columns ?? 2)}, 1fr)` }}>
          {items.map((i, k) => (
            <button key={i.id} type="button" tabIndex={tab(live)} style={box(el, { fontSize: el.style.fontSize })} onClick={() => live && fire("itemPress", { index: k })}>
              <AppIcon name={i.icon} size={24} style={{ color: "#6c5cff" }} />
              <span>{i.title}</span>
            </button>
          ))}
        </div>
      );
    }
    case "appCard":
      return (
        <div className="fx-r-card" style={box(el)}>
          <span className="fx-r-tile lg" style={{ color: "#fff", background: "linear-gradient(135deg,#9a7cff,#3f55f0)" }}>
            <AppIcon name={String(p.icon)} size={24} />
          </span>
          <span className="fx-r-lines">
            <b style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight }}>{String(p.title ?? "")}</b>
            <small>{String(p.subtitle ?? "")}</small>
          </span>
          <button type="button" tabIndex={tab(live)} className="fx-r-pill" disabled={r.busy} onClick={() => live && fire("press")}>
            {r.busy ? <span className="fx-r-spin" aria-hidden /> : String(p.buttonLabel ?? "")}
          </button>
        </div>
      );
    case "progress": {
      const v = Math.max(0, Math.min(100, Number(value ?? 0)));
      return (
        <div className="fx-r-progress" style={{ color: el.style.text, fontSize: el.style.fontSize }}>
          <div>
            <span>{String(p.label ?? "")}</span>
            <b>{Math.round(v)}%</b>
          </div>
          <i>
            <em style={{ width: `${v}%`, background: el.style.fill }} />
          </i>
        </div>
      );
    }
    case "timer":
    case "stopwatch": {
      const ms = timerMs(el, r.timer, r.now);
      const running = r.timer?.running === true;
      return (
        <div className="fx-r-timer" style={box(el)}>
          <span style={{ fontSize: el.style.fontSize, fontWeight: el.style.fontWeight, fontVariantNumeric: "tabular-nums" }}>
            {el.type === "timer" ? mmss(ms) : `${mmss(ms)}.${String(Math.floor((ms % 1000) / 100))}`}
          </span>
          {p.showControls ? (
            <div>
              <button type="button" tabIndex={tab(live)} aria-label="Сбросить" onClick={() => live && r.timerControl("reset")}>
                <RiRefreshLine size={18} />
              </button>
              <button type="button" tabIndex={tab(live)} aria-label={running ? "Пауза" : "Старт"} className="main" onClick={() => live && r.timerControl(running ? "pause" : "start")}>
                {running ? <RiPauseFill size={20} /> : <RiPlayFill size={20} />}
              </button>
            </div>
          ) : null}
        </div>
      );
    }
    case "timePicker": {
      const [h, m] = String(value ?? "07:30")
        .split(":")
        .map((x) => Number(x) || 0);
      const set = (nh: number, nm: number) => fire("change", { value: `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}` });
      return (
        <div className="fx-r-picker" style={box(el)}>
          <Drum value={h!} max={24} live={live} size={el.style.fontSize} onChange={(v) => set(v, m!)} />
          <b style={{ fontSize: el.style.fontSize }}>:</b>
          <Drum value={m!} max={60} live={live} size={el.style.fontSize} onChange={(v) => set(h!, v)} />
        </div>
      );
    }
    case "clock":
      return <LiveClock el={el} now={r.now} />;
    case "notice": {
      const tone = String(p.tone ?? "info");
      const colors: Record<string, [string, string]> = { info: [el.style.fill, el.style.text], success: ["#e6f6ef", "#13784f"], warning: ["#fff4e0", "#9a5b00"], danger: ["#fdecec", "#b4262b"] };
      const [bg, fg] = colors[tone] ?? colors.info!;
      return (
        <button type="button" tabIndex={tab(live && !!el.events.press)} className="fx-r-notice" style={{ background: bg, color: fg, borderRadius: el.style.radius, fontSize: el.style.fontSize }} onClick={() => live && fire("press")}>
          {String(value ?? "")}
        </button>
      );
    }
    case "spinner":
      return (
        <div className="fx-r-center fx-r-fill">
          <span className="fx-r-spin lg" style={{ borderTopColor: el.style.fill }} aria-label="Загрузка" />
        </div>
      );
  }
}

/** The ticking clock of a running app: re-renders while timers / clocks are on screen. */
export function useNow(active: boolean, interval = 200) {
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef(active);
  ref.current = active;
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(t);
  }, [active, interval]);
  return now;
}
