import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { RiAddCircleFill, RiAddLine, RiArrowLeftSLine, RiCloseLine, RiLockLine, RiSubtractLine } from "@remixicon/react";
import {
  APP_REGISTRY,
  MOBILE_PAGES_MAX,
  WIDGETS_MAX,
  WIDGET_CELLS,
  addToStack,
  addWidget,
  carouselSpot,
  deleteWidgetHalf,
  joinWidgets,
  setStackActive,
  stackWidgets,
  widgetCells,
  widgetColumns,
  type StackResult,
  type WidgetItem,
  freeBlock,
  moveWidget,
  type AppId,
  display,
  emptyCalc,
  placeInCell,
  placeWidgetMakingRoom,
  press,
  removeWidget,
  widgetKey,
  type Widget,
  type Place,
  type Cell,
  type WidgetSize,
  type WidgetType,
  type WorkspaceLayout,
} from "@voidex/shared";
import { cx } from "@/lib/cx";
import { getFormFactor, useFormFactor } from "@/lib/form-factor";
import { t as translateNow, useLanguage, useT, type MessageKey } from "@/lib/i18n";
import { Button, IconButton, Spinner } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { createPortal } from "react-dom";
import { useWM } from "../window-manager";
import { CalculatorGlyph, ClockGlyph, NotesGlyph } from "@/brand/brand";
import { useQuery } from "@tanstack/react-query";
import { notesPreview, type NotesDocMetaDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";

import { notesApi } from "@/apps/notes/data";
import { cityClock, cityName } from "@voidex/clock";
import { useHands, useShownZone } from "@/apps/clock/analog";
import { desktopGeometry, geometryFor } from "./desktop-geometry";
import { cellAt, placeOfGrid } from "./grid";
import { openApp } from "./actions";
import { currentLayout, updateLayout, useWorkspaceLayout } from "./layout";
import { useHomeUi } from "./ui-store";
import { captureGridFlip, removeAnimated } from "./grid-flip";
import { phonePager } from "./pager-ref";
import { VoidexSearchField } from "@/ui/search-field";

/**
 * Home-screen widgets. A small system catalogue (no widget store yet); the
 * placed widgets are part of the synced workspace layout (`layout.widgets`)
 * and sit in the home grid like icons, covering a block of cells (the
 * Calculator: 2 × 2). In edit mode a widget is dragged to another cell.
 *
 * Adding a widget type = an entry in WIDGET_TYPES / WIDGET_CELLS (shared) + one here.
 * Widgets stay light: nothing heavy (the full Calculator's OCR, KaTeX…) loads for them.
 */

interface WidgetDef {
  type: WidgetType;
  /** The app the widget comes from (its name and icon in the catalogue). */
  app: AppId;
  title: MessageKey;
  /** Step 2.15: the widget's own name under its app («Аналоговые часы»). */
  name: MessageKey;
  description: MessageKey;
  keywords: string;
  Icon: ComponentType<{ className?: string }>;
  Body: ComponentType<{ preview?: boolean; size?: WidgetSize }>;
}

const KEYS = ["C", "±", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "⌫", "="] as const;

/** A working mini calculator: display + the basic keys. Its title opens the Calculator app. */
function CalculatorWidget({ preview }: { preview?: boolean }) {
  const t = useT();
  const [state, setState] = useState(emptyCalc);
  const shown = display(state);
  const openFull = (e: React.MouseEvent<HTMLElement>) => openApp("calculator", e.currentTarget);
  return (
    <div className={cx("flex h-full min-h-0 flex-col gap-1.5 p-2.5", preview && "pointer-events-none")} data-testid="calc-widget">
      <button type="button" onClick={openFull} className="flex items-center gap-1.5 self-start rounded-lg px-1 text-left" data-testid="calc-widget-open" aria-label={t("widgets.calculatorOpen")}>
        <CalculatorGlyph className="size-4" />
        <span className="text-[12px] font-semibold text-text">{t("widgets.calculator")}</span>
      </button>
      <div className="flex min-h-0 flex-col items-end justify-end px-1" aria-live="polite">
        <span className="h-3.5 max-w-full truncate text-[11px] leading-none text-text-tertiary">{shown.expression}</span>
        <span className={cx("max-w-full truncate text-[22px] font-semibold leading-tight tabular-nums", state.error ? "text-danger" : "text-text")} data-testid="calc-widget-display">
          {state.error ? t("widgets.calcError") : shown.value}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1" role="group" aria-label={t("widgets.calculator")}>
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            tabIndex={preview ? -1 : 0}
            onClick={() => setState((s) => press(s, k))}
            className={cx(
              "vx-calc-key flex min-h-0 items-center justify-center rounded-[10px] text-[14px] font-semibold",
              // Update 4 · C2: the colours of the new Calculator logo (lavender keys, violet signs, a deep violet «=»).
              k === "=" ? "vx-calc-eq" : "×÷−+".includes(k) ? "vx-calc-op" : k === "C" || k === "±" || k === "%" || k === "⌫" ? "vx-calc-fn" : "vx-calc-digit",
            )}
            aria-label={k === "⌫" ? t("widgets.calcBackspace") : k === "C" ? t("widgets.calcClear") : k}
            data-widget-key
            data-testid={`calc-key-${k}`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The current time, re-rendered on every new second (aligned to the clock, paused while the tab is hidden). */
function useSecond(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
  return now;
}

/** The Clock widget's analog face (SVG): its hands glide, driven per frame without React renders. */
/**
 * Update 4 · C1 (the owner's reference, 1 : 1): the widget is the reference picture itself — its ring,
 * glass rim, soft waves and the 12 marks — with its painted hands, knob and text taken out; the live
 * parts are drawn over it in the same places: the 12 marks again (crisp), three hands (hour, minute,
 * second) at the real time and the centre knob. `dial` is where the face is in the picture: its centre
 * (fractions of the picture's width / height) and radius (a fraction of its height).
 */
const CLOCK_ART = {
  s: { src: "/widgets/clock-s.webp", ratio: 521 / 514, dial: { x: 0.5167, y: 0.5163, r: 0.3366 } },
  w: { src: "/widgets/clock-w.webp", ratio: 1028 / 514, dial: { x: 0.727, y: 0.5212, r: 0.3424 } },
} as const;

/** The live parts of the face, over the picture (viewBox: the face's radius is 100). */
function ClockFace({ zone, className, style }: { zone: string; className?: string; style?: React.CSSProperties }) {
  const hour = useRef<SVGGElement>(null);
  const minute = useRef<SVGGElement>(null);
  const second = useRef<SVGGElement>(null);
  useHands(zone, { hour, minute, second }, true);
  // Ids unique per face (several clocks may be on screen).
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `vxc-${uid}-${n}`;
  const url = (n: string) => `url(#${id(n)})`;
  return (
    <svg viewBox="0 0 200 200" className={cx("pointer-events-none absolute overflow-visible", className)} style={style} aria-hidden data-testid="clock-face">
      <defs>
        {/* The marks of the picture: deep violet at the centre side, lighter outwards. */}
        <linearGradient id={id("tick")} gradientUnits="userSpaceOnUse" x1="100" y1="30.7" x2="100" y2="14.2">
          <stop offset="0" stopColor="#7754fd" />
          <stop offset="1" stopColor="#b08cfc" />
        </linearGradient>
        {/* The hands: a deep blue-violet at the centre, lavender at the tip (as in the picture). */}
        <linearGradient id={id("hand")} gradientUnits="userSpaceOnUse" x1="100" y1="100" x2="100" y2="22">
          <stop offset="0" stopColor="#3b20ef" />
          <stop offset="0.55" stopColor="#6f4dfb" />
          <stop offset="1" stopColor="#ad97ff" />
        </linearGradient>
        <radialGradient id={id("knobRing")} cx="0.42" cy="0.38" r="0.62">
          <stop offset="0" stopColor="#d4c6fe" />
          <stop offset="0.72" stopColor="#9374fc" />
          <stop offset="1" stopColor="#b9a0fd" />
        </radialGradient>
        <radialGradient id={id("knob")} cx="0.38" cy="0.32" r="0.7">
          <stop offset="0" stopColor="#f1ecff" />
          <stop offset="1" stopColor="#c3b0fd" />
        </radialGradient>
        <filter id={id("sh")} filterUnits="userSpaceOnUse" x="-20" y="-20" width="240" height="240">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.8" floodColor="#3a1fd6" floodOpacity="0.3" />
        </filter>
      </defs>
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={100} y1={30.7} x2={100} y2={14.2} stroke={url("tick")} strokeWidth={7.1} strokeLinecap="round" transform={`rotate(${i * 30} 100 100)`} data-testid="clock-mark" />
      ))}
      <g ref={hour} data-testid="clock-widget-hour">
        <line x1={100} y1={106} x2={100} y2={46} stroke={url("hand")} strokeWidth={11.5} strokeLinecap="round" filter={url("sh")} />
      </g>
      <g ref={minute} data-testid="clock-widget-minute">
        <line x1={100} y1={106} x2={100} y2={27} stroke={url("hand")} strokeWidth={8.5} strokeLinecap="round" filter={url("sh")} />
      </g>
      <g ref={second} data-testid="clock-widget-second">
        <line x1={100} y1={124} x2={100} y2={10} stroke="#4526f0" strokeWidth={2.4} strokeLinecap="round" filter={url("sh")} />
      </g>
      <circle cx={100} cy={100} r={17} fill={url("knobRing")} filter={url("sh")} />
      <circle cx={100} cy={100} r={10.5} fill={url("knob")} />
    </svg>
  );
}

/**
 * The picture filling the widget like `object-fit: cover`, with the live face (and, 4 × 2, the text) on a
 * stage of the picture's own proportions, so everything stays where it is in the picture at any size.
 */
function ClockArt({ size, zone, children }: { size: "s" | "w"; zone: string; children?: React.ReactNode }) {
  const art = CLOCK_ART[size];
  const d = art.dial;
  return (
    <span className="vx-clock-art pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] [container-type:size]" data-clock-art={size}>
      {/* 4 × 2: anchored right, so the dial is always whole (a taller phone card trims the empty left part). */}
      <span className={cx("absolute top-1/2 -translate-y-1/2", size === "w" ? "right-0" : "left-1/2 -translate-x-1/2")} style={{ width: `max(100cqw, calc(100cqh * ${art.ratio}))`, aspectRatio: String(art.ratio) }}>
        <img src={art.src} alt="" draggable={false} className="absolute inset-0 size-full select-none" />
        <ClockFace
          zone={zone}
          style={{ left: `${(d.x - d.r / art.ratio) * 100}%`, top: `${(d.y - d.r) * 100}%`, width: `${((2 * d.r) / art.ratio) * 100}%`, height: `${2 * d.r * 100}%` }}
        />
      </span>
      {children}
    </span>
  );
}

/** The soft lavender surface of the new Clock / Notes widgets (the logos' tile, as a background). */
function LogoSurface() {
  return (
    <span aria-hidden className="vx-logo-surface pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span className="absolute -right-[18%] -top-[30%] size-[70%] rounded-full bg-[#c9b8ff]/30 blur-2xl" />
      <span className="absolute -bottom-[35%] -left-[10%] size-[80%] rounded-full bg-[#b9c4ff]/25 blur-2xl" />
    </span>
  );
}

/**
 * A2: Clock widget, the world clock's top panel on the home screen. It shows the city selected in
 * Clock (else this device's zone), from the same store and the same time functions as the app, so the
 * two never disagree. 2 × 2: the analog face only; 4 × 2: the city, the time, the date and the face. A tap opens Clock on the world clock.
 */
function ClockWidget({ preview, size }: { preview?: boolean; size?: WidgetSize }) {
  const t = useT();
  const lang = useLanguage();
  const now = useSecond(true);
  const zone = useShownZone();
  const city = cityName(zone, lang);
  const time = cityClock(zone, now);
  const label = t("widgets.clockNow", { time: `${city}, ${time}` });
  const wide = size === "w";
  const date = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang, { weekday: "short", day: "numeric", month: "long", timeZone: zone }).format(now);
  return (
    <button
      type="button"
      tabIndex={preview ? -1 : 0}
      onClick={(e) => openApp("clock", e.currentTarget, { tab: "world" })}
      className={cx("relative flex size-full overflow-hidden rounded-[24px] text-left", preview && "pointer-events-none")}
      aria-label={label}
      title={label}
      data-testid="clock-widget"
      data-size={size ?? "s"}
      data-zone={zone}
      data-time={time}
    >
      <ClockArt size={wide ? "w" : "s"} zone={zone}>
        {wide && (
          // Update 4 · C1: the city, the time and the date where the picture has them.
          // In the card's own space: from its left side up to the dial, sized like the picture's text (the
          // time shrinks a little when a taller card leaves less room beside the dial).
          <span
            className="absolute left-[7.5%] top-1/2 flex -translate-y-1/2 flex-col"
            style={{
              width: `calc(92.5cqw - max(100cqw, ${CLOCK_ART.w.ratio * 100}cqh) * ${(1 - (CLOCK_ART.w.dial.x - CLOCK_ART.w.dial.r / CLOCK_ART.w.ratio)).toFixed(4)} - 3cqw)`,
              fontSize: `min(1cqh, calc((92.5cqw - max(100cqw, ${CLOCK_ART.w.ratio * 100}cqh) * ${(1 - (CLOCK_ART.w.dial.x - CLOCK_ART.w.dial.r / CLOCK_ART.w.ratio)).toFixed(4)} - 3cqw) / 78))`,
            }}
          >
            <span className="truncate font-semibold leading-tight text-[#1d1b2b]" style={{ fontSize: "7.6em" }} data-testid="clock-widget-city">
              {city}
            </span>
            <span className="bg-[linear-gradient(135deg,#8e6bff,#5a3ef2)] bg-clip-text font-bold leading-[1.02] tracking-[-0.02em] text-transparent tabular-nums" style={{ fontSize: "26em" }} data-testid="clock-widget-time">
              {time}
            </span>
            <span className="truncate text-[#7a7690]" style={{ fontSize: "5.9em" }}>
              {date.charAt(0).toUpperCase() + date.slice(1)}
            </span>
          </span>
        )}
      </ClockArt>
    </button>
  );
}

/** Update 4 · C3: the most recently changed documents, from Notes itself (no storage of its own). */
function useRecentNotes(enabled: boolean) {
  return useQuery({
    // Under ["notes"]: the server's notes events refresh it with the app.
    queryKey: ["notes", "recent"],
    queryFn: () => api.get<{ documents: NotesDocMetaDto[] }>("/api/notes/recent?limit=6"),
    enabled,
    staleTime: 15_000,
  });
}

/** Opens a note in Notes (its project, then the note). */
const openNote = (el: Element, d: Pick<NotesDocMetaDto, "id" | "projectId">) => openApp("notes", el, { doc: d.id, project: d.projectId });

/**
 * Update 4 · C3: the Notes widget, from the Notes data (GET /api/notes/recent; refreshed by the notes
 * events like the app). 2 × 2: the latest note's name and a short excerpt. 4 × 2: name, a few lines and
 * when it changed. 4 × 4: a longer text that scrolls inside, the next notes, and «+» for a new note.
 * Notes locked with the code (Settings → Apps → Notes): only that it is locked, never the content.
 */
function NotesWidget({ preview, size }: { preview?: boolean; size?: WidgetSize }) {
  const t = useT();
  const lang = useLanguage();
  const locked = useSession((s) => !!s.user?.preferences.apps?.notes?.lock);
  const q = useRecentNotes(!preview && !locked);
  const big = size === "l";
  const wide = size === "w" || big;
  const docs = preview ? [{ id: "p", projectId: "p", kind: "note", name: t("widgets.notesSample"), preview: t("widgets.notesSampleText"), updatedAt: new Date().toISOString() } as NotesDocMetaDto] : (q.data?.documents ?? []);
  const notes = docs.filter((d) => d.kind === "note");
  const doc = notes[0] ?? docs[0];
  // 4 × 4: the whole text of the latest note (the same document the app opens).
  const full = useQuery({ queryKey: ["notes", "document", doc?.id ?? ""], queryFn: () => notesApi.document(doc!.id), enabled: big && !preview && !locked && !!doc, staleTime: 15_000 });
  const text = big && full.data ? notesPreview(full.data.data, 1600) : (doc?.preview ?? "");
  const when = doc ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(doc.updatedAt)) : "";
  const [creating, setCreating] = useState(false);
  const create = async (el: HTMLElement) => {
    if (creating) return;
    setCreating(true);
    try {
      const projects = (await notesApi.projects()).projects.filter((p) => p.role !== "viewer");
      const projectId = doc && docs[0]?.role !== "viewer" ? doc.projectId : (projects[0]?.id ?? (await notesApi.createProject(t("widgets.notesProject"))).id);
      const d = await notesApi.createDocument(projectId, { kind: "note", name: t("widgets.notesNew") });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      openNote(el, d);
    } catch {
      toast({ title: t("widgets.notesFailed"), tone: "danger" });
    } finally {
      setCreating(false);
    }
  };
  const head = (
    <span className="relative flex items-center gap-1.5">
      <NotesGlyph className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#6a3cf2]">{t("widgets.notes")}</span>
      {big && !locked && (
        <button
          type="button"
          tabIndex={preview ? -1 : 0}
          onClick={(e) => {
            e.stopPropagation();
            void create(e.currentTarget);
          }}
          aria-label={t("widgets.notesNew")}
          title={t("widgets.notesNew")}
          className="pressable -my-1 flex size-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,#9172ff,#5a33ef)] text-white shadow-[0_4px_10px_-4px_rgba(90,51,239,0.6)]"
          data-widget-key
          data-testid="notes-widget-new"
        >
          {creating ? <Spinner size={12} /> : <RiAddLine className="size-4" />}
        </button>
      )}
    </span>
  );
  let body: React.ReactNode;
  if (locked)
    body = (
      <span className="relative flex flex-1 flex-col items-center justify-center gap-1.5 text-center" data-testid="notes-widget-locked">
        <RiLockLine className="size-6 text-[#7b55ff]" />
        <span className="text-[12px] font-medium leading-tight text-text-secondary">{t("widgets.notesLocked")}</span>
      </span>
    );
  else if (!preview && q.isPending) body = <span className="relative mt-2 flex flex-col gap-1.5"><span className="h-3 w-3/4 rounded-full bg-[#7b55ff]/12" /><span className="h-3 w-1/2 rounded-full bg-[#7b55ff]/10" /></span>;
  else if (!doc)
    body = (
      <span className="relative flex flex-1 flex-col items-center justify-center gap-1 text-center" data-testid="notes-widget-empty">
        <span className="text-[13px] font-semibold text-text">{t("widgets.notesEmpty")}</span>
        <span className="text-[11.5px] leading-tight text-text-secondary">{t("widgets.notesEmptyHint")}</span>
      </span>
    );
  else
    body = (
      <>
        <span className={cx("relative mt-1.5 line-clamp-2 font-semibold leading-tight text-text", wide ? "text-[16px]" : "text-[14px]")} data-testid="notes-widget-title">
          {doc.name}
        </span>
        <span
          className={cx("relative mt-1 whitespace-pre-wrap break-words text-text-secondary", wide ? "text-[13px] leading-[1.35]" : "text-[12px] leading-[1.3]", big ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:none]" : wide ? "line-clamp-3" : "line-clamp-4")}
          // 4 × 4: the long text scrolls up and down inside; sideways moves still go to the home pages.
          style={big ? { touchAction: "pan-y" } : undefined}
          data-testid="notes-widget-text"
        >
          {text || t("widgets.notesNoText")}
        </span>
        {wide && <span className="relative mt-auto pt-1.5 text-[11px] text-text-tertiary" data-testid="notes-widget-date">{t("widgets.notesChanged", { when })}</span>}
        {big && notes.length > 1 && (
          <span className="relative mt-2 flex flex-col gap-1 border-t border-[#7b55ff]/12 pt-2" data-testid="notes-widget-more">
            {notes.slice(1, 3).map((d) => (
              <button
                key={d.id}
                type="button"
                tabIndex={preview ? -1 : 0}
                onClick={(e) => {
                  e.stopPropagation();
                  openNote(e.currentTarget, d);
                }}
                className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-[#7b55ff]/8"
                data-widget-key
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[#7b55ff]" />
                <span className="truncate text-[12.5px] font-medium text-text">{d.name}</span>
              </button>
            ))}
          </span>
        )}
      </>
    );
  return (
    <div
      role="button"
      tabIndex={preview ? -1 : 0}
      onClick={(e) => (doc && !locked && !preview ? openNote(e.currentTarget, doc) : openApp("notes", e.currentTarget))}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}
      className={cx("relative flex size-full cursor-pointer flex-col overflow-hidden rounded-[24px] text-left", wide ? "p-[16px]" : "p-[13px]", preview && "pointer-events-none")}
      aria-label={locked ? t("widgets.notesLocked") : doc ? `${t("widgets.notes")}: ${doc.name}` : t("widgets.notes")}
      data-testid="notes-widget"
      data-size={size ?? "s"}
      data-locked={locked || undefined}
    >
      <LogoSurface />
      {head}
      {body}
    </div>
  );
}

export const WIDGETS: WidgetDef[] = [
  {
    type: "calculator",
    app: "calculator",
    title: "widgets.calculator",
    name: "widgets.calculatorName",
    description: "widgets.calculatorHint",
    keywords: "calculator calc math калькулятор счёт",
    Icon: ({ className }) => <CalculatorGlyph className={className} />,
    Body: CalculatorWidget,
  },
  {
    type: "clock",
    app: "clock",
    title: "widgets.clock",
    name: "widgets.clockName",
    description: "widgets.clockHint",
    keywords: "clock time analog watch часы время циферблат",
    Icon: ({ className }) => <ClockGlyph className={className} />,
    Body: ClockWidget,
  },
  {
    type: "notes",
    app: "notes",
    title: "widgets.notes",
    name: "widgets.notesName",
    description: "widgets.notesHint",
    keywords: "notes note text заметки заметка текст",
    Icon: ({ className }) => <NotesGlyph className={className} />,
    Body: NotesWidget,
  },
];

const defOf = (type: string) => WIDGETS.find((w) => w.type === type);

function RemoveBadge({ onRemove }: { onRemove: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("widgets.remove")}
      title={t("widgets.remove")}
      data-home-control
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute -left-2 -top-2 z-10 flex size-[22px] items-center justify-center rounded-full border border-white/70 bg-[rgba(60,60,72,0.72)] text-white shadow-md backdrop-blur-md animate-pop"
      data-testid="widget-remove"
    >
      <RiSubtractLine className="size-4" />
    </button>
  );
}

/**
 * B5: a widget carried to another page / desktop keeps being dragged there. Its card on the new page
 * is a new element; the drag is handed over to it with the pointer and where the finger holds the card.
 */
type DragResume = { x: number; y: number; grab: { dx: number; dy: number }; pointerId?: number };
const dragResume = new Map<string, (p: DragResume) => void>();
/** Longest wait for the page / desktop switch to settle before the card on the new page takes the finger. */
const SWITCH_SETTLE_MAX_MS = 900;

/**
 * Update 3 · B2: the finger stays with the drag across a page switch. The card under the finger is
 * replaced by a new one on the other page; Safari keeps sending that touch to the removed card (its
 * events no longer reach the window), so the drag was lost on an iPhone. The pointer is captured by the
 * workspace, which never goes away: every move and the release keep arriving.
 */
function holdPointer(pointerId: number | undefined) {
  if (pointerId === undefined) return;
  const keeper = document.querySelector<HTMLElement>('[data-testid="workspace"]');
  try {
    keeper?.setPointerCapture(pointerId);
  } catch {
    /* not an active pointer (synthetic) */
  }
}

/** Phone: resolves once the pages have stopped sliding (the page shown sits in the pager), at most `max` ms. */
function pagesSettled(page: number, max = SWITCH_SETTLE_MAX_MS): Promise<void> {
  const t0 = performance.now();
  return new Promise((done) => {
    let still = 0;
    const tick = () => {
      const pager = document.querySelector<HTMLElement>("[data-home-pager]")?.getBoundingClientRect();
      const el = document.querySelector<HTMLElement>(`[data-testid="home-page-${page}"]`)?.getBoundingClientRect();
      if (!pager || !el || performance.now() - t0 > max) return done();
      still = Math.abs(el.left - pager.left) < 1 ? still + 1 : 0;
      if (still >= 2) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** PC: hold a dragged widget over a desktop tab this long to carry it there (as for icons). */
const SPACE_HOLD_MS = 420;

/** Phone: holding a dragged widget this close to the side of the screen carries it to the next page. */
const EDGE = 26;
const EDGE_HOLD_MS = 600;
/** Long press that picks a widget up (as for icons), and how far the finger may wander meanwhile. */
const LONG_PRESS_MS = 450;
const PRESS_SLOP = 8;

/**
 * One placed widget in its grid cells: glass card. In edit mode it wiggles
 * and is removed with the badge. Step 2.15: dragging is free (the widget
 * follows the finger / mouse, no hopping between cells); it stays inside the
 * home area (never under the dock or the navigation, never past the bottom);
 * it snaps to the nearest cell when it is let go, gliding into place. On the
 * phone, holding it at the side of the screen carries it to the next (or a
 * new) page, where it takes the first free place; a page with a widget is
 * kept even when it has no icons.
 */
export function GridWidget({ widget, size, editing }: { widget: Widget; size: { w: number; h: number }; editing: boolean }) {
  const def = defOf(widget.type);
  const columns = useMemo(() => widgetColumns(widget), [widget]);
  /** E1 / E2 while dragging: a stack (ring on the target) or a carousel (the «+» beside it). */
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [dragging, setDragging] = useState(false);
  const touchPress = useRef(false);
  /** After a drop: the rect it was let go at, and the cell it was sent to (the glide starts once it is there). */
  const snap = useRef<{ from: DOMRect; cell: string } | null>(null);

  // FLIP: once the widget is in its new cell, start from where it was let go and glide to 0.
  useLayoutEffect(() => {
    const el = ref.current;
    const s = snap.current;
    if (!el || !s) return;
    const cellNow = el.parentElement?.dataset.cell;
    if (cellNow !== s.cell) return;
    snap.current = null;
    const now = el.getBoundingClientRect();
    const natural = { left: now.left - x.get(), top: now.top - y.get() };
    x.set(s.from.left - natural.left);
    y.set(s.from.top - natural.top);
    void animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
    void animate(y, 0, { type: "spring", stiffness: 520, damping: 42 });
  });

  const resumeRef = useRef<((p: DragResume) => void) | null>(null);
  useEffect(() => {
    const fn = (p: DragResume) => resumeRef.current?.(p);
    dragResume.set(widget.id, fn);
    return () => {
      if (dragResume.get(widget.id) === fn) dragResume.delete(widget.id);
    };
  }, [widget.id]);

  if (!def) return null;

  /**
   * Step 2.16: outside edit mode a long press picks the widget up like an app
   * icon: edit mode starts and the same finger / mouse carries it on, free
   * under the pointer; the grid only applies when it is let go.
   */
  const pressStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing) return beginDrag(e.clientX, e.clientY, undefined, e.pointerId);
    // B6: a press on a key of the widget (the calculator's) is the key's own: no growing widget, no
    // menu, no drag. The widget is held or moved by its other parts. A sideways swipe still turns the page.
    if ((e.target as HTMLElement).closest?.("[data-widget-key]")) {
      const pid = e.pointerId;
      const from0 = { x: e.clientX, y: e.clientY };
      const watch = (ev: PointerEvent) => {
        if (ev.pointerId !== pid || Math.hypot(ev.clientX - from0.x, ev.clientY - from0.y) <= PRESS_SLOP) return;
        quit();
        if (Math.abs(ev.clientX - from0.x) > Math.abs(ev.clientY - from0.y) && phonePager.current && getFormFactor() === "mobile") swipePages(pid, from0);
      };
      const quit = () => {
        window.removeEventListener("pointermove", watch);
        window.removeEventListener("pointerup", quit);
        window.removeEventListener("pointercancel", quit);
      };
      window.addEventListener("pointermove", watch);
      window.addEventListener("pointerup", quit);
      window.addEventListener("pointercancel", quit);
      return;
    }
    const id = e.pointerId;
    const from = { x: e.clientX, y: e.clientY };
    let at = { ...from };
    touchPress.current = e.pointerType !== "mouse";
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    let menuOpen = false;
    // F: held, the widget grows a little; it settles back when let go or picked up.
    const glass = ref.current?.querySelector<HTMLElement>("[data-widget-press]");
    glass?.setAttribute("data-pressed", "");
    const unpress = () => glass?.removeAttribute("data-pressed");
    window.addEventListener("pointerup", unpress, { once: true });
    window.addEventListener("pointercancel", unpress, { once: true });
    const track = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      at = { x: ev.clientX, y: ev.clientY };
      if (Math.hypot(at.x - from.x, at.y - from.y) <= PRESS_SLOP) return;
      stop();
      unpress();
      // B8: a sideways swipe begun on a widget turns the home page, as on free space.
      if (!menuOpen && Math.abs(at.x - from.x) > Math.abs(at.y - from.y) && phonePager.current && getFormFactor() === "mobile") return swipePages(id, from);
      if (!menuOpen) return;
      // E: the finger moves on after the menu opened: the menu goes and the widget is picked up instead.
      useHomeUi.getState().closeMenu();
      useHomeUi.getState().setEditing(true);
      beginDrag(from.x, from.y, undefined, id);
    };
    const timer = window.setTimeout(() => {
      navigator.vibrate?.(8);
      // E1: holding a widget shows its menu (Добавить виджет / Убрать из стопки / Удалить стопку / Убрать карусель);
      // moving the finger then picks it up (as before).
      menuOpen = true;
      const box = ref.current?.getBoundingClientRect();
      const half: 0 | 1 = columns.length > 1 && box && from.x > box.left + box.width / 2 ? 1 : 0;
      useHomeUi.getState().openMenu({ x: from.x, y: from.y, target: { kind: "widget", id: widget.id, half } });
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      const done = () => {
        window.removeEventListener("pointermove", track);
        window.removeEventListener("pointerup", done);
        window.removeEventListener("pointercancel", done);
      };
      window.addEventListener("pointerup", done);
      window.addEventListener("pointercancel", done);
    }, LONG_PRESS_MS);
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  /** B8: hands a sideways swipe from this widget to the home pager (speed over the last ~80 ms). */
  const swipePages = (pointerId: number, from: { x: number; y: number }) => {
    const pager = phonePager.current;
    if (!pager) return;
    const samples: { x: number; t: number }[] = [{ x: from.x, t: performance.now() }];
    let vx = 0;
    const mv = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const now = performance.now();
      samples.push({ x: ev.clientX, t: now });
      while (samples.length > 2 && now - samples[0]!.t > 80) samples.shift();
      const f = samples[0]!;
      if (now - f.t > 4) vx = ((ev.clientX - f.x) / (now - f.t)) * 1000;
      pager.move(ev.clientX - from.x);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const lastT = samples[samples.length - 1]!.t;
      pager.end(ev.clientX - from.x, performance.now() - lastT > 90 ? 0 : vx);
    };
    // The click that would end this swipe on the widget (a key, the clock) is swallowed, briefly.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    const end2 = () => window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 350);
    window.addEventListener("pointerup", end2, { once: true });
    window.addEventListener("pointercancel", end2, { once: true });
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const beginDrag = (clientX: number, clientY: number, grab?: { dx: number; dy: number }, pointerId?: number) => {
    const el = ref.current;
    const grid = el?.closest<HTMLElement>("[data-home-grid]");
    const host = el?.closest<HTMLElement>("[data-grid-host]") ?? grid;
    if (!el || !grid || !host) return;
    holdPointer(pointerId);
    x.stop();
    y.stop();
    const box0 = el.getBoundingClientRect();
    const natural = { left: box0.left - x.get(), top: box0.top - y.get(), w: box0.width, h: box0.height };
    // B5: handed over from another page: the card jumps under the finger where it was held.
    if (grab) {
      x.set(clientX - grab.dx - natural.left);
      y.set(clientY - grab.dy - natural.top);
    }
    const start = { x: clientX - x.get(), y: clientY - y.get() };
    let pointer = { x: clientX, y: clientY };
    const ui = useHomeUi.getState;
    const mobile = getFormFactor() === "mobile";
    // Phone: sideways the bounds are the pager (what is on screen), as for icons: the page strip may still
    // be sliding when the drag starts, and its own box would then be off to the side.
    const hostBox = host.getBoundingClientRect();
    const pagerBox = mobile ? document.querySelector<HTMLElement>("[data-home-pager]")?.getBoundingClientRect() : undefined;
    const area = pagerBox ? { left: pagerBox.left, right: pagerBox.right, top: hostBox.top, bottom: hostBox.bottom } : hostBox;
    let edgeTimer: number | undefined;
    let edgeDir = 0;
    // Update 4 · B: the layout as it was before this drag (the «Отменить» of a move that made room).
    const beforeDrag = currentLayout();
    setDragging(true);
    ui().setDrag({ item: { kind: "app", id: "settings" }, size: 0, widget: widget.id });

    const clampX = (dx: number) => Math.max(area.left - natural.left, Math.min(area.right - natural.w - natural.left, dx));
    const clampY = (dy: number) => Math.max(area.top - natural.top, Math.min(area.bottom - natural.h - natural.top, dy));
    const finish = () => {
      hoverRef.current = null;
      setHover(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.clearTimeout(edgeTimer);
      window.clearTimeout(spaceTimer);
      setDragging(false);
      ui().setDrag(null);
    };
    const settleBack = () => {
      void animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
      void animate(y, 0, { type: "spring", stiffness: 520, damping: 42 });
    };
    /** The cell under the widget's top-left cell (its centre), kept inside the page / desktop. */
    const targetCell = () => {
      const box = el.getBoundingClientRect();
      const cw = Number(grid.dataset.cellW) || box.width;
      const rh = Number(grid.dataset.rowH) || box.height;
      const hit = cellAt(grid, box.left + Math.min(cw, box.width) / 2, box.top + Math.min(rh, box.height) / 2);
      const sz = widgetCells(widget);
      // Phone: only the rows that fit on the page (in edit mode the grid offers one more row below it).
      const gr = grid.getBoundingClientRect();
      const gy = Number(grid.dataset.gapY) || 0;
      const fitRows = Math.max(sz.h, Math.floor((area.bottom - gr.top + gy) / (rh + gy)));
      const maxRows = Math.min(Number(grid.dataset.maxRows) || Infinity, fitRows);
      const cols = Number(grid.dataset.cols) || sz.w;
      const target = { c: Math.max(0, Math.min(hit.c, cols - sz.w)), r: Math.max(0, Math.min(hit.r, maxRows - sz.h)) };
      // B1 (phone): a widget narrower than the page goes to the edge on the side its centre is over.
      if (mobile && sz.w > 1 && sz.w < cols) target.c = box.left + box.width / 2 > gr.left + gr.width / 2 ? cols - sz.w : 0;
      return { box, target };
    };
    /**
     * Update 4 · B2: puts the widget there, the icons and widgets under it making way (what no longer fits
     * goes to a neighbouring page / desktop). Refused (null): nothing changes. Reports the move with
     * «Отменить» when anything else had to move.
     */
    const makeRoom = (base: WorkspaceLayout, dest: Place, cell: Cell) => {
      const g = geometryFor(dest);
      const r = g ? placeWidgetMakingRoom(base, widgetKey(widget.id), dest, cell, g) : null;
      if (!r) return null;
      if (r.moved.length || r.spilled.length || r.created) {
        const restore = beforeDrag;
        toast({
          title: translateNow(r.spilled.length ? "widgets.roomSpilled" : "widgets.roomMade"),
          action: { label: translateNow("common.undo"), onClick: () => { captureGridFlip(); updateLayout(() => restore); } },
          duration: 6000,
        });
      }
      return r.layout;
    };
    /**
     * B5: carries the widget to another phone page (a new one past the last) or PC desktop and keeps
     * dragging it there. No room there: it stays on this page, still in the hand (a short note).
     */
    const carry = (dest: Place, create: boolean) => {
      const l0 = currentLayout();
      const base = create ? { ...l0, mobile: { ...l0.mobile, pages: [...l0.mobile.pages, []] } } : l0;
      const container = dest.surface === "mobile" ? String(dest.page) : dest.space;
      const moved = moveWidget(base, widget.id, { container });
      const cell = freeBlock(moved, dest, widgetCells(widget), undefined, geometryFor(dest));
      // Update 4 · B2: no free block there: the icons there make way (from the same place on that page).
      const next = cell ? placeInCell(moved, widgetKey(widget.id), dest, cell, geometryFor(dest)) : makeRoom(base, dest, targetCell().target);
      if (!next) {
        toast({ title: translateNow("widgets.noRoom") });
        return false;
      }
      const box = el.getBoundingClientRect();
      const grab = { dx: pointer.x - box.left, dy: pointer.y - box.top };
      finish();
      // B2: the finger is kept by the workspace before this card goes away (see holdPointer).
      holdPointer(pointerId);
      captureGridFlip();
      updateLayout(() => next);
      if (dest.surface === "mobile") ui().setMobilePage(dest.page);
      else useWM.getState().setSpace(dest.space);
      navigator.vibrate?.(8);
      // While the page slides in, the finger is followed; once it has settled, the card on the new page takes it.
      let latest = { ...pointer };
      let released = false;
      const track = (ev: PointerEvent) => {
        latest = { x: ev.clientX, y: ev.clientY };
      };
      const release = () => {
        released = true;
      };
      window.addEventListener("pointermove", track);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      const settled = dest.surface === "mobile" ? pagesSettled(dest.page) : new Promise<void>((r) => window.setTimeout(r, 320));
      void settled.then(() => {
        window.removeEventListener("pointermove", track);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        // Let go meanwhile: it simply stays where it landed on the new page.
        if (released) return;
        ui().setEditing(true);
        dragResume.get(widget.id)?.({ ...latest, grab, pointerId });
      });
      return true;
    };
    /** Phone: the page beside this one (a new one past the last). */
    const toPage = (dir: -1 | 1) => {
      const l = currentLayout();
      const from = Number(widget.container);
      const to = from + dir;
      if (to < 0) return;
      const create = to >= l.mobile.pages.length;
      if (create && l.mobile.pages.length >= MOBILE_PAGES_MAX) return;
      carry({ surface: "mobile", page: create ? l.mobile.pages.length : to }, create);
    };
    let spaceTimer: number | undefined;
    let spaceOver: string | null = null;
    const move = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      x.set(clampX(ev.clientX - start.x));
      y.set(clampY(ev.clientY - start.y));
      // PC: held over another desktop's tab, the widget goes there and stays in the hand.
      if (!mobile) {
        const tab = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest<HTMLElement>("[data-home-space]")).find(Boolean);
        const space = tab?.dataset.homeSpace ?? null;
        if (space !== spaceOver) {
          spaceOver = space;
          window.clearTimeout(spaceTimer);
          if (space && space !== widget.container) spaceTimer = window.setTimeout(() => carry({ surface: "desktop", space }, false), SPACE_HOLD_MS);
        }
      }
      const hv = hoverAt(ev.clientX, ev.clientY, widget, el, columns.length > 1, grid);
      if (JSON.stringify(hv) !== JSON.stringify(hoverRef.current)) {
        hoverRef.current = hv;
        setHover(hv);
      }
      if (!mobile) return;
      const dir = ev.clientX < area.left + EDGE ? -1 : ev.clientX > area.right - EDGE ? 1 : 0;
      if (dir !== edgeDir) {
        edgeDir = dir;
        window.clearTimeout(edgeTimer);
        if (dir) edgeTimer = window.setTimeout(() => toPage(dir as -1 | 1), EDGE_HOLD_MS);
      }
    };
    const up = () => {
      const intent = hoverRef.current;
      finish();
      const place = placeOfGrid(grid.dataset.homeGrid!);
      // E1 / E2: dropped on the middle of a widget (a stack) or on the «+» beside it (a carousel).
      if (intent && (intent.kind === "stack" || intent.kind === "carousel") && place) {
        let failed: StackResult["error"];
        // B4: the target glides to the joined block (a carousel grows to its full width).
        captureGridFlip();
        updateLayout((l) => {
          const r = intent.kind === "stack" ? stackWidgets(l, widget.id, intent.target, intent.half) : joinWidgets(l, widget.id, intent.target, intent.side, geometryFor(place));
          failed = r.error;
          return r.layout ?? l;
        });
        if (failed) {
          toast({ title: translateNow(failed === "full" ? "widgets.stackFull" : failed === "carousel" ? "widgets.noCarouselInStack" : failed === "wide" ? "widgets.wideAlone" : "widgets.noRoom") });
          settleBack();
        }
        return;
      }
      // The cell under the widget's top-left cell (its centre), not under the finger; the whole block
      // stays on the page / desktop (never past the last row or the last column).
      const { box, target } = targetCell();
      const current = el.parentElement?.dataset.cell;
      if (!place || current === `${target.c},${target.r}`) return settleBack();
      // Update 4 · B2: the icons and widgets under it make way; refused only when nothing can be placed.
      const next = makeRoom(currentLayout(), place, target);
      if (!next) {
        toast({ title: translateNow("widgets.noRoom") });
        return settleBack();
      }
      snap.current = { from: box, cell: `${target.c},${target.r}` };
      captureGridFlip();
      updateLayout(() => next);
      // The cell was refused (an icon never pushes a widget away, a full area…): glide back.
      window.setTimeout(() => {
        if (snap.current) {
          snap.current = null;
          settleBack();
        }
      }, 400);
    };
    const cancel = () => {
      finish();
      settleBack();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  resumeRef.current = (p) => beginDrag(p.x, p.y, p.grab, p.pointerId);

  return (
    <motion.div
      ref={ref}
      className={cx("relative rounded-[24px]", editing && "cursor-grab touch-none", dragging && "z-30 cursor-grabbing")}
      style={{ width: size.w, height: size.h, x, y }}
      data-no-home-gesture
      data-system-ui
      data-widget={widget.id}
      data-widget-card
      data-dragging={dragging || undefined}
      data-testid={`widget-${widget.type}`}
      onPointerDown={pressStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A finger's long press picks the widget up (the browser also reports it as a context menu).
        if (touchPress.current) return;
        const box = ref.current?.getBoundingClientRect();
        const half: 0 | 1 = columns.length > 1 && box && e.clientX > box.left + box.width / 2 ? 1 : 0;
        useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "widget", id: widget.id, half } });
      }}
    >
      {/* The wiggle is its own layer: the drag moves the outer one, so the two never fight over the transform. */}
      <div className={cx("vx-glass vx-press relative size-full rounded-[24px]", editing && !dragging && "vx-wiggle", dragging && "scale-[1.03] shadow-float transition-transform")} data-widget-press>
        {editing && !dragging && (
          <RemoveBadge
            onRemove={() =>
              // E1 / E3: a stack or a carousel goes only after a confirmation (a single widget at once).
              columns.length > 1 || columns[0]!.length > 1
                ? useHomeUi.getState().setWidgetConfirm({ id: widget.id, half: 0, kind: columns.length > 1 ? "carousel" : "stack" })
                : removeAnimated([widgetKey(widget.id)], () => updateLayout((l) => removeWidget(l, widget.id)))
            }
          />
        )}
        <div className={cx("h-full", editing && "pointer-events-none")}>
          {columns.length > 1 ? (
            // E2: one wide block, two halves of their own (a widget or a stack each).
            <div className="flex size-full" data-testid="widget-carousel">
              {columns.map((col, h) => (
                <div key={h} className={cx("relative h-full w-1/2 min-w-0", h === 1 && "border-l border-[var(--glass-border)]")} data-widget-half={h}>
                  <WidgetColumn widgetId={widget.id} items={col} half={h as 0 | 1} active={h === 0 ? (widget.active ?? 0) : (widget.active2 ?? 0)} side={h === 0 ? "left" : "right"} />
                </div>
              ))}
            </div>
          ) : (
            <WidgetColumn widgetId={widget.id} items={columns[0]!} half={0} active={widget.active ?? 0} side="right" size={widget.size} />
          )}
        </div>
        {hover && createPortal(<HoverMark hover={hover} />, document.body)}
      </div>
    </motion.div>
  );
}


// ---------------------------------------------------------------- Stage E: stacks and carousels

type Hover =
  | { kind: "stack"; target: string; half: 0 | 1; rect: { left: number; top: number; width: number; height: number } }
  | { kind: "plus" | "carousel"; target: string; side: "left" | "right"; x: number; y: number };

const PLUS_R = 26;

/**
 * E1 / E2: what a dragged widget is over. The middle of another widget (of a half of a carousel) makes a
 * stack; near its left / right side a small «+» appears where a carousel would fit, and the widget let
 * go on the «+» makes the carousel. Anywhere else: an ordinary move to a cell.
 */
function hoverAt(x: number, y: number, me: Widget, mine: HTMLElement, meIsCarousel: boolean, grid: HTMLElement): Hover | null {
  const els = document.elementsFromPoint(x, y);
  let target: HTMLElement | null = null;
  for (const e of els) {
    const w = (e as HTMLElement).closest?.<HTMLElement>("[data-widget]");
    if (w && w !== mine && !mine.contains(w)) {
      target = w;
      break;
    }
  }
  // The «+» sits just outside a widget's side: look for a widget a little to the left / right too.
  if (!target) {
    for (const dx of [-PLUS_R - 10, PLUS_R + 10]) {
      for (const e of document.elementsFromPoint(x + dx, y)) {
        const w = (e as HTMLElement).closest?.<HTMLElement>("[data-widget]");
        if (w && w !== mine && !mine.contains(w)) {
          target = w;
          break;
        }
      }
      if (target) break;
    }
  }
  if (!target) return null;
  const id = target.dataset.widget!;
  const r = target.getBoundingClientRect();
  const l = currentLayout();
  const tw = l.widgets.find((w) => w.id === id);
  if (!tw) return null;
  const tCarousel = widgetColumns(tw).length > 1;
  const halfW = tCarousel ? r.width / 2 : r.width;
  const half: 0 | 1 = tCarousel && x > r.left + r.width / 2 ? 1 : 0;
  const hl = r.left + half * halfW;
  const rx = (x - hl) / halfW;
  const ry = (y - r.top) / r.height;
  if (!meIsCarousel && rx > 0.22 && rx < 0.78 && ry > 0.15 && ry < 0.85) return { kind: "stack", target: id, half, rect: { left: hl, top: r.top, width: halfW, height: r.height } };
  if (meIsCarousel || tCarousel) return null;
  const side: "left" | "right" = x < r.left + r.width / 2 ? "left" : "right";
  const place = placeOfGrid(grid.dataset.homeGrid!);
  if (!place || !carouselSpot(l, me.id, id, side, geometryFor(place))) return null;
  const px = side === "left" ? r.left - 4 : r.right + 4;
  const py = r.top + r.height / 2;
  const on = Math.hypot(x - px, y - py) <= PLUS_R + 6;
  return { kind: on ? "carousel" : "plus", target: id, side, x: px, y: py };
}

function HoverMark({ hover }: { hover: Hover }) {
  if (hover.kind === "stack")
    return <div className="pointer-events-none fixed z-[250] rounded-[26px] ring-[3px] ring-white/80 shadow-[0_0_0_6px_rgba(108,92,255,0.35)]" style={hover.rect} data-testid="widget-stack-target" aria-hidden />;
  return (
    <div
      className={cx("vx-glass pointer-events-none fixed z-[250] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform", hover.kind === "carousel" ? "scale-110 text-primary" : "text-text")}
      style={{ left: hover.x, top: hover.y, width: PLUS_R * 2, height: PLUS_R * 2 }}
      data-testid="widget-carousel-plus"
      data-active={hover.kind === "carousel" || undefined}
      aria-hidden
    >
      <RiAddCircleFill className="size-7" />
    </div>
  );
}

/** One half of a widget block: a single widget, or a stack scrolled vertically (E1, E3). */
function WidgetColumn({ widgetId, items, half, active, side, size }: { widgetId: string; items: WidgetItem[]; half: 0 | 1; active: number; side: "left" | "right"; size?: WidgetSize }) {
  if (items.length === 1) {
    const d = defOf(items[0]!.type);
    return d ? <d.Body size={size} /> : null;
  }
  return <WidgetStack widgetId={widgetId} items={items} half={half} active={active} side={side} />;
}

/** B2: a step of a stack, and the gesture thresholds (a quarter of its height, or a flick). */
const STACK_STEP_MS = 260;
const STACK_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const STACK_FLICK = 0.35; // px per ms
const STACK_DRAG_SLOP = 6;

/** Swallows the click that ends a swipe (only if it comes at once). */
function swallowNextClick() {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 350);
}

/** Circular distance of item `i` from `idx` in a stack of `n`: -⌊n/2⌋ … ⌈n/2⌉. */
function ringPos(i: number, idx: number, n: number) {
  let d = (((i - idx) % n) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

/**
 * E1 / B2: a stack. One widget in view; a vertical swipe (or one wheel gesture on a PC) shows the next
 * or the previous one, and the stack goes round endlessly both ways (… 3 → 1 → 2 …) with no jump: every
 * widget stays mounted at its place on a ring and only transforms move. One gesture is one step. No
 * scrollbar. The dots (at most 10) show while it moves and a moment after, on the left for the left
 * half of a carousel. The widget in view is kept with the layout.
 */
function WidgetStack({ widgetId, items, half, active, side }: { widgetId: string; items: WidgetItem[]; half: 0 | 1; active: number; side: "left" | "right" }) {
  const n = items.length;
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(() => Math.max(0, Math.min(active, n - 1)));
  const [dots, setDots] = useState(false);
  const [dragDir, setDragDir] = useState<-1 | 1>(1);
  const ty = useMotionValue(0);
  const busy = useRef(false);
  const timers = useRef<{ save?: number; hide?: number; wheel?: number }>({});
  const saved = useRef(active);
  const wheel = useRef({ acc: 0, locked: false });
  const reduced = useReducedMotionSafe();
  const cur = Math.min(idx, n - 1);

  const showDots = () => {
    setDots(true);
    window.clearTimeout(timers.current.hide);
    timers.current.hide = window.setTimeout(() => setDots(false), 1200);
  };
  const save = (i: number) => {
    window.clearTimeout(timers.current.save);
    timers.current.save = window.setTimeout(() => {
      if (i === saved.current) return;
      saved.current = i;
      updateLayout((l) => setStackActive(l, widgetId, half, i));
    }, 220);
  };
  /** The step lands: the new widget becomes current and the offset goes back to 0 in the same frame (no flash). */
  const resetPending = useRef(false);
  const commit = (next: number) => {
    lastLocal.current = Date.now();
    resetPending.current = true;
    setIdx(next);
    save(next);
  };
  useLayoutEffect(() => {
    if (!resetPending.current) return;
    resetPending.current = false;
    ty.set(0);
    busy.current = false;
  }, [idx, ty]);
  /** One step (dir +1: the next widget comes up from below; -1: the previous comes down). */
  const step = (dir: -1 | 1) => {
    const h = ref.current?.clientHeight ?? 0;
    if (busy.current || n < 2 || !h) return;
    busy.current = true;
    setDragDir(dir);
    showDots();
    const done = () => commit((((cur + dir) % n) + n) % n);
    if (reduced) return done();
    void animate(ty, -dir * h, { duration: STACK_STEP_MS / 1000, ease: STACK_EASE }).then(done);
  };

  // A new widget put on the stack (or the active one changed elsewhere) comes into view. Right after
  // this device's own swipes, an echo of an earlier save is not a change (the stack never jumps back).
  const lastLocal = useRef(0);
  const prevN = useRef(n);
  useEffect(() => {
    const grew = n !== prevN.current;
    prevN.current = n;
    if (active === saved.current && !grew) return;
    if (!grew && Date.now() - lastLocal.current < 2500) return;
    saved.current = active;
    setIdx(Math.max(0, Math.min(active, n - 1)));
  }, [active, n]);
  useEffect(
    () => () => {
      window.clearTimeout(timers.current.save);
      window.clearTimeout(timers.current.hide);
      window.clearTimeout(timers.current.wheel);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (n < 2 || e.button !== 0 || busy.current) return;
    const el = ref.current!;
    const h = el.clientHeight;
    const id = e.pointerId;
    const y0 = e.clientY;
    const x0 = e.clientX;
    let claimed = false;
    let last = { y: y0, t: e.timeStamp };
    let v = 0;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dy = ev.clientY - y0;
      if (!claimed) {
        if (Math.abs(dy) < STACK_DRAG_SLOP || Math.abs(dy) < Math.abs(ev.clientX - x0)) return;
        claimed = true;
        showDots();
      }
      const dt = Math.max(1, ev.timeStamp - last.t);
      v = 0.8 * ((ev.clientY - last.y) / dt) + 0.2 * v;
      last = { y: ev.clientY, t: ev.timeStamp };
      setDragDir(dy < 0 ? 1 : -1);
      // Rubber band past one widget's height: the finger never shows two steps at once.
      ty.set(Math.max(-h, Math.min(h, dy)));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!claimed) return;
      // The swipe is not a tap: the click it would end with (on the clock, a key…) does not happen.
      swallowNextClick();
      const dy = ty.get();
      const flick = Math.abs(v) > STACK_FLICK && Math.sign(v) === Math.sign(dy);
      if (ev.type !== "pointercancel" && (Math.abs(dy) > h * 0.22 || flick)) {
        const dir: -1 | 1 = dy < 0 ? 1 : -1;
        busy.current = true;
        showDots();
        const finish = () => commit((((cur + dir) % n) + n) % n);
        if (reduced) finish();
        else void animate(ty, -dir * h, { duration: (STACK_STEP_MS * Math.max(0.45, 1 - Math.abs(dy) / h)) / 1000, ease: STACK_EASE }).then(finish);
      } else {
        void animate(ty, 0, { duration: 0.2, ease: STACK_EASE });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (n < 2 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.stopPropagation();
    const w = wheel.current;
    // One wheel gesture (a trackpad's inertia included) = one step: locked until the wheel rests.
    window.clearTimeout(timers.current.wheel);
    timers.current.wheel = window.setTimeout(() => {
      w.acc = 0;
      w.locked = false;
    }, 180);
    if (w.locked) return;
    w.acc += e.deltaY;
    if (Math.abs(w.acc) < 30) return;
    w.locked = true;
    step(w.acc > 0 ? 1 : -1);
  };

  return (
    <div
      className="relative size-full"
      data-testid="widget-stack"
      data-count={n}
      data-active={cur}
      data-half={half}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") step(1);
        else if (e.key === "ArrowUp") step(-1);
      }}
    >
      <div
        ref={ref}
        className="relative size-full overflow-hidden rounded-[24px]"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        data-widget-stack
      >
        <motion.div className="absolute inset-0" style={{ y: ty }}>
          {items.map((it, i) => {
            const d = defOf(it.type);
            let pos = ringPos(i, cur, n);
            // Two widgets: the other one waits on the side the finger is going to.
            if (n === 2 && pos !== 0) pos = dragDir;
            const near = Math.abs(pos) <= 1;
            return (
              <div
                key={it.id}
                className="absolute inset-0"
                style={{ transform: `translate3d(0, ${pos * 100}%, 0)`, visibility: near ? "visible" : "hidden" }}
                aria-hidden={pos !== 0}
                inert={pos !== 0 ? true : undefined}
                data-stack-item={it.id}
                data-stack-pos={pos}
              >
                {d ? <d.Body /> : null}
              </div>
            );
          })}
        </motion.div>
      </div>
      <div
        className={cx("pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col gap-[5px] transition-opacity duration-300", side === "left" ? "left-1.5" : "right-1.5", dots ? "opacity-100" : "opacity-0")}
        data-testid="widget-stack-dots"
        data-visible={dots || undefined}
        aria-hidden
      >
        {items.map((it, i) => (
          <span key={it.id} className={cx("size-[6px] rounded-full transition-colors", i === cur ? "bg-[var(--text)]" : "bg-[color-mix(in_srgb,var(--text)_28%,transparent)]")} />
        ))}
      </div>
    </div>
  );
}

/** Reduced motion, safe outside a browser. */
function useReducedMotionSafe() {
  const [r, setR] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/** E1 / E3: removing a whole stack or carousel is confirmed first (the apps and their data stay). */
export function WidgetConfirm() {
  const t = useT();
  const c = useHomeUi((s) => s.widgetConfirm);
  const close = () => useHomeUi.getState().setWidgetConfirm(null);
  return (
    <ConfirmDialog
      open={!!c}
      onClose={close}
      onConfirm={() => {
        if (!c) return;
        close();
        // B7: a whole stack / carousel shrinks away; one half of a carousel goes and the other glides into place.
        const w = currentLayout().widgets.find((x) => x.id === c.id);
        const whole = c.kind === "carousel" || !w?.items2?.length;
        const apply = () => updateLayout((l) => (c.kind === "carousel" ? removeWidget(l, c.id) : deleteWidgetHalf(l, c.id, c.half)));
        if (whole) removeAnimated([widgetKey(c.id)], apply);
        else removeAnimated([document.querySelector<HTMLElement>(`[data-widget="${c.id}"] [data-widget-half="${c.half}"]`)], apply);
      }}
      title={c?.kind === "carousel" ? t("widgets.deleteCarouselTitle") : t("widgets.deleteStackTitle")}
      message={t("widgets.deleteStackBody")}
      confirmLabel={t("widgets.remove")}
      danger
      testId="widget-confirm"
    />
  );
}

/** Categories view (no grid): widgets of this page / desktop in a row above the groups. */
export function WidgetStrip({ layout, surface, container, editing }: { layout: WorkspaceLayout; surface: "mobile" | "desktop"; container: string; editing: boolean }) {
  const widgets = layout.widgets.filter((w) => w.surface === surface && w.container === container && defOf(w.type));
  if (!widgets.length) return null;
  return (
    <div className="mx-auto mb-5 flex flex-wrap justify-center gap-3" data-testid="widget-strip">
      {widgets.map((w) => {
        const cells = widgetCells(w);
        return <GridWidget key={w.id} widget={w} editing={editing} size={{ w: cells.w * 112, h: cells.h * 116 }} />;
      })}
    </div>
  );
}

/** The preview of a widget at its home-screen proportions (scaled to `size` px). */
function WidgetPreview({ def, size }: { def: WidgetDef; size: number }) {
  const base = 232;
  const k = size / base;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-system-ui aria-hidden>
      <div className="vx-glass absolute left-0 top-0 origin-top-left rounded-[26px]" style={{ width: base, height: base, transform: `scale(${k})` }}>
        <def.Body preview />
      </div>
    </div>
  );
}

/**
 * «Добавить виджет» (Step 2.15, the references): first the catalogue (search,
 * a preview of every widget, its name and the app it comes from), then the
 * chosen widget's page: a large preview, its options when it has any, and
 * «Добавить виджет». Phone: it lands in the first free place from the top of
 * the current page; PC: next to where the desktop menu was opened.
 */
export function WidgetsPanel() {
  const t = useT();
  const lang = useLanguage();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.widgetsOpen);
  const at = useHomeUi((s) => s.widgetsAt);
  const setOpen = useHomeUi((s) => s.setWidgetsOpen);
  const { layout } = useWorkspaceLayout();
  const space = useWM((s) => s.space);
  const page = useHomeUi((s) => s.mobilePage);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<WidgetType | null>(null);
  const full = !useHomeUi.getState().widgetsStack && layout.widgets.length >= WIDGETS_MAX;
  useEffect(() => {
    if (!open) {
      setChosen(null);
      setQ("");
    }
  }, [open]);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return WIDGETS.filter((w) => !query || `${t(w.title)} ${t(w.name)} ${t(w.description)} ${APP_REGISTRY[w.app].name[lang]} ${w.keywords}`.toLowerCase().includes(query));
  }, [q, t, lang]);
  const def = chosen ? defOf(chosen) : undefined;

  const stack = useHomeUi((s) => s.widgetsStack);
  const add = (type: WidgetType) => {
    // E1: «Добавить виджет» from a widget's menu: on top of that stack (or that half of a carousel).
    if (stack) {
      let failed: StackResult["error"];
      updateLayout((l) => {
        const r = addToStack(l, stack.id, stack.half, type);
        failed = r.error;
        return r.layout ?? l;
      });
      if (failed) toast({ title: t(failed === "full" ? "widgets.stackFull" : "widgets.noRoom") });
      setOpen(false);
      return;
    }
    const size = WIDGET_CELLS[type];
    if (ff === "desktop") {
      const place = { surface: "desktop" as const, space };
      const grid = document.querySelector<HTMLElement>(`[data-home-grid="desktop:${space}"]`);
      const point = at && grid ? cellAt(grid, at.x, at.y) : undefined;
      const near = point ? { c: Math.max(0, point.c - Math.floor((size.w - 1) / 2)), r: Math.max(0, point.r - Math.floor((size.h - 1) / 2)) } : undefined;
      updateLayout((l) => {
        const cell = freeBlock(l, place, size, near, desktopGeometry()) ?? undefined;
        return addWidget(l, type, { surface: "desktop", space, cell });
      });
    } else {
      const p = Math.min(page, layout.mobile.pages.length - 1);
      const dest = { surface: "mobile" as const, page: p };
      // A2: only where the whole widget is visible; a full page says so instead of adding it out of sight.
      const cell = freeBlock(currentLayout(), dest, size, undefined, geometryFor(dest));
      if (!cell) {
        toast({ title: t("widgets.noRoom") });
        return;
      }
      updateLayout((l) => addWidget(l, type, { surface: "mobile", page: p, cell: freeBlock(l, dest, size, undefined, geometryFor(dest)) ?? cell }));
    }
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} width={ff === "desktop" ? 560 : 480} testId="widgets-panel">
      <AnimatePresence mode="wait" initial={false}>
        {!def ? (
          <motion.div key="list" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }} className="space-y-4" data-testid="widgets-list">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-[19px] font-semibold tracking-tight">{t("widgets.add")}</h2>
              <IconButton label={t("common.close")} onClick={() => setOpen(false)} size="sm" data-testid="widgets-close">
                <RiCloseLine className="size-5" />
              </IconButton>
            </div>
            <VoidexSearchField value={q} onChange={setQ} placeholder={t("widgets.search")} aria-label={t("widgets.search")} testId="widgets-search" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-5" data-testid="widgets-catalog">
              {shown.map((d) => (
                // A div: the preview inside has buttons of its own (a button can't hold buttons).
                <div
                  key={d.type}
                  role="button"
                  tabIndex={0}
                  onClick={() => setChosen(d.type)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setChosen(d.type);
                  }}
                  aria-label={`${APP_REGISTRY[d.app].name[lang]}: ${t(d.name)}`}
                  className="pressable flex flex-col items-center gap-2 rounded-[24px] p-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  data-testid={`widget-card-${d.type}`}
                >
                  <span className="flex aspect-square w-full items-center justify-center rounded-[26px] bg-surface-secondary/70 p-[8%]">
                    <ResponsivePreview def={d} />
                  </span>
                  <span className="block">
                    <span className="block text-[14.5px] font-semibold leading-tight text-text">{APP_REGISTRY[d.app].name[lang]}</span>
                    <span className="block text-[12.5px] text-text-secondary">{t(d.name)}</span>
                  </span>
                </div>
              ))}
            </div>
            {!shown.length && <p className="px-1 text-[14px] text-text-secondary">{t("widgets.nothing")}</p>}
          </motion.div>
        ) : (
          <motion.div key={`cfg-${def.type}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }} className="flex flex-col" data-testid={`widget-config-${def.type}`}>
            <div className="flex items-center gap-2">
              <IconButton label={t("common.back")} onClick={() => setChosen(null)} size="sm" data-testid="widget-config-back">
                <RiArrowLeftSLine className="size-5" />
              </IconButton>
              <span className="vx-app-tile flex size-7 items-center justify-center rounded-[9px] bg-surface shadow-tile">
                <def.Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{APP_REGISTRY[def.app].name[lang]}</span>
              <IconButton label={t("common.close")} onClick={() => setOpen(false)} size="sm" data-testid="widgets-close">
                <RiCloseLine className="size-5" />
              </IconButton>
            </div>
            <h2 className="mt-4 text-center text-[24px] font-bold tracking-tight">{t(def.name)}</h2>
            <p className="mx-auto mt-1 max-w-[340px] text-center text-[14px] text-text-secondary">{t(def.description)}</p>
            <div className="flex justify-center py-8" data-testid="widget-config-preview">
              <div className="rounded-[30px] shadow-[0_18px_40px_-18px_rgba(40,28,110,0.45)]">
                <WidgetPreview def={def} size={ff === "desktop" ? 232 : 220} />
              </div>
            </div>
            <Button className="h-12 w-full rounded-full text-[16px]" onClick={() => add(def.type)} disabled={full} data-testid={`widget-add-${def.type}`}>
              <RiAddCircleFill className="size-5" />
              {t("widgets.add")}
            </Button>
            {full && <p className="mt-2 text-center text-[12.5px] text-text-tertiary">{t("widgets.full")}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

/** A catalogue preview that fills its square, whatever the column width. */
function ResponsivePreview({ def }: { def: WidgetDef }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    setSize(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} className="block size-full">{size > 0 && <WidgetPreview def={def} size={size} />}</span>;
}
