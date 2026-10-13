import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiStarFill, RiStarLine } from "@remixicon/react";
import { APP_REGISTRY } from "@voidex/shared";
import { AppTile } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useLanguage, useT } from "@/lib/i18n";
import { CLIENT_APPS } from "@/os/app-registry";
import { useWM } from "@/os/window-manager";
import { Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { CATALOG, type StoreAppId } from "./catalog";
import { installApp, useAppStates, useInstalls, useStoreStats } from "./data";

/** An app's icon in its white tile (the same look as on the desktop). */
export function StoreIcon({ id, size = 56 }: { id: StoreAppId; size?: number }) {
  const { Icon } = CLIENT_APPS[id];
  return (
    <AppTile size={size} className="shrink-0">
      <span className="flex items-center justify-center" style={{ width: "58%", height: "58%" }}>
        <Icon className="size-full" />
      </span>
    </AppTile>
  );
}

export function useAppName() {
  const lang = useLanguage();
  return (id: StoreAppId) => APP_REGISTRY[id].name[lang] ?? APP_REGISTRY[id].name.en;
}

/** Stars for a rating (filled / empty), read-only. */
export function Stars({ value, size = 12, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-[1px] text-[#ffb020]", className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (n <= Math.round(value) ? <RiStarFill key={n} style={{ width: size, height: size }} /> : <RiStarLine key={n} style={{ width: size, height: size }} className="text-text-tertiary/60" />))}
    </span>
  );
}

/**
 * The one install / open / update button. Honest progress: while the app's
 * code downloads it shows a spinner (the browser reports no percent for it);
 * a second press waits; on an error the old state stays.
 */
export function GetButton({ id, size = "md", onColor = false }: { id: StoreAppId; size?: "md" | "lg"; /** On a coloured card (the carousel): a white button. */ onColor?: boolean }) {
  const t = useT();
  const state = useAppStates()[id];
  const busy = useInstalls((s) => !!s.busy[id]);
  const name = useAppName()(id);
  const run = async () => {
    if (state === "open") return void useWM.getState().open(id);
    try {
      await installApp(id);
      toast({ title: t(state === "update" ? "store.updated" : "store.installed", { app: name }), tone: "success" });
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    }
  };
  const label = state === "open" ? t("store.open") : state === "update" ? t("store.update") : t("store.get");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void run();
      }}
      disabled={busy}
      aria-busy={busy}
      aria-label={busy ? t(state === "update" ? "store.updating" : "store.installing", { app: name }) : `${label}: ${name}`}
      className={cx(
        "pressable relative flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors disabled:cursor-wait",
        size === "lg" ? "h-10 min-w-[112px] px-5 text-[15px]" : "h-8 min-w-[84px] px-4 text-[14px]",
        onColor ? "bg-white text-primary shadow-[0_6px_16px_-8px_rgba(40,20,120,0.5)]" : state === "open" ? "bg-primary/10 text-primary" : "bg-primary text-white shadow-[0_6px_16px_-8px_rgba(108,92,255,0.8)]",
      )}
      data-testid="store-get"
      data-app={id}
      data-state={busy ? "installing" : state}
    >
      {busy ? <Spinner size={16} className={state === "open" || onColor ? "" : "text-white"} /> : label}
    </button>
  );
}

/** A row of the catalog: icon, name, subtitle, rating, the button. A tap opens the app's page. */
export function AppRow({ id, onOpen, rank }: { id: StoreAppId; onOpen: (id: StoreAppId) => void; rank?: number }) {
  const t = useT();
  const name = useAppName()(id);
  const stats = useStoreStats().data?.[id];
  return (
    <div className="flex items-center gap-3 py-2.5" data-testid="store-row" data-app={id}>
      {rank !== undefined && <span className="w-5 shrink-0 text-center text-[15px] font-semibold text-text-tertiary">{rank}</span>}
      <button type="button" onClick={() => onOpen(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid="store-row-open">
        <StoreIcon id={id} size={58} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-semibold text-text">{name}</span>
          <span className="block truncate text-[13px] text-text-secondary">{t(CATALOG[id].subtitle)}</span>
          {stats && stats.total > 0 && (
            <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-tertiary">
              <Stars value={stats.average} size={11} /> {stats.average.toFixed(1)} · {stats.total}
            </span>
          )}
        </span>
      </button>
      <GetButton id={id} />
    </div>
  );
}

/** A strip of real screenshots (phone or PC), scrolled sideways; a tap opens the full-screen viewer. */
export function ScreenshotStrip({ id, kind, onOpen }: { id: StoreAppId; kind: "phone" | "pc"; onOpen: (index: number) => void }) {
  const t = useT();
  const name = useAppName()(id);
  const shots = CATALOG[id][kind];
  return (
    <div className="scroll-area -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none]" data-testid="store-shots" data-kind={kind}>
      {shots.map((src, i) => (
        <button
          key={src}
          type="button"
          onClick={() => onOpen(i)}
          className={cx("relative shrink-0 snap-start overflow-hidden rounded-[22px] bg-surface-secondary shadow-tile", kind === "phone" ? "aspect-[390/844] w-[170px] sm:w-[200px]" : "aspect-[16/10] w-[300px] sm:w-[420px]")}
          aria-label={t("store.screenshot", { app: name, n: i + 1 })}
          data-testid="store-shot"
        >
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover object-top" />
        </button>
      ))}
    </div>
  );
}

/** Full-screen screenshots: sideways scroll (phones), arrows on the sides (PC), Esc / X closes. */
export function ShotViewer({ shots, index, onIndex }: { shots: string[]; index: number | null; onIndex: (i: number | null) => void }) {
  const t = useT();
  const strip = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  useEffect(() => {
    if (index === null) return;
    setCur(index);
    window.setTimeout(() => strip.current?.scrollTo({ left: index * (strip.current?.clientWidth ?? 0), behavior: "instant" as ScrollBehavior }), 0);
  }, [index]);
  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onIndex(null);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const go = (d: number) => {
    const el = strip.current;
    if (!el) return;
    const next = Math.max(0, Math.min(shots.length - 1, cur + d));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    setCur(next);
  };
  return createPortal(
    <AnimatePresence>
      {index !== null && (
        <motion.div
          className="fixed inset-0 z-[290] flex flex-col bg-[rgba(10,10,18,0.94)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={t("store.screenshots")}
          data-testid="store-viewer"
          data-index={cur}
        >
          <div className="flex justify-end px-3 pt-[max(var(--safe-top),12px)]">
            <button type="button" onClick={() => onIndex(null)} aria-label={t("common.close")} className="flex size-11 items-center justify-center rounded-full bg-white/12 text-white" data-testid="store-viewer-close">
              <RiCloseLine className="size-6" />
            </button>
          </div>
          <div
            ref={strip}
            className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            onScroll={(e) => {
              const el = e.currentTarget;
              setCur(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
          >
            {shots.map((src) => (
              <div key={src} className="flex h-full w-full shrink-0 snap-center items-center justify-center p-4 pb-[max(var(--safe-bottom),16px)]">
                <img src={src} alt="" className="max-h-full max-w-full rounded-[18px] object-contain" draggable={false} />
              </div>
            ))}
          </div>
          {shots.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={cur === 0}
                aria-label={t("store.previous")}
                className="absolute left-4 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/14 text-white disabled:opacity-30 sm:flex"
                data-testid="store-viewer-prev"
              >
                <RiArrowLeftSLine className="size-7" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={cur === shots.length - 1}
                aria-label={t("store.next")}
                className="absolute right-4 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/14 text-white disabled:opacity-30 sm:flex"
                data-testid="store-viewer-next"
              >
                <RiArrowRightSLine className="size-7" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Rating distribution: one bar per star (5 at the top), its length count / total. 1–2 red, 3 yellow, 4–5 green. */
export function RatingChart({ counts }: { counts: [number, number, number, number, number] }) {
  const t = useT();
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1" data-testid="store-rating-chart">
      {[5, 4, 3, 2, 1].map((n) => (
        <div key={n} className="flex items-center gap-2 text-[11.5px] text-text-tertiary">
          <span className="w-3 text-right tabular-nums">{n}</span>
          <span
            className="h-[6px] flex-1 overflow-hidden rounded-full bg-surface-secondary"
            role="meter"
            aria-label={t("store.starsCount", { n, count: counts[n - 1] ?? 0, total })}
            aria-valuemin={0}
            aria-valuemax={Math.max(1, total)}
            aria-valuenow={counts[n - 1] ?? 0}
          >
            <span className={cx("block h-full rounded-full", n >= 4 ? "bg-[#2ec27e]" : n === 3 ? "bg-[#f5b301]" : "bg-[#f0506e]")} style={{ width: `${total ? ((counts[n - 1] ?? 0) / total) * 100 : 0}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
