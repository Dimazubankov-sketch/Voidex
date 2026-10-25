import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cx } from "@/lib/cx";

export interface GlassTab<K extends string> {
  key: K;
  /** Accessible name (and the small caption when `labels` is on). */
  label: string;
  /** The icon, given whether the tab is the active one. */
  icon: (active: boolean) => ReactNode;
  badge?: number;
  badgeTestId?: string;
  testId?: string;
}

/** The leading edge moves first (stiff), the trailing one follows (softer): the capsule stretches toward the new tab and settles. */
const LEAD = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;
const TRAIL = { type: "spring", stiffness: 300, damping: 34, mass: 1 } as const;
/** Sideways travel (px) before a press on the bar becomes a swipe. */
const SWIPE_SLOP = 8;

/**
 * Update 4 · F (SR7854): how far the content must move in one direction before the bar changes — a
 * scroll down past COMPACT_AFTER makes it compact, a scroll up past EXPAND_AFTER brings it back (not only
 * at the very top). Small jitters of the finger stay below both and change nothing.
 */
const COMPACT_AFTER = 28;
const EXPAND_AFTER = 16;
/** Near the top of the content the bar is always full. */
const TOP_ZONE = 24;

/**
 * Update 4 · F: the bar turns compact while the content under it is scrolled down and full again as
 * soon as it is scrolled up. It listens to every vertical scroller of its own app (scroll events are
 * caught on the app root); sideways scrollers (tab strips, carousels) never count.
 */
export function useCompactOnScroll(host: React.RefObject<HTMLElement | null>, resetKey: unknown) {
  const [compact, setCompact] = useState(false);
  useEffect(() => setCompact(false), [resetKey]);
  useEffect(() => {
    const root = host.current?.parentElement;
    if (!root) return;
    const last = new WeakMap<EventTarget, { top: number; left: number }>();
    let acc = 0;
    let dir = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLElement) || host.current?.contains(el)) return;
      const top = el.scrollTop;
      const prev = last.get(el);
      last.set(el, { top, left: el.scrollLeft });
      if (!prev) return;
      const dy = top - prev.top;
      // Only vertical scrolling counts (a sideways strip changes scrollLeft, not scrollTop).
      if (!dy || Math.abs(el.scrollLeft - prev.left) > Math.abs(dy)) return;
      if (top <= TOP_ZONE) {
        acc = 0;
        dir = 0;
        setCompact(false);
        return;
      }
      const d = Math.sign(dy);
      if (d !== dir) {
        dir = d;
        acc = 0;
      }
      acc += Math.abs(dy);
      if (d > 0 && acc > COMPACT_AFTER) setCompact(true);
      else if (d < 0 && acc > EXPAND_AFTER) setCompact(false);
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => root.removeEventListener("scroll", onScroll, { capture: true });
  }, [host]);
  return compact;
}

/**
 * The system glass tab bar (Step 2.13 Vibex, Step 2.15 for every app with a
 * phone tab bar: Vibex, Clock). A floating, rounded bar of the system glass a
 * little above the bottom edge; the active tab sits in one capsule that
 * glides from tab to tab. Step 2.15: the bar can be swiped: the capsule
 * follows the finger along the bar and the tab under it is chosen when the
 * finger lifts; a tap still selects a tab directly.
 */
export function GlassTabBar<K extends string>({
  items,
  active,
  onSelect,
  ariaLabel,
  labels = false,
  testId,
  wrapTestId,
}: {
  items: GlassTab<K>[];
  active: K;
  onSelect: (key: K) => void;
  ariaLabel: string;
  /** Small captions under the icons (Clock); Vibex shows icons only. */
  labels?: boolean;
  testId?: string;
  wrapTestId?: string;
}) {
  const reduced = useReducedMotion();
  const bar = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Update 4 · F: compact while the content is scrolled down; full again on the way up and on a new tab.
  const compact = useCompactOnScroll(wrap, active);
  const buttons = useRef(new Map<K, HTMLButtonElement>());
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const width = useTransform([left, right], ([l, r]) => Math.max(0, (r as number) - (l as number)));
  const placed = useRef(false);
  const lastIndex = useRef(items.findIndex((i) => i.key === active));
  const swipe = useRef<{ id: number; x: number; l: number; r: number; moving: boolean } | null>(null);
  const swiped = useRef(false);

  /**
   * Step 2.16: a tab's edges in the bar's own layout (offsets), never from
   * screen rects: those change while the window or the page is still sliding
   * or scaling in, which left the capsule half way between two tabs or as a
   * sliver beside the active one.
   */
  const edgesOf = (key: K) => {
    const el = buttons.current.get(key);
    if (!el || !bar.current || !el.offsetWidth) return null;
    return { l: el.offsetLeft + 4, r: el.offsetLeft + el.offsetWidth - 4 };
  };
  /** Back where the active tab is (a swipe that was taken over or cut short). */
  const settle = () => {
    const edges = edgesOf(active);
    if (!edges) return;
    void animate(left, edges.l, LEAD);
    void animate(right, edges.r, LEAD);
  };

  useLayoutEffect(() => {
    const place = (animateIt: boolean) => {
      const e = edgesOf(active);
      if (!e) return;
      const index = items.findIndex((i) => i.key === active);
      if (!animateIt || reduced) {
        left.jump(e.l);
        right.jump(e.r);
      } else {
        const toRight = index > lastIndex.current;
        void animate(left, e.l, toRight ? TRAIL : LEAD);
        void animate(right, e.r, toRight ? LEAD : TRAIL);
      }
      lastIndex.current = index;
    };
    place(placed.current);
    placed.current = true;
    const ro = new ResizeObserver(() => place(false));
    if (bar.current) ro.observe(bar.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items, left, right, reduced]);

  /** The tab whose middle is nearest to a point along the bar. */
  const tabAt = (x: number): K => {
    let best = active;
    let dist = Infinity;
    for (const it of items) {
      const e = edgesOf(it.key);
      if (!e) continue;
      const d = Math.abs((e.l + e.r) / 2 - x);
      if (d < dist) {
        dist = d;
        best = it.key;
      }
    }
    return best;
  };

  return (
    // Step 2.16: the bar's strip belongs to the bar: no page gesture (the side menu's swipe) starts in it.
    <div ref={wrap} className="vx-tabbar-wrap pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-2" data-gesture-owner="" data-testid={wrapTestId} data-compact={compact || undefined}>
      <nav
        ref={bar}
        role="tablist"
        aria-label={ariaLabel}
        data-gesture-owner=""
        className={cx("vx-tabbar pointer-events-auto relative flex w-full touch-none select-none items-center rounded-full px-1", reduced && "vx-tabbar-still")}
        data-testid={testId}
        data-active={active}
        data-compact={compact || undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          swiped.current = false;
          swipe.current = { id: e.pointerId, x: e.clientX, l: left.get(), r: right.get(), moving: false };
        }}
        onPointerMove={(e) => {
          const s = swipe.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          if (!s.moving) {
            if (Math.abs(dx) < SWIPE_SLOP) return;
            s.moving = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* synthetic pointer */
            }
          }
          const w = s.r - s.l;
          const max = (bar.current?.clientWidth ?? 0) - w - 4;
          const l = Math.max(4, Math.min(max, s.l + dx));
          left.stop();
          right.stop();
          left.set(l);
          right.set(l + w);
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s?.moving || s.id !== e.pointerId) return;
          swiped.current = true;
          const next = tabAt((left.get() + right.get()) / 2);
          if (next !== active) onSelect(next);
          // Back to the same tab: the capsule settles where it belongs.
          else settle();
        }}
        onPointerCancel={() => {
          const s = swipe.current;
          swipe.current = null;
          if (s?.moving) settle();
        }}
        onLostPointerCapture={(e) => {
          // A3: on touch screens the pressed tab button holds the pointer first (implicit capture); its
          // "lost capture" when the bar takes the pointer over bubbles up here and must not end the swipe.
          if (e.target !== e.currentTarget) return;
          // Someone else took the drag over mid-swipe: never leave the capsule where the finger was.
          const s = swipe.current;
          if (!s?.moving) return;
          swipe.current = null;
          settle();
        }}
        onClickCapture={(e) => {
          // The click at the end of a swipe is not a tap.
          if (swiped.current) {
            swiped.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <motion.span className="vx-tabbar-capsule pointer-events-none absolute rounded-full" style={{ left, width }} aria-hidden data-testid={testId ? `${testId}-capsule` : undefined} />
        {items.map((item) => {
          const on = item.key === active;
          return (
            <button
              key={item.key}
              ref={(el) => {
                if (el) buttons.current.set(item.key, el);
                else buttons.current.delete(item.key);
              }}
              type="button"
              role="tab"
              aria-selected={on}
              aria-current={on ? "page" : undefined}
              aria-label={item.label}
              onClick={() => onSelect(item.key)}
              className="relative flex h-full min-w-0 flex-1 items-center justify-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-primary/50"
              data-tab={item.key}
              data-testid={item.testId}
            >
              <span className={cx("vx-tabbar-item relative flex items-center justify-center rounded-full", labels ? "h-11 w-full flex-col gap-0.5" : "size-11")}>
                <span className={cx("flex transition-colors duration-200", on ? "text-primary" : "text-text-secondary")}>{item.icon(on)}</span>
                {labels && <span className={cx("max-w-full truncate px-1 text-[10px] font-semibold leading-none", on ? "text-primary" : "text-text-secondary")}>{item.label}</span>}
                {(item.badge ?? 0) > 0 && (
                  <span
                    className="absolute -right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white ring-2 ring-[var(--vx-tabbar-ring)]"
                    data-testid={item.badgeTestId}
                  >
                    {item.badge! > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              {!labels && <span className="sr-only">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
