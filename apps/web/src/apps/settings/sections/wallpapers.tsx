import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine, RiImageAddLine } from "@remixicon/react";
import { WALLPAPER_PRESETS, type Wallpaper } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { Button, Spinner, Switch } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { VoidexMark } from "@/brand/brand";
import { FaceGlyph } from "@/os/lock/face-glyph";
import { DEFAULT_SWATCH, PRESETS, useWallpaperImage, wallpaperStyle, type WallpaperSlot } from "@/os/home/appearance";
import { WALLPAPER_LABEL } from "@/os/home/appearance-panel";
import { useWallpapers } from "@/os/home/wallpapers";
import { SectionTitle } from "../kit";

export type WallpaperTab = "lock" | "home";

/** The tab the next opened Wallpapers screen starts on (links from Lock screen / Desktop / the home screen). */
let nextTab: WallpaperTab = "lock";
export function setNextWallpaperTab(tab: WallpaperTab) {
  nextTab = tab;
}

/** A carousel entry: what applying it stores (null: the lock screen follows the home screen). */
interface Option {
  key: string;
  wallpaper: Wallpaper | null;
  label: string;
}

const same = (a: Wallpaper | null, b: Wallpaper | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → Wallpapers — the one place where wallpapers are chosen (Step
 * 2.5.1): Lock screen / Home screen (PC: Desktop) tabs, a carousel of
 * previews (the current one in the middle, the neighbours peeking in, dots
 * below), Apply · Add your own, and "Синхронизация обоев в VOIDEX". Other
 * sections only link here.
 *
 * Geometry is fixed: the strip is exactly as wide as its column and its side
 * padding is measured so every card (the first and the last too) can sit in
 * the middle; cards are brought there by scrolling the strip itself, never
 * its ancestors — so nothing around the carousel moves.
 */
export function WallpapersSection() {
  const t = useT();
  const ff = useFormFactor();
  const wp = useWallpapers();
  const [tab, setTab] = useState<WallpaperTab>(() => nextTab);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  /** While a chosen card scrolls into the middle, the passing cards don't become current. */
  const target = useRef<number | null>(null);
  const slot: WallpaperSlot = tab === "lock" ? "lock" : "desktop";
  const applied = tab === "lock" ? wp.lockWallpaper : wp.wallpaper;
  const phone = ff === "mobile";

  useEffect(() => () => void (nextTab = "lock"), []);

  const options = useMemo<Option[]>(() => {
    const all: Option[] = [];
    if (tab === "lock") all.push({ key: "same", wallpaper: null, label: t("lockSettings.asDesktop") });
    all.push({ key: "default", wallpaper: { kind: "default" }, label: t("wallpaper.default") });
    for (const id of WALLPAPER_PRESETS) all.push({ key: id, wallpaper: { kind: "preset", id }, label: t(WALLPAPER_LABEL[id]) });
    if (applied?.kind === "image") all.push({ key: "image", wallpaper: applied, label: t("appearance.image") });
    return all;
  }, [tab, applied, t]);

  // The strip's own width decides the card size and the side padding (no percentages of other boxes).
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const card = Math.round(phone ? Math.min(width * 0.56, 240) : Math.min(width * 0.5, 400)) || 220;
  const pad = Math.max(0, Math.round((width - card) / 2));

  /** Scrolls only the strip (scrollIntoView would also scroll the Settings page and the window). */
  const centre = (i: number, smooth: boolean) => {
    const s = strip.current;
    const el = s?.children[i] as HTMLElement | undefined;
    if (!s || !el) return;
    s.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - s.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
  };

  // Open on the wallpaper in use (again when the tab changes or the strip is resized).
  useLayoutEffect(() => {
    const i = Math.max(0, options.findIndex((o) => same(o.wallpaper, applied)));
    setIndex(i);
    centre(i, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, width]);

  const onScroll = () => {
    const s = strip.current;
    if (!s) return;
    const mid = s.scrollLeft + s.clientWidth / 2;
    let best = 0;
    let dist = Infinity;
    [...s.children].forEach((c, i) => {
      const el = c as HTMLElement;
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (target.current !== null) {
      if (best === target.current) target.current = null;
      return;
    }
    setIndex(best);
  };
  const goTo = (i: number) => {
    const n = Math.max(0, Math.min(options.length - 1, i));
    target.current = n;
    window.setTimeout(() => (target.current = null), 800);
    setIndex(n);
    centre(n, true);
  };

  const current = options[index];
  const isApplied = current ? same(current.wallpaper, applied) : true;
  const apply = () => {
    if (!current) return;
    if (tab === "lock") wp.setLockWallpaper(current.wallpaper);
    else if (current.wallpaper) wp.setWallpaper(current.wallpaper);
    toast({ title: t("wallpapers.applied"), tone: "success" });
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const w = await wp.upload(file, slot);
      if (tab === "lock") wp.setLockWallpaper(w);
      else wp.setWallpaper(w);
    } catch {
      toast({ title: t("appearance.imageFailed"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="settings-wallpapers" data-tab={tab}>
      <SectionTitle subtitle={t("wallpapers.subtitle")}>{t("settings.wallpapers")}</SectionTitle>

      <div className="mx-auto mb-4 grid w-full max-w-[380px] grid-cols-2 gap-1 rounded-full bg-surface-secondary p-1" role="tablist">
        {(["lock", "home"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("h-10 min-w-0 truncate rounded-full px-2 text-[14px] font-semibold transition-colors", tab === k ? "bg-surface text-text shadow-sm" : "text-text-secondary")}
            data-testid={`wallpapers-tab-${k}`}
          >
            {k === "lock" ? t("wallpapers.lock") : phone ? t("wallpapers.home") : t("wallpapers.desktop")}
          </button>
        ))}
      </div>

      {/* Carousel: the cards snap to the middle, the neighbours show at the sides. */}
      <div className="relative" data-testid="wallpapers-stage">
        <div
          ref={strip}
          onScroll={onScroll}
          className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingInline: pad, scrollPaddingInline: pad }}
          data-testid="wallpapers-carousel"
        >
          {options.map((o, i) => (
            <button
              key={o.key + tab}
              type="button"
              onClick={() => goTo(i)}
              aria-label={o.label}
              aria-current={i === index || undefined}
              className={cx("shrink-0 snap-center transition-[transform,opacity] duration-300", i === index ? "scale-100 opacity-100" : "scale-[0.88] opacity-70")}
              style={{ width: card }}
              data-testid={`wallpapers-option-${o.key}`}
            >
              <PreviewCard option={o} tab={tab} desktop={wp.wallpaper} slot={slot} phone={phone} applied={same(o.wallpaper, applied)} />
              <span className="mt-2 block truncate text-center text-[13px] font-medium text-text-secondary">{o.label}</span>
            </button>
          ))}
        </div>
        {!phone && (
          <>
            <ArrowButton side="left" disabled={index <= 0} onClick={() => goTo(index - 1)} label={t("common.back")} />
            <ArrowButton side="right" disabled={index >= options.length - 1} onClick={() => goTo(index + 1)} label={t("common.next")} />
          </>
        )}
      </div>
      <div className="mt-1 flex h-2 items-center justify-center gap-1.5" data-testid="wallpapers-dots">
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            tabIndex={-1}
            aria-label={o.label}
            onClick={() => goTo(i)}
            className={cx("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-1.5 bg-border-strong")}
          />
        ))}
      </div>

      <div className="mx-auto mt-5 grid w-full max-w-[460px] grid-cols-2 gap-3" data-testid="wallpapers-actions">
        <Button onClick={apply} disabled={isApplied || !current} className="min-w-0" data-testid="wallpapers-apply">
          {isApplied ? <RiCheckLine className="size-4 shrink-0" /> : null}
          <span className="truncate">{isApplied ? t("wallpapers.inUse") : t("wallpapers.apply")}</span>
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy} className="min-w-0" data-testid="wallpapers-add">
          {busy ? <Spinner size={16} /> : <RiImageAddLine className="size-4 shrink-0" />}
          <span className="truncate">{t("wallpapers.add")}</span>
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="wallpapers-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-[22px] border border-border/70 bg-surface p-4 shadow-tile" data-testid="wallpapers-sync">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-text">{t("wallpapers.sync")}</span>
          <span className="block text-[12.5px] leading-snug text-text-tertiary">{wp.sync ? t("wallpapers.syncOn") : t("wallpapers.syncOff")}</span>
        </span>
        <span className="grid w-11 shrink-0 place-items-center">
          {syncBusy ? (
            <Spinner size={16} />
          ) : (
            <Switch
              checked={wp.sync}
              label={t("wallpapers.sync")}
              onChange={(on) => {
                setSyncBusy(true);
                void wp.setSync(on).finally(() => setSyncBusy(false));
              }}
            />
          )}
        </span>
      </div>
    </div>
  );
}

function ArrowButton({ side, disabled, onClick, label }: { side: "left" | "right"; disabled: boolean; onClick: () => void; label: string }) {
  const Icon = side === "left" ? RiArrowLeftSLine : RiArrowRightSLine;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cx(
        "vx-glass-strong absolute top-[calc(50%-14px)] grid size-9 -translate-y-1/2 place-items-center rounded-full text-text shadow-tile transition-opacity disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-1" : "right-1",
      )}
      data-testid={`wallpapers-${side === "left" ? "prev" : "next"}`}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** The wallpaper as it will look: a lock screen (time, unlock) or a home screen (icons, dock), phone- or PC-shaped. */
function PreviewCard({ option, tab, desktop, slot, phone, applied }: { option: Option; tab: WallpaperTab; desktop: Wallpaper; slot: WallpaperSlot; phone: boolean; applied: boolean }) {
  const lang = useLanguage();
  const look = option.wallpaper ?? desktop;
  const lookSlot: WallpaperSlot = option.wallpaper ? slot : "desktop";
  const image = useWallpaperImage(look, lookSlot);
  const w = look.kind === "default" ? { style: { background: DEFAULT_SWATCH }, dark: false } : wallpaperStyle(look, image.data);
  const dark = look.kind === "preset" ? !!PRESETS[look.id as keyof typeof PRESETS]?.dark : w.dark;
  const now = new Date();
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(now);
  const ink = dark ? "text-white" : "text-text";
  return (
    <span
      className={cx("relative block w-full overflow-hidden border border-black/10 shadow-tile", phone ? "aspect-[9/17] rounded-[28px]" : "aspect-[16/10] rounded-[20px]", applied && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")}
      style={w.style}
    >
      {tab === "lock" ? (
        <span className="flex h-full flex-col items-center" style={{ paddingTop: phone ? "16%" : "8%" }}>
          <span className={cx("truncate text-[11px] font-medium opacity-80", ink)}>{date}</span>
          <span className={cx("font-extralight leading-none tracking-tight", ink, phone ? "text-[40px]" : "text-[36px]")}>{time}</span>
          {phone ? (
            <span className="mt-auto mb-[8%] flex w-full items-center justify-between px-[10%]">
              <span className="size-7 rounded-full bg-black/10 ring-1 ring-white/50 backdrop-blur" />
              <span className="grid size-8 place-items-center rounded-full bg-white/70 p-1.5 shadow-sm backdrop-blur">
                <FaceGlyph state="idle" className="size-full" />
              </span>
              <span className="size-7 rounded-full bg-black/10 ring-1 ring-white/50 backdrop-blur" />
            </span>
          ) : (
            <span className="mt-auto mb-[7%] flex flex-col items-center gap-1.5">
              <span className="grid size-8 place-items-center rounded-full bg-white/70 p-1.5 shadow-sm backdrop-blur">
                <VoidexMark className="size-full" />
              </span>
              <span className="h-2 w-16 rounded-full bg-black/10" />
            </span>
          )}
        </span>
      ) : phone ? (
        <span className="flex h-full flex-col">
          <span className="grid grid-cols-4 gap-[9%] px-[10%] pt-[20%]">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[26%] bg-white/80 shadow-sm" />
            ))}
          </span>
          <span className="mx-[6%] mb-[6%] mt-auto grid grid-cols-4 gap-[9%] rounded-[18px] bg-black/[0.06] p-[5%] ring-1 ring-white/50 backdrop-blur" data-testid="wallpapers-preview-dock">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[26%] bg-white/90 shadow-sm" />
            ))}
          </span>
        </span>
      ) : (
        <span className="flex h-full flex-col">
          <span className="h-[7%] w-full bg-black/[0.05]" />
          <span className="grid grid-cols-8 gap-[4%] px-[6%] pt-[6%]">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[24%] bg-white/80 shadow-sm" />
            ))}
          </span>
          <span className="mx-auto mb-[3%] mt-auto flex h-[11%] w-[46%] items-center gap-[4%] rounded-[10px] bg-black/[0.06] px-[3%] ring-1 ring-white/50 backdrop-blur" data-testid="wallpapers-preview-dock">
            <span className="h-[45%] flex-[2] rounded-full bg-white/90" />
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="aspect-square h-[70%] rounded-[24%] bg-white/90" />
            ))}
          </span>
        </span>
      )}
      {applied && (
        <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-white shadow">
          <RiCheckLine className="size-4" />
        </span>
      )}
    </span>
  );
}
