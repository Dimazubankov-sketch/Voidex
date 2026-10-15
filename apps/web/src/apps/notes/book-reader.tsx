import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckboxBlankCircleLine, RiCheckboxCircleFill, RiEdit2Line, RiFullscreenExitLine, RiFullscreenLine } from "@remixicon/react";
import type { BookBody, NoteBlock } from "@voidex/shared";
import { layoutBlocks } from "@voidex/notes";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useMediaUrl } from "./data";

/**
 * Step 2.13: a book in reading mode («Чтение»). No toolbar and nothing to
 * edit: the pages as a reader sees them (a spread on wide screens, one page
 * on phones), turned with the arrows, a swipe on phones, ← / → / PageUp /
 * PageDown / Space on a keyboard; optionally fullscreen. Text is real
 * headings, paragraphs, quotes and lists (screen readers walk it as a
 * document). Only the pages shown are rendered; pictures load lazily.
 */
export function BookReader({
  body,
  title,
  start,
  canEdit,
  onEdit,
  onClose,
  onPage,
}: {
  body: BookBody;
  title: string;
  start: number;
  canEdit: boolean;
  /** Back to «Редактирование». */
  onEdit: () => void;
  /** Viewers leave the book instead. */
  onClose: () => void;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 900, h: 700 });
  const [page, setPage] = useState(start);
  const [dir, setDir] = useState(1);
  const [full, setFull] = useState(false);
  const count = body.pages.length;
  const spread = box.w >= 820;
  const per = spread ? 2 : 1;
  const clamped = Math.max(0, Math.min(page, count - 1));
  const first = clamped - (clamped % per);
  const pageW = Math.floor(spread ? Math.max(260, Math.min((box.w - 120) / 2, ((box.h - 40) / 1.414) * 1.05, 600)) : Math.max(240, Math.min(box.w - 24, 640)));

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (i: number) => {
    const target = Math.max(0, Math.min(count - 1, i));
    const aligned = target - (target % per);
    if (aligned === first) return;
    setDir(aligned > first ? 1 : -1);
    setPage(aligned);
    onPage(aligned);
    stage.current?.scrollTo({ top: 0 });
  };
  const next = () => go(first + per);
  const prev = () => go(first - per);

  // Keyboard: the arrows, PageUp / PageDown, Space, Home / End.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [role=dialog]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) next();
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) prev();
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(count - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // Fullscreen (optional): follows the browser's own state (Esc leaves it).
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement && document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const canFull = typeof document !== "undefined" && !!document.fullscreenEnabled;
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  };

  // A horizontal swipe turns the page (a vertical one scrolls a long page).
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  const shown = body.pages.slice(first, first + per);
  const last = Math.min(count, first + per);
  return (
    <div
      ref={root}
      className="vn2-reader absolute inset-0 z-40 flex flex-col"
      data-testid="book-reader"
      data-first={first}
      data-spread={spread ? "two" : "one"}
      role="region"
      aria-label={`${t("notes.book.reading")}: ${title}`}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-[max(env(safe-area-inset-top),10px)]">
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="vn2-float flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-3 pr-4 text-[14.5px] font-semibold text-text"
            data-testid="book-reader-edit"
          >
            <RiEdit2Line className="size-[18px] text-primary" />
            {t("notes.book.editing")}
          </button>
        ) : (
          <button type="button" onClick={onClose} aria-label={t("common.back")} className="vn2-float grid size-10 shrink-0 place-items-center rounded-full text-text" data-testid="book-reader-close">
            <RiArrowLeftSLine className="size-6" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-text" data-testid="book-reader-title">
          {title}
        </h1>
        {canFull ? (
          <button
            type="button"
            onClick={toggleFull}
            aria-label={full ? t("notes.book.exitFullscreen") : t("notes.book.fullscreen")}
            title={full ? t("notes.book.exitFullscreen") : t("notes.book.fullscreen")}
            aria-pressed={full}
            className="vn2-float grid size-10 shrink-0 place-items-center rounded-full text-text"
            data-testid="book-reader-fullscreen"
          >
            {full ? <RiFullscreenExitLine className="size-[19px]" /> : <RiFullscreenLine className="size-[19px]" />}
          </button>
        ) : (
          <span className="size-10 shrink-0" />
        )}
      </div>

      <div
        ref={stage}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
          if (dx < 0) next();
          else prev();
        }}
        onPointerCancel={() => (swipe.current = null)}
        data-testid="book-reader-stage"
      >
        <div className="flex min-h-full items-start justify-center px-3 py-4 sm:px-8">
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={first}
              custom={dir}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: dir * -40 }}
              transition={{
                duration: reduced ? 0.12 : 0.26,
                ease: [0.32, 0.72, 0, 1],
              }}
              className={cx("vn2-spread flex", spread && "vn2-spread-two")}
            >
              {shown.map((p, k) => (
                <article
                  key={p.id}
                  className={cx("vn2-book-page vn2-reader-page", spread && (k === 0 ? "vn2-book-left" : "vn2-book-right"))}
                  style={{ width: pageW, minHeight: Math.round(pageW * 1.414) }}
                  aria-label={t("notes.book.pageN", { n: first + k + 1 })}
                  data-testid="book-reader-page"
                  data-page={first + k}
                >
                  <div className="vn2-book-content">
                    <ReaderBlocks blocks={p.blocks} />
                  </div>
                  <span className="vn2-book-number" aria-hidden>
                    {first + k + 1}
                  </span>
                </article>
              ))}
              {spread && shown.length === 1 && <div className="vn2-book-page vn2-book-right vn2-book-blank" style={{ width: pageW, minHeight: Math.round(pageW * 1.414) }} aria-hidden />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="flex shrink-0 justify-center pb-[max(env(safe-area-inset-bottom),12px)] pt-1">
        <div className="vn2-pagenav flex items-center gap-0.5 rounded-full p-1" data-testid="book-reader-nav">
          <button type="button" onClick={prev} disabled={first <= 0} aria-label={t("notes.page.prev")} className="vn2-icon-btn size-10" data-testid="book-reader-prev">
            <RiArrowLeftSLine className="size-6" />
          </button>
          <span className="min-w-[64px] text-center text-[14px] font-medium tabular-nums text-text" data-testid="book-reader-indicator" aria-live="polite">
            {last - first > 1 ? `${first + 1}–${last}` : first + 1} / {count}
          </span>
          <button type="button" onClick={next} disabled={first + per >= count} aria-label={t("notes.page.next")} className="vn2-icon-btn size-10" data-testid="book-reader-next">
            <RiArrowRightSLine className="size-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The blocks of a page as a document: headings, paragraphs, quotes, lists, pictures (rows, wrapped). */
function ReaderBlocks({ blocks }: { blocks: NoteBlock[] }) {
  const out: ReactNode[] = [];
  const items = layoutBlocks(blocks);
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === "row") {
      out.push(
        <div key={`row-${it.blocks[0]!.id}`} className="vn2-img-row" data-testid="book-reader-row">
          {it.blocks.map((b) => (
            <ReaderImage key={b.id} b={b} row />
          ))}
        </div>,
      );
      continue;
    }
    const b = it.block;
    if (b.kind === "image") {
      out.push(<ReaderImage key={b.id} b={b} />);
      continue;
    }
    // Neighbouring list items form one list.
    if (b.kind === "bullet" || b.kind === "checklist") {
      const list: NoteBlock[] = [b];
      while (i + 1 < items.length) {
        const n = items[i + 1]!;
        if (n.kind !== "block" || n.block.kind !== b.kind) break;
        list.push(n.block);
        i++;
      }
      out.push(
        <ul key={b.id} className="vn2-r-list">
          {list.map((x) => (
            <li key={x.id} className={cx("vn2-b", `vn2-b-${x.kind}`, x.bold && "vn2-bold", x.italic && "vn2-italic", x.checked && "vn2-done")} style={x.size ? { fontSize: x.size } : undefined}>
              {x.kind === "bullet" ? (
                <span className="vn2-dot" aria-hidden />
              ) : x.checked ? (
                <RiCheckboxCircleFill className="mt-[5px] size-[21px] shrink-0 text-primary" aria-label="✓" />
              ) : (
                <RiCheckboxBlankCircleLine className="mt-[5px] size-[21px] shrink-0 text-text-tertiary" aria-hidden />
              )}
              <span className="vn2-text vn2-r-text">{x.text}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }
    const Tag = b.kind === "heading" ? "h2" : b.kind === "heading2" ? "h3" : b.kind === "subheading" ? "h4" : b.kind === "quote" ? "blockquote" : b.kind === "code" ? "pre" : "p";
    out.push(
      <Tag
        key={b.id}
        className={cx("vn2-b", `vn2-b-${b.kind}`, b.bold && "vn2-bold", b.italic && "vn2-italic")}
        style={b.size ? { fontSize: b.size } : undefined}
        data-testid="book-reader-block"
        data-kind={b.kind}
      >
        <span className="vn2-text vn2-r-text">{b.text || <Fragment>&nbsp;</Fragment>}</span>
      </Tag>,
    );
  }
  return <>{out}</>;
}

function ReaderImage({ b, row }: { b: NoteBlock; row?: boolean }) {
  const url = useMediaUrl(b.src);
  const width = b.width ?? 100;
  const align = b.align ?? "center";
  const wrap = !row && !!b.wrap && align !== "center";
  return (
    <figure
      className={cx("vn2-img", row ? "vn2-img-in-row" : `vn2-img-${align}`, wrap && `vn2-img-wrap vn2-img-wrap-${align}`)}
      style={row ? { flex: `${width} 1 0%` } : wrap ? { width: `${width}%` } : undefined}
      data-testid="book-reader-image"
    >
      <div style={{ width: row || wrap ? "100%" : `${width}%` }}>
        {url ? (
          <img src={url} alt={b.text} loading="lazy" draggable={false} className="block w-full rounded-[10px]" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-[10px] bg-surface-secondary">
            <Spinner />
          </div>
        )}
      </div>
    </figure>
  );
}
