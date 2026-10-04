import { useEffect, useMemo, useRef, useState } from "react";
import { RiCheckLine, RiEqualizerLine, RiImageAddLine } from "@remixicon/react";
import { WALLPAPER_PRESETS, type Wallpaper } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { Button, Spinner, Switch } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { VoidexMark } from "@/brand/brand";
import { DEFAULT_SWATCH, PRESETS, useWallpaperImage, wallpaperStyle, type WallpaperSlot } from "@/os/home/appearance";
import { WALLPAPER_LABEL } from "@/os/home/appearance-panel";
import { useWallpapers } from "@/os/home/wallpapers";
import { SectionTitle } from "../kit";

type Filter = "all" | "light" | "waves" | "mine";
/** A carousel entry: what applying it stores (null: the lock screen follows the home screen). */
interface Option {
  key: string;
  wallpaper: Wallpaper | null;
  label: string;
  kind: "light" | "wave" | "mine" | "same";
}

const same = (a: Wallpaper | null, b: Wallpaper | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → Wallpapers (Step 2.5): Lock screen / Home screen tabs with a
 * matching preview, a carousel (the neighbours peek in at the sides, dots
 * below), Filters · Apply · Add your own, and "Синхронизация обоев в VOIDEX".
 */
export function WallpapersSection() {
  const t = useT();
  const ff = useFormFactor();
  const wp = useWallpapers();
  const [tab, setTab] = useState<"lock" | "home">("lock");
  const [filter, setFilter] = useState<Filter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const slot: WallpaperSlot = tab === "lock" ? "lock" : "desktop";
  const applied = tab === "lock" ? wp.lockWallpaper : wp.wallpaper;

  const options = useMemo<Option[]>(() => {
    const all: Option[] = [];
    if (tab === "lock") all.push({ key: "same", wallpaper: null, label: t("lockSettings.asDesktop"), kind: "same" });
    all.push({ key: "default", wallpaper: { kind: "default" }, label: t("wallpaper.default"), kind: "light" });
    for (const id of WALLPAPER_PRESETS) all.push({ key: id, wallpaper: { kind: "preset", id }, label: t(WALLPAPER_LABEL[id]), kind: id.startsWith("wave") ? "wave" : "light" });
    if (applied?.kind === "image") all.push({ key: "image", wallpaper: applied, label: t("appearance.image"), kind: "mine" });
    return all.filter((o) => filter === "all" || (filter === "light" && (o.kind === "light" || o.kind === "same")) || (filter === "waves" && o.kind === "wave") || (filter === "mine" && o.kind === "mine"));
  }, [tab, filter, applied, t]);

  // Open on the wallpaper in use.
  useEffect(() => {
    const i = Math.max(0, options.findIndex((o) => same(o.wallpaper, applied)));
    setIndex(i);
    const el = strip.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: "center", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter]);

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
    setIndex(best);
  };
  const goTo = (i: number) => {
    setIndex(i);
    (strip.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
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
      setFilter("all");
    } catch {
      toast({ title: t("appearance.imageFailed"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const phone = ff === "mobile";
  return (
    <div data-testid="settings-wallpapers">
      <SectionTitle subtitle={t("wallpapers.subtitle")}>{t("settings.wallpapers")}</SectionTitle>

      <div className="mx-auto mb-4 grid max-w-[360px] grid-cols-2 gap-1 rounded-full bg-surface-secondary p-1" role="tablist">
        {(["lock", "home"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("h-10 rounded-full text-[14px] font-semibold transition", tab === k ? "bg-surface text-text shadow-sm" : "text-text-secondary")}
            data-testid={`wallpapers-tab-${k}`}
          >
            {k === "lock" ? t("wallpapers.lock") : t("wallpapers.home")}
          </button>
        ))}
      </div>

      {filtersOpen && (
        <div className="mb-3 flex flex-wrap justify-center gap-2" data-testid="wallpapers-filters">
          {(["all", "light", "waves", "mine"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cx("h-8 rounded-full px-3.5 text-[13px] font-medium", filter === f ? "bg-primary text-white" : "bg-surface-secondary text-text-secondary")}
              data-testid={`wallpapers-filter-${f}`}
            >
              {t(`wallpapers.filter.${f}`)}
            </button>
          ))}
        </div>
      )}

      {/* Carousel: the cards snap to the centre, the neighbours show at the sides. */}
      <div
        ref={strip}
        onScroll={onScroll}
        className="scroll-area -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-[18%] pb-2 pt-1 [scrollbar-width:none] sm:-mx-2"
        data-testid="wallpapers-carousel"
      >
        {options.map((o, i) => (
          <button
            key={o.key + tab}
            type="button"
            onClick={() => goTo(i)}
            aria-label={o.label}
            aria-current={i === index || undefined}
            className={cx("shrink-0 snap-center transition-[transform,opacity] duration-300", i === index ? "scale-100 opacity-100" : "scale-[0.9] opacity-70")}
            style={{ width: phone ? "64%" : "min(56%, 420px)" }}
            data-testid={`wallpapers-option-${o.key}`}
          >
            <PreviewCard option={o} tab={tab} desktop={wp.wallpaper} slot={slot} phone={phone} applied={same(o.wallpaper, applied)} />
            <span className="mt-2 block truncate text-center text-[13px] font-medium text-text-secondary">{o.label}</span>
          </button>
        ))}
        {!options.length && <p className="w-full py-16 text-center text-[14px] text-text-tertiary">{t("wallpapers.none")}</p>}
      </div>
      <div className="mt-1 flex justify-center gap-1.5" aria-hidden data-testid="wallpapers-dots">
        {options.map((o, i) => (
          <span key={o.key} className={cx("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-1.5 bg-border-strong")} />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <Button variant="secondary" onClick={() => setFiltersOpen((v) => !v)} aria-pressed={filtersOpen} data-testid="wallpapers-filters-toggle">
          <RiEqualizerLine className="size-4" /> {t("wallpapers.filters")}
        </Button>
        <Button onClick={apply} disabled={isApplied || !current} data-testid="wallpapers-apply">
          {isApplied ? <RiCheckLine className="size-4" /> : null}
          {isApplied ? t("wallpapers.inUse") : t("wallpapers.apply")}
        </Button>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy} data-testid="wallpapers-add">
          {busy ? <Spinner size={16} /> : <RiImageAddLine className="size-4" />} {t("wallpapers.add")}
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
      </div>
    </div>
  );
}

/** The wallpaper as it will look: a lock screen (time) or a home screen (icons), phone- or PC-shaped. */
function PreviewCard({ option, tab, desktop, slot, phone, applied }: { option: Option; tab: "lock" | "home"; desktop: Wallpaper; slot: WallpaperSlot; phone: boolean; applied: boolean }) {
  const lang = useLanguage();
  const look = option.wallpaper ?? desktop;
  const lookSlot: WallpaperSlot = option.wallpaper ? slot : "desktop";
  const image = useWallpaperImage(look, lookSlot);
  const w = look.kind === "default" ? { style: { background: DEFAULT_SWATCH }, dark: false } : wallpaperStyle(look, image.data);
  const dark = look.kind === "preset" ? !!PRESETS[look.id as keyof typeof PRESETS]?.dark : w.dark;
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date());
  return (
    <span
      className={cx("relative block w-full overflow-hidden border border-black/10 shadow-tile", phone ? "aspect-[9/17] rounded-[28px]" : "aspect-[16/10] rounded-[20px]", applied && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")}
      style={w.style}
    >
      {tab === "lock" ? (
        <span className="flex h-full flex-col items-center pt-[12%]">
          <span className={cx("text-[34px] font-extralight leading-none tracking-tight", dark ? "text-white" : "text-text")}>{time}</span>
          <span className="mt-auto mb-[10%] grid size-9 place-items-center rounded-full bg-white/70 p-2 shadow-sm backdrop-blur">
            <VoidexMark className="size-full" />
          </span>
        </span>
      ) : (
        <span className={cx("grid gap-[6%] p-[9%]", phone ? "grid-cols-3 pt-[22%]" : "grid-cols-6 pt-[8%]")}>
          {Array.from({ length: phone ? 9 : 12 }, (_, i) => (
            <span key={i} className="aspect-square rounded-[24%] bg-white/80 shadow-sm" />
          ))}
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
