import { useLayoutEffect, useRef, type ComponentType } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cx } from "@/lib/cx";
import { useT, type MessageKey } from "@/lib/i18n";

export interface TabItem<K extends string> {
  key: K;
  label: MessageKey;
  line: ComponentType<{ className?: string }>;
  fill: ComponentType<{ className?: string }>;
  badge?: number;
  badgeTestId?: string;
}

/** The leading edge moves first (stiff), the trailing one follows (softer): the capsule stretches toward the new tab and settles. */
const LEAD = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.9,
} as const;
const TRAIL = { type: "spring", stiffness: 300, damping: 34, mass: 1 } as const;

/**
 * Step 2.13: the Vibex phone tab bar (the reference video). A floating,
 * rounded, softly translucent bar a little above the bottom edge; the active
 * tab sits in a rounded capsule that is one element for the whole bar: it
 * glides from tab to tab (its two edges on springs, so it stretches on the
 * way and settles), it never disappears or appears again, and nothing else
 * moves: the icons stay where they are, only the active one turns filled and
 * violet. The labels are there for screen readers (the icons carry the bar,
 * as in the reference). First render: the capsule is placed, not animated.
 */
export function VibexTabBar<K extends string>({ items, active, onSelect }: { items: TabItem<K>[]; active: K; onSelect: (key: K) => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const bar = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<K, HTMLButtonElement>());
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const width = useTransform([left, right], ([l, r]) => Math.max(0, (r as number) - (l as number)));
  const placed = useRef(false);
  const lastIndex = useRef(items.findIndex((i) => i.key === active));

  useLayoutEffect(() => {
    const place = (animateIt: boolean) => {
      const el = buttons.current.get(active);
      const host = bar.current;
      if (!el || !host) return;
      const b = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const l = b.left - h.left + 4;
      const r = b.right - h.left - 4;
      const index = items.findIndex((i) => i.key === active);
      if (!animateIt || reduced) {
        left.jump(l);
        right.jump(r);
      } else {
        const toRight = index > lastIndex.current;
        void animate(left, l, toRight ? TRAIL : LEAD);
        void animate(right, r, toRight ? LEAD : TRAIL);
      }
      lastIndex.current = index;
    };
    place(placed.current);
    placed.current = true;
    const ro = new ResizeObserver(() => place(false));
    if (bar.current) ro.observe(bar.current);
    return () => ro.disconnect();
  }, [active, items, left, right, reduced]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-2" data-testid="vibex-tabbar-wrap">
      <nav
        ref={bar}
        role="tablist"
        aria-label="Vibex"
        className="vx-tabbar pointer-events-auto relative flex h-[60px] w-full max-w-[460px] items-center rounded-full px-1"
        data-testid="vibex-tabbar"
        data-active={active}
      >
        <motion.span className="vx-tabbar-capsule pointer-events-none absolute top-[6px] h-[48px] rounded-full" style={{ left, width }} aria-hidden data-testid="vibex-tabbar-capsule" />
        {items.map((item) => {
          const on = item.key === active;
          const Icon = on ? item.fill : item.line;
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
              aria-label={t(item.label)}
              onClick={() => onSelect(item.key)}
              className="relative flex h-full min-w-0 flex-1 items-center justify-center outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-primary/50"
              data-testid={`vibex-tab-${item.key}`}
            >
              <span className="relative flex size-11 items-center justify-center rounded-full">
                <Icon className={cx("size-[25px] transition-colors duration-200", on ? "text-primary" : "text-text-secondary")} />
                {(item.badge ?? 0) > 0 && (
                  <span
                    className="absolute -right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white ring-2 ring-[var(--vx-tabbar-ring)]"
                    data-testid={item.badgeTestId}
                  >
                    {item.badge! > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              <span className="sr-only">{t(item.label)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
