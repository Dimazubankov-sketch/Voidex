import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, type MotionValue, type PanInfo } from "motion/react";
import { RiCloseLine } from "@remixicon/react";
import { APP_REGISTRY } from "@voidex/shared";
import { useLanguage, useT } from "@/lib/i18n";
import { AppTile } from "@/brand/brand";
import { IconButton } from "@/ui/controls";
import { CLIENT_APPS } from "./app-registry";
import { useWM, type AppWindow } from "./window-manager";
import { useHomeUi } from "./home/ui-store";
import { DesktopsGlyph } from "./home/spaces";

const EASE = [0.22, 1, 0.36, 1] as const;
const GAP = 16;
const HINT_MS = 2600;

/**
 * Mobile multitasking ("Open apps"): cards of the running apps.
 *
 * Swipe left/right to move between cards, swipe a card up to close it, tap a
 * card to switch to it, tap the empty space around the cards to go back to
 * the workspace. The deck is moved by our own pan handling instead of native
 * overflow scrolling, so iOS never draws its scroll indicator under the cards.
 */
export function AppSwitcher() {
  const wm = useWM();
  const open = wm.switcherOpen;
  const items = [...wm.order].reverse().map((id) => wm.windows[id]!).filter(Boolean);
  return <AnimatePresence>{open && (items.length > 0 ? <Deck items={items} /> : <EmptyDeck key="empty" />)}</AnimatePresence>;
}

/** The home-screen pages, from the switcher (Step 2.3: the round button opens the switcher). */
function PagesButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        useWM.getState().setSwitcher(false);
        useHomeUi.getState().setSpacesOpen(true);
      }}
      className="vx-glass pressable flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-text"
      data-testid="switcher-pages"
    >
      <DesktopsGlyph className="size-5" />
      {t("home.pages")}
    </button>
  );
}

function EmptyDeck() {
  const t = useT();
  const wm = useWM();
  return (
    <motion.div
      className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background/80 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={() => wm.goHome()}
      data-testid="app-switcher"
    >
      <span className="text-[15px] text-text-secondary" data-testid="switcher-empty">
        {t("os.switcherEmpty")}
      </span>
      <PagesButton />
    </motion.div>
  );
}

function Deck({ items }: { items: AppWindow[] }) {
  const t = useT();
  const wm = useWM();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [index, setIndex] = useState(0);
  // The hint belongs to this opening of the switcher only: shown once, then gone.
  const [hint, setHint] = useState(true);
  const x = useMotionValue(0);
  const cardYs = useRef(new Map<string, MotionValue<number>>());
  const gesture = useRef<{ axis: "x" | "y" | null; cardId: string | null; moved: boolean }>({ axis: null, cardId: null, moved: false });

  const cardW = Math.min(width * 0.7, 320);
  const step = cardW + GAP;
  const baseX = (i: number) => (width - cardW) / 2 - i * step;
  const clampIndex = (i: number) => Math.max(0, Math.min(items.length - 1, i));

  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the deck positioned on the current card (resize, closed cards).
  const current = clampIndex(index);
  useEffect(() => {
    if (current !== index) setIndex(current);
    void animate(x, baseX(current), { duration: 0.35, ease: EASE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, width, items.length]);

  const onPanStart = (e: PointerEvent) => {
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-card-id]");
    gesture.current = { axis: null, cardId: card?.dataset.cardId ?? null, moved: true };
  };
  const onPan = (_: PointerEvent, info: PanInfo) => {
    const g = gesture.current;
    if (!g.axis) {
      if (Math.abs(info.offset.x) < 6 && Math.abs(info.offset.y) < 6) return;
      g.axis = Math.abs(info.offset.x) >= Math.abs(info.offset.y) ? "x" : "y";
    }
    if (g.axis === "x") {
      // Rubber band past the first and last card.
      const raw = baseX(current) + info.offset.x;
      const min = baseX(items.length - 1);
      const max = baseX(0);
      x.set(raw > max ? max + (raw - max) * 0.3 : raw < min ? min + (raw - min) * 0.3 : raw);
    } else if (g.cardId) {
      const y = cardYs.current.get(g.cardId);
      y?.set(info.offset.y < 0 ? info.offset.y : info.offset.y * 0.15);
    }
  };
  const onPanEnd = (_: PointerEvent, info: PanInfo) => {
    const g = gesture.current;
    if (g.axis === "x") {
      let next = current;
      if (info.offset.x < -step / 4 || info.velocity.x < -500) next = current + 1;
      else if (info.offset.x > step / 4 || info.velocity.x > 500) next = current - 1;
      next = clampIndex(next);
      setIndex(next);
      void animate(x, baseX(next), { duration: 0.35, ease: EASE });
    } else if (g.axis === "y" && g.cardId) {
      const y = cardYs.current.get(g.cardId);
      if (info.offset.y < -120 || info.velocity.y < -800) {
        if (y) void animate(y, -window.innerHeight, { duration: 0.25, ease: EASE });
        const id = g.cardId;
        window.setTimeout(() => wm.close(id), 200);
      } else if (y) {
        void animate(y, 0, { duration: 0.3, ease: EASE });
      }
    }
    g.axis = null;
    // Swallow the click that follows a swipe.
    window.setTimeout(() => (gesture.current.moved = false), 0);
  };

  return (
    <motion.div
      ref={root}
      className="absolute inset-0 z-[100] touch-none select-none overflow-hidden bg-background/80 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onPointerDown={() => (gesture.current.moved = false)}
      onPanStart={onPanStart}
      onPan={onPan}
      onPanEnd={onPanEnd}
      onClick={() => {
        // Tapping the empty space around the cards returns to the workspace.
        if (!gesture.current.moved) wm.goHome();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setIndex(clampIndex(current + 1));
        else if (e.key === "ArrowLeft") setIndex(clampIndex(current - 1));
        else if (e.key === "Escape") wm.goHome();
      }}
      tabIndex={-1}
      data-testid="app-switcher"
    >
      <motion.div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center" style={{ x, gap: GAP }}>
        {items.map((w, i) => (
          <Card
            key={w.id}
            win={w}
            width={cardW}
            index={i}
            register={(mv) => cardYs.current.set(w.id, mv)}
            onOpen={() => !gesture.current.moved && wm.focus(w.id)}
            onClose={() => wm.close(w.id)}
          />
        ))}
      </motion.div>
      <div className="absolute inset-x-0 bottom-[max(var(--safe-bottom),20px)] flex justify-center" style={{ marginBottom: hint ? 40 : 0 }}>
        <PagesButton />
      </div>
      <AnimatePresence>
        {hint && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-[max(var(--safe-bottom),20px)] flex justify-center"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <span className="rounded-full bg-surface/80 px-3 py-1.5 text-[12px] text-text-secondary shadow-surface backdrop-blur" data-testid="switcher-hint">
              {t("os.swipeHome")}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Card({
  win,
  width,
  index,
  register,
  onOpen,
  onClose,
}: {
  win: AppWindow;
  width: number;
  index: number;
  register: (y: MotionValue<number>) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const y = useMotionValue(0);
  register(y);
  const { Icon } = CLIENT_APPS[win.appId];
  const name = APP_REGISTRY[win.appId].name[lang];
  return (
    <motion.div
      className="flex shrink-0 flex-col gap-3"
      style={{ width, y }}
      data-card-id={win.id}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: index * 0.04, duration: 0.35, ease: EASE }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-1">
        <AppTile size={28}>
          <Icon className="size-4" />
        </AppTile>
        <span className="text-[14px] font-semibold">{name}</span>
        <span className="flex-1" />
        <IconButton label={t("os.closeApp", { app: name })} size="sm" onClick={onClose}>
          <RiCloseLine className="size-4" />
        </IconButton>
      </div>
      <button
        className="flex h-[58vh] w-full flex-col overflow-hidden rounded-[28px] bg-surface text-left shadow-window"
        onClick={onOpen}
        data-testid={`switcher-card-${win.appId}`}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="h-3 w-24 rounded-full bg-surface-secondary" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <AppTile size={84} glow>
            <Icon className="size-12" />
          </AppTile>
          <span className="text-[16px] font-semibold">{name}</span>
        </div>
      </button>
    </motion.div>
  );
}
