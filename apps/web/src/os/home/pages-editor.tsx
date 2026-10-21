import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { RiCheckLine } from "@remixicon/react";
import { CLIENT_APPS } from "../app-registry";
import { usePhoneGrid } from "./desktop-geometry";
import { placementOf, reorderPages, widgetKey, type WorkspaceLayout } from "@voidex/shared";
import { useT } from "@/lib/i18n";
import { cx } from "@/lib/cx";
import { updateLayout } from "./layout";
import { parseItem } from "./actions";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;
/** Mini page: the phone's 4 columns and the rows a page holds. */
const COLS = 4;
const ROWS = 6;

/**
 * Step 2.16 «Изменить страницы» (phone, edit mode → brush): every page at a
 * glance, one after another, in a compact overview over the blurred home
 * screen. A page is dragged to another place among them and takes everything
 * on it along (icons, folders, widgets); nothing is carried over by hand.
 * The new order is saved when the page is let go; ✓ closes.
 */
export function PagesEditor({ layout }: { layout: WorkspaceLayout }) {
  const t = useT();
  const open = useHomeUi((s) => s.pagesOpen);
  const close = () => useHomeUi.getState().setPagesOpen(false);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[215] flex flex-col bg-black/25 backdrop-blur-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          transition={{ duration: 0.18, ease: EASE }}
          onPointerDown={(e) => e.target === e.currentTarget && close()}
          data-system-ui
          data-testid="pages-editor"
        >
          <div className="flex justify-end px-5 pt-[max(var(--safe-top),14px)]">
            <button
              type="button"
              onClick={close}
              aria-label={t("home.editPagesDone")}
              className="vx-glass pressable flex h-10 w-16 items-center justify-center rounded-full text-text"
              data-testid="pages-editor-done"
            >
              <RiCheckLine className="size-6" />
            </button>
          </div>
          <PagesGrid layout={layout} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PagesGrid({ layout }: { layout: WorkspaceLayout }) {
  const t = useT();
  const count = layout.mobile.pages.length;
  /** Display order while dragging (page indexes); saved on release. */
  const [order, setOrder] = useState(() => layout.mobile.pages.map((_, i) => i));
  const [dragged, setDragged] = useState<number | null>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);
  useEffect(() => {
    if (dragged === null) setOrder(layout.mobile.pages.map((_, i) => i));
  }, [count, layout.mobile.pages, dragged]);

  const press = (e: ReactPointerEvent<HTMLDivElement>, page: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const r0 = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    /** Where the pointer holds the card (from its top-left corner). */
    const grab = { x: e.clientX - r0.left, y: e.clientY - r0.top };
    let current = order;
    let moving = false;
    let last = start;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    /** The card under the pointer, measured from where its slot is right now (slots move as pages make room). */
    const follow = () => {
      const r = slots.current.get(page)?.getBoundingClientRect();
      if (!r) return;
      const natural = { left: r.left - dx.get(), top: r.top - dy.get() };
      dx.set(last.x - grab.x - natural.left);
      dy.set(last.y - grab.y - natural.top);
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!moving) {
        if (Math.hypot(last.x - start.x, last.y - start.y) < 6) return;
        moving = true;
        setDragged(page);
      }
      follow();
      // The slot whose centre is nearest to the pointer takes the page.
      let best = current.indexOf(page);
      let dist = Infinity;
      current.forEach((p, i) => {
        const r = slots.current.get(p)?.getBoundingClientRect();
        if (!r) return;
        const cx0 = r.left + r.width / 2 - (p === page ? dx.get() : 0);
        const cy0 = r.top + r.height / 2 - (p === page ? dy.get() : 0);
        const dd = Math.hypot(cx0 - last.x, cy0 - last.y);
        if (dd < dist) {
          dist = dd;
          best = i;
        }
      });
      const from = current.indexOf(page);
      if (best !== from) {
        const next = [...current];
        next.splice(best, 0, next.splice(from, 1)[0]!);
        current = next;
        setOrder(next);
        requestAnimationFrame(follow);
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      dx.set(0);
      dy.set(0);
      setDragged(null);
      if (!moving) return;
      const to = current.indexOf(page);
      if (to !== page) updateLayout((l) => reorderPages(l, page, to));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div className="mx-auto mt-6 grid w-full max-w-[440px] grid-cols-3 gap-x-4 gap-y-6 px-5" data-testid="pages-editor-grid">
      {order.map((page, i) => (
        <motion.div
          key={page}
          layout={dragged !== page}
          ref={(el) => {
            if (el) slots.current.set(page, el);
            else slots.current.delete(page);
          }}
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: dragged === page ? 1.06 : 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE, delay: dragged === null ? i * 0.03 : 0 }}
          className={cx("relative flex touch-none select-none flex-col items-center gap-2", dragged === page && "z-10")}
          style={dragged === page ? { x: dx, y: dy } : undefined}
          onPointerDown={(e) => press(e, page)}
          data-testid={`pages-editor-page-${page}`}
          data-page={page}
          data-slot={i}
        >
          <MiniPage layout={layout} page={page} lifted={dragged === page} />
          <span className="text-[12px] font-medium text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">{t("home.pageN", { n: i + 1 })}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** A page in small: its icons, folders and widgets in their cells. */
function MiniPage({ layout, page, lifted }: { layout: WorkspaceLayout; page: number; lifted: boolean }) {
  const phone = usePhoneGrid((s) => s.grid);
  const cells = useMemo(() => placementOf(layout, { surface: "mobile", page }, phone ?? undefined), [layout, page, phone]);
  const widgets = useMemo(() => new Set(layout.widgets.filter((w) => w.surface === "mobile" && w.container === String(page)).map((w) => widgetKey(w.id))), [layout.widgets, page]);
  return (
    <div
      className={cx("vx-glass relative aspect-[9/17] w-full overflow-hidden rounded-[20px] p-[9%] transition-shadow", lifted && "shadow-float ring-2 ring-white/50")}
      data-testid="pages-editor-mini"
    >
      <div className="grid size-full gap-[7%]" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
        {[...cells].map(([key, c]) => {
          if (c.r >= ROWS) return null;
          const style = { gridColumn: `${c.c + 1} / span ${c.w}`, gridRow: `${c.r + 1} / span ${Math.min(c.h, ROWS - c.r)}` };
          if (widgets.has(key)) return <span key={key} className="rounded-[22%] bg-white/55 shadow-sm" style={style} />;
          const item = parseItem(key);
          if (item?.kind === "app") {
            const app = CLIENT_APPS[item.id];
            if (!app) return null;
            return (
              <span key={key} className="flex aspect-square items-center justify-center self-center rounded-[26%] bg-surface shadow-sm" style={style}>
                <app.Icon className="size-[72%]" />
              </span>
            );
          }
          return <span key={key} className="aspect-square self-center rounded-[26%] bg-white/45 shadow-sm" style={style} />;
        })}
      </div>
    </div>
  );
}
