import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiCarouselView,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiExpandDiagonalLine,
  RiSwapBoxLine,
} from "@remixicon/react";
import { create } from "zustand";
import type { NoteBlock, NoteImageShape } from "@voidex/shared";
import { besideText, canAddText, perLine, sizeOf, snapSize, swapTargets, windowFor, type DropTarget, type FlowItem, type ImageSize } from "@voidex/notes";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { useMediaUrl } from "./data";

/**
 * Stage D — how text and pictures are drawn and handled in a note (the model is packages/notes flow.ts).
 *
 * Gestures (one clear priority, D8):
 *   - a picture that is not chosen: the page scrolls through it; a tap chooses it; a long press shows it large;
 *   - chosen, «Передвижение»: a drag lifts it (soft shadow, its place kept until it is dropped); holding it
 *     still shows it large;
 *   - chosen, «Масштаб»: a drag sideways (or the corner, or two fingers) sizes it; on release it settles on
 *     100 / 50 / 25 %.
 * Nothing is drawn for the grid: positions are the places of the flow (lines, beside a picture or text, onto
 * a picture), shown only by a thin mark while dragging.
 */

export const SHAPE_RATIO: Record<NoteImageShape, string> = { square: "1 / 1", portrait: "3 / 4", landscape: "4 / 3" };
const LONG_PRESS_MS = 450;
const DRAG_SLOP = 6;

export interface FlowActions {
  selectImage(id: string): void;
  preview(url: string): void;
  beginDrag(id: string, frame: HTMLElement, at: { x: number; y: number }, url: string): void;
  size(id: string, size: ImageSize): void;
  addText(imageId: string): void;
  carouselStart(rowId: string, start: number): void;
}

/** The picture being dragged (its place in the note stays, faded, until it is dropped). */
export const useFlowDrag = create<{ id: string | null }>(() => ({ id: null }));

// ------------------------------------------------------------------ a row

export const FlowRow = memo(function FlowRow({
  item,
  selected,
  readOnly,
  act,
  renderText,
  reveal,
}: {
  item: Extract<FlowItem, { kind: "row" }>;
  selected: string | null;
  readOnly: boolean;
  act: FlowActions;
  renderText: (b: NoteBlock) => ReactNode;
  reveal: string | null;
}) {
  if (item.carousel) return <Carousel item={item} selected={selected} readOnly={readOnly} act={act} reveal={reveal} />;
  const hasText = item.cells.some((c) => c.kind === "text");
  const lastImage = item.images.at(-1)!;
  const room = !readOnly && !hasText && canAddText(item.images.length > 1 ? item.images : [lastImage], lastImage.id);
  const cellsCount = item.cells.length + (room ? 1 : 0);
  return (
    <div className="vn2-row" data-testid="notes-flow-row" data-row={item.id} data-size={item.size} data-count={item.images.length} data-text={hasText || undefined}>
      {item.cells.map((c) =>
        c.kind === "image" ? (
          <ImageCell key={c.block.id} b={c.block} size={item.size} shape={item.shape} cells={cellsCount} selected={selected === c.block.id} readOnly={readOnly} act={act} />
        ) : (
          <div key={`t-${c.blocks[0]!.id}`} className="vn2-row-text" data-text-cell={c.blocks[0]!.id} data-testid="notes-text-cell">
            {c.blocks.map((b) => renderText(b))}
          </div>
        ),
      )}
      {room && (
        // D3: the free part of the line takes the cursor: a tap starts a text column there.
        <button type="button" className="vn2-row-free" aria-label={""} tabIndex={-1} data-row-free={lastImage.id} data-testid="notes-row-free" onClick={() => act.addText(lastImage.id)} />
      )}
    </div>
  );
});

// ------------------------------------------------------------------ a picture

export const ImageCell = memo(function ImageCell({
  b,
  size,
  shape,
  cells,
  carousel,
  selected,
  readOnly,
  act,
}: {
  b: NoteBlock;
  size: ImageSize;
  shape: NoteImageShape;
  /** Cells on its line (for the gaps); a carousel sizes its items itself. */
  cells: number;
  carousel?: boolean;
  selected: boolean;
  readOnly: boolean;
  act: FlowActions;
}) {
  const t = useT();
  const url = useMediaUrl(b.src);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useFlowDrag((s) => s.id === b.id);
  const tool = b.tool ?? "move";
  const [live, setLive] = useState<number | null>(null);
  const press = useRef<{ x: number; y: number; id: number; timer: number; fired: boolean; drag: boolean } | null>(null);
  const scale = useRef<{ startW: number; line: number; x: number; pointers: Map<number, { x: number; y: number }>; dist: number } | null>(null);

  useEffect(() => () => window.clearTimeout(press.current?.timer), []);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    // Scale: sideways drag, the corner or two fingers size it (only when chosen and editable).
    if (selected && !readOnly && tool === "scale") {
      e.preventDefault();
      e.stopPropagation();
      const s = scale.current;
      if (s) {
        s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.pointers.size === 2) {
          const [p, q] = [...s.pointers.values()];
          s.dist = Math.hypot(p!.x - q!.x, p!.y - q!.y);
          s.startW = live ?? size;
        }
        return;
      }
      const line = frame.current?.closest(".vn2-row, .vn2-carousel")?.clientWidth ?? frame.current?.parentElement?.clientWidth ?? 600;
      scale.current = { startW: size, line, x: e.clientX, pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]), dist: 0 };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
      return;
    }
    const at = { x: e.clientX, y: e.clientY };
    window.clearTimeout(press.current?.timer);
    press.current = {
      ...at,
      id: e.pointerId,
      fired: false,
      drag: false,
      timer: window.setTimeout(() => {
        const p = press.current;
        if (!p || p.drag || !url) return;
        p.fired = true;
        navigator.vibrate?.(8);
        act.preview(url);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const s = scale.current;
    if (s) {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      let w: number;
      if (s.pointers.size >= 2 && s.dist > 0) {
        const [p, q] = [...s.pointers.values()];
        w = s.startW * (Math.hypot(p!.x - q!.x, p!.y - q!.y) / s.dist);
      } else w = s.startW + ((e.clientX - s.x) / Math.max(1, s.line)) * 100;
      setLive(Math.round(Math.max(15, Math.min(100, w))));
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.fired) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= DRAG_SLOP) return;
    window.clearTimeout(p.timer);
    // Move: a chosen picture lifts and follows the finger.
    if (selected && !readOnly && tool === "move" && url && frame.current && !p.drag) {
      p.drag = true;
      act.beginDrag(b.id, frame.current, { x: p.x, y: p.y }, url);
    } else press.current = null;
  };

  const onPointerUp = (e: RPointerEvent) => {
    const s = scale.current;
    if (s) {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size > 0) return;
      scale.current = null;
      if (live !== null) {
        const next = snapSize(live);
        setLive(null);
        if (next !== size) act.size(b.id, next);
      }
      return;
    }
    const p = press.current;
    press.current = null;
    if (!p) return;
    window.clearTimeout(p.timer);
    if (!p.fired && !p.drag) act.selectImage(b.id);
  };

  // D8: 100 % keeps the picture's own proportions; 50 % shows it whole in the row's frame; 25 % fills it.
  const ratio = size === 100 && !carousel ? (b.ratio ? String(b.ratio) : undefined) : SHAPE_RATIO[shape];
  const fit = size === 25 ? "cover" : "contain";
  const width = live ?? size;
  const style: CSSProperties = carousel ? {} : { width: `calc((100% - ${cells - 1} * var(--vn2-gap)) * ${width / 100})` };
  const active = selected && !readOnly;
  return (
    <div
      className={cx("vn2-cell", carousel && "vn2-carousel-item", dragging && "vn2-cell-placeholder")}
      style={style}
      data-img-cell={b.id}
      data-block={b.id}
      data-kind="image"
      data-testid="notes-image-block"
      data-size={live !== null ? snapSize(live) : size}
      data-shape={shape}
      data-row={b.row}
      data-carousel={carousel || undefined}
      data-selected={selected || undefined}
      data-tool={tool}
    >
      <div
        ref={frame}
        className={cx("vn2-frame relative", size !== 100 && "vn2-frame-boxed", active && tool !== "move" && "touch-none", active && tool === "move" && "touch-none")}
        style={ratio ? { aspectRatio: ratio } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          scale.current = null;
          setLive(null);
          if (press.current?.id === e.pointerId) {
            window.clearTimeout(press.current.timer);
            press.current = null;
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {url ? (
          <img
            src={url}
            alt={b.text}
            draggable={false}
            decoding="async"
            className={cx("block size-full rounded-[10px]", fit === "cover" ? "object-cover" : "object-contain", active && "vn2-img-active")}
            data-testid="notes-image"
          />
        ) : (
          <div className={cx("grid w-full place-items-center rounded-[10px] bg-surface-secondary", !ratio && "aspect-[4/3]", ratio && "h-full")}>
            <Spinner />
          </div>
        )}
        {active && tool === "scale" && (
          <>
            <span className="vn2-scale-handle" aria-hidden data-testid="notes-image-resize" />
            {live !== null && (
              <span className="vn2-scale-badge" data-testid="notes-image-scale-badge">
                {snapSize(live)}%
              </span>
            )}
          </>
        )}
        {active && <span className="sr-only">{t("notes.image.chosen")}</span>}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------ a carousel

/**
 * D7: the pictures of a carousel scroll sideways one picture at a time; 100 % shows one, 50 % two, 25 %
 * four. Phones: swipe; computers: the arrows. The window (first picture in view) is kept for «Убрать карусель».
 */
const Carousel = memo(function Carousel({
  item,
  selected,
  readOnly,
  act,
  reveal,
}: {
  item: Extract<FlowItem, { kind: "row" }>;
  selected: string | null;
  readOnly: boolean;
  act: FlowActions;
  reveal: string | null;
}) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const per = perLine(item.size);
  const [start, setStart] = useState(0);
  const count = item.images.length;
  const step = useCallback(() => {
    const el = track.current;
    const first = el?.querySelector<HTMLElement>(".vn2-carousel-item");
    if (!el || !first) return 1;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    return first.offsetWidth + gap;
  }, []);
  const go = (index: number) => {
    const el = track.current;
    if (!el) return;
    const i = Math.max(0, Math.min(Math.max(0, count - per), index));
    el.scrollTo({ left: i * step(), behavior: "smooth" });
  };
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const s = Math.round(el.scrollLeft / Math.max(1, step()));
    if (s !== start) {
      setStart(s);
      act.carouselStart(item.id, s);
    }
  };
  // A picture added to the carousel (or chosen in it) comes into view.
  useEffect(() => {
    const id = reveal ?? selected;
    if (!id || !item.images.some((x) => x.id === id)) return;
    const s = windowFor(item.images, id, start, per);
    if (s !== start) go(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, selected, count]);
  return (
    <div className="vn2-carousel-wrap" data-testid="notes-carousel" data-row={item.id} data-size={item.size} data-count={count} data-start={start}>
      <div
        ref={track}
        className="vn2-carousel no-scrollbar"
        style={{ ["--vn2-per" as string]: per } as CSSProperties}
        onScroll={onScroll}
        data-gesture-owner="notes-carousel"
      >
        {item.images.map((b) => (
          <ImageCell key={b.id} b={b} size={item.size} shape={item.shape} cells={1} carousel selected={selected === b.id} readOnly={readOnly} act={act} />
        ))}
      </div>
      {count > per && (
        <>
          <button type="button" className="vn2-carousel-arrow vn2-carousel-prev" onClick={() => go(start - 1)} disabled={start <= 0} aria-label={t("notes.carousel.prev")} data-testid="notes-carousel-prev">
            <RiArrowLeftSLine className="size-5" />
          </button>
          <button type="button" className="vn2-carousel-arrow vn2-carousel-next" onClick={() => go(start + 1)} disabled={start >= count - per} aria-label={t("notes.carousel.next")} data-testid="notes-carousel-next">
            <RiArrowRightSLine className="size-5" />
          </button>
        </>
      )}
    </div>
  );
});

// ------------------------------------------------------------------ dragging a picture

interface DragState {
  id: string;
  url: string;
  w: number;
  h: number;
  dx: number;
  dy: number;
  x: number;
  y: number;
  target: DropTarget | null;
  mark: { left: number; top: number; width: number; height: number; kind: "line" | "ring" } | null;
}

/**
 * D2: the lifted picture follows the finger with a soft shadow; its place in the note stays (faded) until it
 * is dropped. The drop place is worked out from what is under the finger; a thin mark shows it.
 */
export function useFlowDragController(scroller: RefObject<HTMLDivElement | null>, onDrop: (id: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ref = useRef<DragState | null>(null);
  const autoScroll = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const begin = useCallback(
    (id: string, frame: HTMLElement, at: { x: number; y: number }, url: string) => {
      const r = frame.getBoundingClientRect();
      const s: DragState = { id, url, w: r.width, h: r.height, dx: at.x - r.left, dy: at.y - r.top, x: at.x, y: at.y, target: null, mark: null };
      ref.current = s;
      setDrag(s);
      useFlowDrag.setState({ id });
      navigator.vibrate?.(6);
      const move = (e: PointerEvent) => {
        const cur = ref.current;
        if (!cur) return;
        const { target, mark } = targetAt(e.clientX, e.clientY, id);
        const next = { ...cur, x: e.clientX, y: e.clientY, target, mark };
        ref.current = next;
        setDrag(next);
        // Near the top / bottom edge the note scrolls.
        const sc = scroller.current;
        if (sc) {
          const box = sc.getBoundingClientRect();
          const edge = 56;
          // The visible part of the note ends where the floating toolbar (and the picture's panel) begins.
          const bars = document.querySelector<HTMLElement>("[data-testid='notes-toolbar'] > *");
          const bottom = Math.min(box.bottom, bars?.getBoundingClientRect().top ?? box.bottom);
          const top = box.top + 64; // under the floating header
          const v = e.clientY < top + edge ? -1 : e.clientY > bottom - edge ? 1 : 0;
          cancelAnimationFrame(autoScroll.current);
          if (v) {
            const tick = () => {
              sc.scrollTop += v * 9;
              autoScroll.current = requestAnimationFrame(tick);
            };
            autoScroll.current = requestAnimationFrame(tick);
          }
        }
      };
      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        cancelAnimationFrame(autoScroll.current);
        const cur = ref.current;
        ref.current = null;
        setDrag(null);
        useFlowDrag.setState({ id: null });
        if (commit && cur?.target) dropRef.current(cur.id, cur.target);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    [scroller],
  );

  const overlay = drag
    ? createPortal(
        <>
          <div
            className="vn2-drag-ghost"
            style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, height: drag.h }}
            data-testid="notes-drag-ghost"
            aria-hidden
          >
            <img src={drag.url} alt="" draggable={false} className="size-full rounded-[10px] object-contain" />
          </div>
          {drag.mark && <div className={cx("vn2-drop-mark", drag.mark.kind === "ring" && "vn2-drop-ring")} style={drag.mark} data-testid="notes-drop-mark" aria-hidden />}
        </>,
        document.body,
      )
    : null;
  return { begin, overlay };
}

/** What is under the finger → where the picture would go (and the thin mark for it). */
function targetAt(x: number, y: number, dragged: string): { target: DropTarget | null; mark: DragState["mark"] } {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return { target: null, mark: null };
  const cell = el.closest<HTMLElement>("[data-img-cell]");
  if (cell) {
    const id = cell.dataset.imgCell!;
    if (id === dragged) return { target: null, mark: null };
    const r = cell.getBoundingClientRect();
    const rx = (x - r.left) / r.width;
    const ry = (y - r.top) / r.height;
    if (rx > 0.28 && rx < 0.72 && ry > 0.2 && ry < 0.8) return { target: { kind: "onto", id }, mark: { left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6, kind: "ring" } };
    const side = rx < 0.5 ? "left" : "right";
    return { target: { kind: "beside", id, side }, mark: { left: side === "left" ? r.left - 5 : r.right + 2, top: r.top, width: 3, height: r.height, kind: "line" } };
  }
  const text = el.closest<HTMLElement>("[data-text-cell]");
  if (text) {
    const r = text.getBoundingClientRect();
    const side = x < r.left + r.width / 2 ? "left" : "right";
    return { target: { kind: "beside", id: text.dataset.textCell!, side }, mark: { left: side === "left" ? r.left - 5 : r.right + 2, top: r.top, width: 3, height: r.height, kind: "line" } };
  }
  const free = el.closest<HTMLElement>("[data-row-free]");
  if (free) {
    const r = free.getBoundingClientRect();
    return { target: { kind: "beside", id: free.dataset.rowFree!, side: "right" }, mark: { left: r.left, top: r.top, width: 3, height: r.height, kind: "line" } };
  }
  const item = el.closest<HTMLElement>("[data-flow-item]");
  if (item) {
    const r = item.getBoundingClientRect();
    const before = y < r.top + r.height / 2;
    const id = before ? item.dataset.flowItem! : item.dataset.flowLast!;
    return { target: { kind: before ? "before" : "after", id }, mark: { left: r.left, top: before ? r.top - 3 : r.bottom + 1, width: r.width, height: 3, kind: "line" } };
  }
  const page = el.closest<HTMLElement>("[data-page-last]");
  if (page?.dataset.pageLast) {
    const last = page.querySelector<HTMLElement>(`[data-flow-last="${CSS.escape(page.dataset.pageLast)}"]`);
    const r = (last ?? page).getBoundingClientRect();
    return { target: { kind: "after", id: page.dataset.pageLast }, mark: { left: r.left, top: r.bottom + 1, width: r.width, height: 3, kind: "line" } };
  }
  return { target: null, mark: null };
}

// ------------------------------------------------------------------ the picture's panel

/**
 * D9: the chosen picture's panel — only what fits it: Передвижение / Масштаб, the format (rows of 50 / 25 %
 * and carousels), carousel on / off, ← → (only with a picture beside it), text ⇄ picture (only beside the
 * row's text), delete. It sits above the toolbar, so it never covers the text.
 */
export function ImagePanel({
  b,
  blocks,
  onTool,
  onShape,
  onCarousel,
  onSwap,
  onSwapText,
  onRemove,
}: {
  b: NoteBlock;
  blocks: NoteBlock[];
  onTool: (tool: "move" | "scale") => void;
  onShape: () => void;
  onCarousel: (on: boolean) => void;
  onSwap: (dir: -1 | 1) => void;
  onSwapText: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const tool = b.tool ?? "move";
  const size = sizeOf(b);
  const carousel = !!b.carousel;
  const sw = swapTargets(blocks, b.id);
  const text = besideText(blocks, b.id);
  const shape = b.shape ?? "square";
  return (
    <div className="vn2-img-tools pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-[22px] p-1" onPointerDown={(e) => e.preventDefault()} data-testid="notes-image-tools" data-image={b.id}>
      <div className="flex rounded-full bg-black/[0.04] p-0.5 dark:bg-white/[0.06]" role="radiogroup" aria-label={t("notes.image.tool")}>
        {(
          [
            ["move", RiDragMove2Line, "notes.image.toolMove"],
            ["scale", RiExpandDiagonalLine, "notes.image.toolScale"],
          ] as const
        ).map(([id, Icon, key]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            onClick={() => onTool(id)}
            className={cx("flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold", tool === id ? "bg-surface text-primary shadow-sm" : "text-text-secondary")}
            data-testid={`notes-image-tool-${id}`}
          >
            <Icon className="size-[15px]" />
            {t(key)}
          </button>
        ))}
      </div>
      <span className="mx-0.5 h-5 w-px bg-border" />
      {(size < 100 || carousel) && (
        <button type="button" onClick={onShape} aria-label={`${t("notes.image.format")}: ${t(`notes.image.shape.${shape}`)}`} title={t("notes.image.format")} className="vn2-icon-btn size-8" data-testid="notes-image-format" data-shape={shape}>
          <span className={cx("block rounded-[3px] border-[1.8px] border-current", shape === "square" ? "size-[14px]" : shape === "portrait" ? "h-[16px] w-[12px]" : "h-[12px] w-[16px]")} />
        </button>
      )}
      <button
        type="button"
        onClick={() => onCarousel(!carousel)}
        aria-label={carousel ? t("notes.image.carouselOff") : t("notes.image.carouselOn")}
        title={carousel ? t("notes.image.carouselOff") : t("notes.image.carouselOn")}
        aria-pressed={carousel}
        className={cx("vn2-icon-btn size-8", carousel && "text-primary")}
        data-testid="notes-image-carousel"
      >
        <RiCarouselView className="size-[17px]" />
      </button>
      {sw.left && (
        <button type="button" onClick={() => onSwap(-1)} aria-label={t("notes.image.moveLeft")} className="vn2-icon-btn size-8" data-testid="notes-image-left">
          <RiArrowLeftLine className="size-[17px]" />
        </button>
      )}
      {sw.right && (
        <button type="button" onClick={() => onSwap(1)} aria-label={t("notes.image.moveRight")} className="vn2-icon-btn size-8" data-testid="notes-image-right">
          <RiArrowRightLine className="size-[17px]" />
        </button>
      )}
      {text && (
        <button type="button" onClick={onSwapText} aria-label={t("notes.image.swapText")} title={t("notes.image.swapText")} className="vn2-icon-btn size-8" data-testid="notes-image-swap-text">
          <RiSwapBoxLine className="size-[17px]" />
        </button>
      )}
      <button type="button" onClick={onRemove} aria-label={t("notes.delete")} className="vn2-icon-btn size-8 text-danger" data-testid="notes-image-remove">
        <RiDeleteBinLine className="size-[17px]" />
      </button>
    </div>
  );
}
