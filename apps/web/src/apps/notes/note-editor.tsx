import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBold,
  RiCheckboxLine,
  RiDeleteBinLine,
  RiEraserLine,
  RiImageAddLine,
  RiItalic,
  RiListUnordered,
  RiScissorsCutLine,
} from "@remixicon/react";
import type { NoteBlock, NoteBlockKind, NoteBody, NotePage } from "@voidex/shared";
import {
  addCarousel,
  addPage,
  addTextBeside,
  block,
  cycleShape,
  deleteOrClearPage,
  dropImage,
  insertImages,
  layoutFlow,
  normalizeBlocks,
  pageHasContent,
  removeCarousel,
  removeFromFlow,
  removePage,
  setImageSize,
  setTool,
  splitAt,
  swapInRow,
  swapWithText,
  type DropTarget,
  type ImageSize,
} from "@voidex/notes";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { ConfirmDialog, Popover, toast, usePopover } from "@/ui/overlays";
import { downscale, notesApi } from "./data";
import { FlowRow, ImagePanel, useFlowDragController, type FlowActions } from "./flow-view";
import { Menu } from "./kit";

type Change = (next: NoteBody, structural?: boolean) => void;

/** Step 2.13: the block styles of the toolbar's selector (Обычный, Заголовок, Подзаголовок, Заголовок 2, Цитата, Код). */
const TEXT_KINDS: { kind: NoteBlockKind; key: MessageKey }[] = [
  { kind: "text", key: "notes.style.normal" },
  { kind: "heading", key: "notes.block.heading" },
  { kind: "subheading", key: "notes.block.subheading" },
  { kind: "heading2", key: "notes.block.heading2" },
  { kind: "quote", key: "notes.block.quote" },
  { kind: "code", key: "notes.block.code" },
];
/** Headings are headings for assistive technology too (the field sits inside). */
const HEADING_LEVEL: Partial<Record<NoteBlockKind, number>> = {
  heading: 2,
  heading2: 3,
  subheading: 4,
};
const SHORTCUTS: [RegExp, NoteBlockKind][] = [
  [/^#\s$/, "heading"],
  [/^##\s$/, "subheading"],
  [/^[-*]\s$/, "bullet"],
  [/^\[\]\s$/, "checklist"],
  [/^>\s$/, "quote"],
  [/^```$/, "code"],
];

/**
 * Step 2.16 (performance): text fields size themselves to their text
 * (`field-sizing: content`), with no script and no extra layout pass. Where a
 * browser can't, a field is measured only when its own text changes, and the
 * page never moves while it is: before, every field was collapsed to 0 px and
 * measured again on every keystroke, which shrank the document for a moment
 * and threw the scroll position up or down.
 */
const AUTO_SIZE = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
function fit(el: HTMLTextAreaElement | null) {
  if (!el || AUTO_SIZE) return;
  const scroller = el.closest<HTMLElement>("[data-notes-scroller]");
  const top = scroller?.scrollTop ?? 0;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
}

function locate(n: NoteBody, id: string): { page: number; index: number } | null {
  for (let p = 0; p < n.pages.length; p++) {
    const i = n.pages[p]!.blocks.findIndex((b) => b.id === id);
    if (i >= 0) return { page: p, index: i };
  }
  return null;
}

/** A new body with only page `page` changed (the other pages keep their identity, so they don't render again). */
function withPage(n: NoteBody, page: number, fn: (blocks: NoteBlock[]) => NoteBlock[]): NoteBody {
  return { ...n, pages: n.pages.map((p, i) => (i === page ? { ...p, blocks: fn([...p.blocks]) } : p)) };
}

/** One block changed: only its page and the block itself are new objects. */
function patchBlock(n: NoteBody, id: string, patch: Partial<NoteBlock>): NoteBody {
  const at = locate(n, id);
  if (!at) return n;
  return withPage(n, at.page, (l) => {
    l[at.index] = { ...l[at.index]!, ...patch };
    return l;
  });
}

const allBlocks = (n: NoteBody) => n.pages.flatMap((p) => p.blocks);

/** Width / height of an image file (null when it can't be read). */
async function ratioOf(file: Blob): Promise<number | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const r = bmp.width / Math.max(1, bmp.height);
    bmp.close?.();
    return Math.max(0.05, Math.min(20, Math.round(r * 1000) / 1000));
  } catch {
    return undefined;
  }
}

/** What the blocks may ask of the editor; one object for the editor's whole life (so blocks never render again just because the editor did). */
interface Actions extends FlowActions {
  register(id: string, el: HTMLTextAreaElement | null): void;
  text(b: NoteBlock, text: string): void;
  key(e: KeyboardEvent<HTMLTextAreaElement>, b: NoteBlock): void;
  focused(id: string): void;
  /** D1: where the cursor is (pictures are inserted there). */
  caret(id: string, pos: number): void;
  check(b: NoteBlock): void;
  tail(page: number): void;
}

/**
 * The note editor (Step 2.6): clean paper — no block frames, no grid — with a
 * small toolbar. Vertical: one sheet that grows as you write; pages appear
 * only when the person makes one (new page / split here). Square: square
 * pages running sideways, the text flowing on from page to page.
 *
 * Step 2.16:
 * - a note with one page is one open sheet: no page edge in view while you
 *   write; page edges show once there are pages;
 * - typing renders only the block being written (blocks and pages are
 *   memoised and get stable actions), fields size themselves (see fit), and
 *   pictures keep their place while they load (their proportions are stored):
 *   nothing moves the page by itself;
 * - pictures side by side share one size and one shape (square, portrait,
 *   landscape), set by the first; a long press shows a picture large.
 */
export function NoteEditor({ body, onChange, readOnly }: { body: NoteBody; onChange: Change; readOnly: boolean }) {
  const t = useT();
  const ff = useFormFactor();
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; pos: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState(body.pages.length);
  const [side, setSide] = useState(600);
  const [preview, setPreview] = useState<string | null>(null);
  // D1: the last place of the cursor (or a tap on a picture of a carousel): new pictures go there.
  const caret = useRef<{ id: string; pos: number } | null>(null);
  // D7: a picture just added to a carousel is scrolled into view; the window of each carousel is kept.
  const [reveal, setReveal] = useState<string | null>(null);
  const carouselStarts = useRef(new Map<string, number>());
  const square = body.format === "square";
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedImage;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const pageCount = square ? columns : body.pages.length;

  const dragCtl = useFlowDragController(scroller, (id, target) => impl.current && dropPictureRef.current(id, target));
  const dropPictureRef = useRef<(id: string, target: DropTarget) => void>(() => {});

  // ------------------------------------------------------------ focus
  useLayoutEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    const el = areas.current.get(f.id);
    if (el) {
      pendingFocus.current = null;
      el.focus({ preventScroll: false });
      const pos = f.pos < 0 ? el.value.length : Math.min(f.pos, el.value.length);
      el.setSelectionRange(pos, pos);
    }
  });
  const focusBlock = (id: string, pos: number) => {
    pendingFocus.current = { id, pos };
    const el = areas.current.get(id);
    if (el) {
      pendingFocus.current = null;
      el.focus();
      const p = pos < 0 ? el.value.length : Math.min(pos, el.value.length);
      el.setSelectionRange(p, p);
    }
  };

  // ------------------------------------------------------------ layout: square side (and fields where they can't size themselves)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let width = el.clientWidth;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const mobile = w < 600;
      setSide(Math.floor(Math.max(260, Math.min(mobile ? w - 24 : w - 96, h - (mobile ? 150 : 170), 860))));
      // Only a new width changes where lines wrap.
      if (!AUTO_SIZE && w !== width) for (const a of areas.current.values()) fit(a);
      width = w;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const GAP = 28;
  // Square: the number of columns (pages) the text needs, from where the last block lands (square only).
  useLayoutEffect(() => {
    if (!square) return;
    const s = sheet.current;
    const last = s?.querySelector<HTMLElement>("[data-page]:last-child > .vn2-flow-item:last-child");
    const max = last ? last.offsetLeft + 1 : 0;
    const n = Math.max(1, Math.floor(max / (side + GAP)) + 1, body.pages.length);
    if (n !== columns) setColumns(n);
  });

  // The page indicator follows the scroll, at most once a frame.
  const scrollFrame = useRef(0);
  const onScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const el = scroller.current;
      if (!el) return;
      if (square) {
        setPage(Math.round(el.scrollLeft / (side + GAP)));
        return;
      }
      const sheets = el.querySelectorAll<HTMLElement>("[data-page]");
      if (sheets.length < 2) return setPage(0);
      const mid = el.scrollTop + el.clientHeight / 3;
      let current = 0;
      sheets.forEach((s, i) => {
        if (s.offsetTop <= mid) current = i;
      });
      setPage(current);
    });
  }, [square, side]);

  // The wheel turns square pages sideways.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !square) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.ctrlKey) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [square]);

  const goPage = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    const target = Math.max(0, Math.min(pageCount - 1, i));
    if (square) el.scrollTo({ left: target * (side + GAP), behavior: "smooth" });
    else el.querySelectorAll<HTMLElement>("[data-page]")[target]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPage(target);
  };

  // ------------------------------------------------------------ edits
  const patch = (id: string, p: Partial<NoteBlock>, structural = false) => onChange(patchBlock(bodyRef.current, id, p), structural);

  const insertAfter = (id: string, blocks: NoteBlock[], focus?: { id: string; pos: number }) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    onChange(
      withPage(n, at.page, (list) => {
        list.splice(at.index + 1, 0, ...blocks);
        return list;
      }),
      true,
    );
    if (focus) pendingFocus.current = focus;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, b: NoteBlock) => {
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const n = bodyRef.current;
    if ((e.key === "b" || e.key === "i") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      patch(b.id, e.key === "b" ? { bold: !b.bold } : { italic: !b.italic }, true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && b.kind !== "code" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if ((b.kind === "bullet" || b.kind === "checklist") && !b.text) {
        patch(b.id, { kind: "text" }, true);
        return;
      }
      const before = b.text.slice(0, start);
      const after = b.text.slice(end);
      const kind: NoteBlockKind = b.kind === "bullet" || b.kind === "checklist" ? b.kind : "text";
      // The next paragraph keeps the text size when it keeps the style.
      const next = b.size && b.kind === kind ? { ...block(kind, after), size: b.size } : block(kind, after);
      const at = locate(n, b.id)!;
      onChange(
        withPage(n, at.page, (list) => {
          list[at.index] = { ...b, text: before };
          list.splice(at.index + 1, 0, next);
          return list;
        }),
        true,
      );
      pendingFocus.current = { id: next.id, pos: 0 };
      return;
    }
    if (e.key === "Backspace" && start === 0 && end === 0) {
      if (b.kind !== "text") {
        e.preventDefault();
        patch(b.id, { kind: "text" }, true);
        return;
      }
      const at = locate(n, b.id)!;
      const prev = n.pages[at.page]!.blocks[at.index - 1];
      if (prev && prev.kind !== "image") {
        e.preventDefault();
        onChange(
          withPage(n, at.page, (list) => {
            list[at.index - 1] = { ...prev, text: prev.text + b.text };
            list.splice(at.index, 1);
            return list;
          }),
          true,
        );
        pendingFocus.current = { id: prev.id, pos: prev.text.length };
        return;
      }
      if (prev?.kind === "image" && !b.text) {
        e.preventDefault();
        setSelectedImage(prev.id);
        return;
      }
      if (!prev && at.index === 0 && at.page > 0 && !b.text && n.pages[at.page]!.blocks.length === 1) {
        // Backspace in an empty page: the page goes away.
        e.preventDefault();
        const merged = removePage(n, at.page);
        onChange(merged, true);
        const last = merged.pages[at.page - 1]!.blocks.at(-1);
        if (last) pendingFocus.current = { id: last.id, pos: -1 };
        return;
      }
    }
    if ((e.key === "ArrowUp" && start === 0 && end === 0) || (e.key === "ArrowDown" && start === b.text.length && end === start)) {
      const flat = allBlocks(n);
      const idx = flat.findIndex((x) => x.id === b.id);
      const target = e.key === "ArrowUp" ? flat.slice(0, idx).reverse().find((x) => x.kind !== "image") : flat.slice(idx + 1).find((x) => x.kind !== "image");
      if (target) {
        e.preventDefault();
        focusBlock(target.id, e.key === "ArrowUp" ? -1 : 0);
      }
    }
  };

  // ------------------------------------------------------------ images
  /** Applies a flow edit to the page holding `id` (the page is normalized first: older notes too). */
  const editPage = (id: string, fn: (blocks: NoteBlock[]) => NoteBlock[]) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    onChange(
      withPage(n, at.page, (l) => fn(normalizeBlocks(l))),
      true,
    );
  };

  const uploadImages = async (files: File[], afterId: string | null) => {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    if (!images.length || readOnly) return;
    setUploading((n) => n + images.length);
    try {
      const added: NoteBlock[] = [];
      for (const f of images) {
        const data = f.type === "image/gif" ? f : await downscale(f, 2000);
        const [src, ratio] = await Promise.all([notesApi.upload(data), ratioOf(data)]);
        // D1: 100 % of the line to start with.
        added.push({ ...block("image"), src, width: 100, ...(ratio ? { ratio } : {}) });
      }
      const n = bodyRef.current;
      // D1: where the cursor was last (or the chosen picture of a carousel: they join it).
      const sel = selectedRef.current ? allBlocks(n).find((b) => b.id === selectedRef.current) : undefined;
      const place = sel?.carousel ? { id: sel.id } : afterId ? { id: afterId, pos: caret.current?.id === afterId ? caret.current.pos : undefined } : caret.current;
      const at = place ? locate(n, place.id) : null;
      const pageIndex = at?.page ?? Math.min(page, n.pages.length - 1);
      onChange(
        withPage(n, pageIndex, (l) => {
          const next = insertImages(normalizeBlocks(l), added, at ? place : null, (text) => block("text", text));
          // A line to write on after pictures at the very end of the page.
          return next.at(-1)?.kind === "image" ? [...next, block("text")] : next;
        }),
        true,
      );
      setSelectedImage(added[0]!.id);
      if (sel?.carousel) setReveal(added[0]!.id);
    } catch {
      toast({ title: t("notes.imageFailed"), tone: "danger" });
    } finally {
      setUploading((n) => Math.max(0, n - images.length));
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void uploadImages(files, focused);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-block]")?.dataset.block ?? null;
    void uploadImages([...e.dataTransfer.files], target);
  };

  /** D2: a dropped picture (it may land on another page). */
  const dropPicture = (id: string, target: DropTarget) => {
    const n = bodyRef.current;
    const from = locate(n, id);
    const to = locate(n, target.id);
    if (!from || !to) return;
    if (from.page === to.page) editPage(id, (l) => dropImage(l, id, target));
    else {
      const pic = { ...n.pages[from.page]!.blocks[from.index]! };
      delete pic.row;
      delete pic.carousel;
      const without = withPage(n, from.page, (l) => removeFromFlow(normalizeBlocks(l), id, () => block()));
      onChange(
        withPage(without, to.page, (l) => dropImage([...normalizeBlocks(l), pic], id, target)),
        true,
      );
    }
    setSelectedImage(id);
  };

  dropPictureRef.current = dropPicture;

  const removeBlock = (id: string) => {
    editPage(id, (l) => removeFromFlow(l, id, () => block()));
    setSelectedImage(null);
  };

  /** D3: a tap beside a picture: a text column there, with the cursor in it. */
  const addTextBesideImage = (imageId: string) => {
    let created: string | null = null;
    editPage(imageId, (l) => {
      const r = addTextBeside(l, imageId, () => block("text"));
      created = r.textId;
      return r.blocks;
    });
    if (created) {
      pendingFocus.current = { id: created, pos: 0 };
      setSelectedImage(null);
    }
  };

  const tailClick = (pageIndex: number) => {
    const p = bodyRef.current.pages[pageIndex];
    const last = p?.blocks.at(-1);
    if (last && last.kind !== "image" && !last.text) focusBlock(last.id, 0);
    else if (last) {
      const nb = block();
      insertAfter(last.id, [nb], { id: nb.id, pos: 0 });
    }
  };

  const setText = (b: NoteBlock, text: string) => {
    for (const [re, kind] of SHORTCUTS) {
      if (b.kind === "text" && re.test(text)) {
        patch(b.id, { kind, text: "" }, true);
        return;
      }
    }
    patch(b.id, { text });
  };

  // The blocks' actions: one object for the editor's life, always calling the latest code.
  const impl = useRef<Actions>(null!);
  impl.current = {
    register: (id, el) => {
      if (el) areas.current.set(id, el);
      else areas.current.delete(id);
    },
    text: setText,
    key: onKey,
    focused: (id) => {
      setFocused(id);
      setSelectedImage(null);
    },
    caret: (id, pos) => {
      caret.current = { id, pos };
    },
    check: (b) => patch(b.id, { checked: !b.checked }, true),
    selectImage: (id) => {
      setSelectedImage(id);
      (document.activeElement as HTMLElement | null)?.blur?.();
    },
    tail: tailClick,
    preview: (src) => setPreview(src),
    beginDrag: (id, frame, at, url) => dragCtl.begin(id, frame, at, url),
    size: (id, size: ImageSize) => editPage(id, (l) => setImageSize(l, id, size)),
    addText: addTextBesideImage,
    carouselStart: (rowId, start) => carouselStarts.current.set(rowId, start),
  };
  const act = useMemo<Actions>(
    () => ({
      register: (...a) => impl.current.register(...a),
      text: (...a) => impl.current.text(...a),
      key: (...a) => impl.current.key(...a),
      focused: (...a) => impl.current.focused(...a),
      caret: (...a) => impl.current.caret(...a),
      check: (...a) => impl.current.check(...a),
      selectImage: (...a) => impl.current.selectImage(...a),
      tail: (...a) => impl.current.tail(...a),
      preview: (...a) => impl.current.preview(...a),
      beginDrag: (...a) => impl.current.beginDrag(...a),
      size: (...a) => impl.current.size(...a),
      addText: (...a) => impl.current.addText(...a),
      carouselStart: (...a) => impl.current.carouselStart(...a),
    }),
    [],
  );

  // ------------------------------------------------------------ pages
  const newPage = () => {
    const n = bodyRef.current;
    const at = focused ? locate(n, focused) : null;
    const { note, page: p } = addPage(n, at?.page ?? n.pages.length - 1);
    onChange(note, true);
    pendingFocus.current = { id: p.blocks[0]!.id, pos: 0 };
    const index = note.pages.findIndex((x) => x.id === p.id);
    requestAnimationFrame(() => goPage(index));
  };
  const canSplit = !!focused && (locate(body, focused)?.index ?? 0) > 0;
  const splitHere = () => {
    if (!focused) return;
    onChange(splitAt(bodyRef.current, focused), true);
    pendingFocus.current = { id: focused, pos: 0 };
  };
  // Step 2.7: a later page is deleted (asking first when it has content); the first page is cleared instead.
  const [askDelete, setAskDelete] = useState<number | null>(null);
  const runDelete = (at: number) => {
    const r = deleteOrClearPage(bodyRef.current, at);
    onChange(r.note, true);
    const firstBlock = r.note.pages[r.show]?.blocks[0];
    if (firstBlock) pendingFocus.current = { id: firstBlock.id, pos: r.cleared ? 0 : -1 };
    requestAnimationFrame(() => goPage(r.show));
  };
  const currentPage = Math.min(page, body.pages.length - 1);
  const deletePage = () => {
    const at = currentPage;
    if (pageHasContent(bodyRef.current, at)) setAskDelete(at);
    else runDelete(at);
  };

  // ------------------------------------------------------------ focused block style
  const current = focused ? allBlocks(body).find((b) => b.id === focused) : undefined;
  const setKind = (kind: NoteBlockKind) => {
    if (!current) return;
    patch(current.id, { kind: current.kind === kind && kind !== "text" ? "text" : kind }, true);
    pendingFocus.current = { id: current.id, pos: -1 };
  };

  const firstId = body.pages[0]?.blocks[0]?.id;
  const empty = body.pages.length === 1 && body.pages[0]!.blocks.every((b) => b.kind !== "image" && !b.text);
  const placeholderId = empty ? (firstId ?? null) : null;

  // D9: the chosen picture's panel (a bar above the toolbar).
  const selAt = selectedImage ? locate(body, selectedImage) : null;
  const selList = selAt ? normalizeBlocks(body.pages[selAt.page]!.blocks) : [];
  const sel = selAt ? selList.find((x) => x.id === selectedImage) : undefined;
  const imageTools =
    sel && sel.kind === "image" && !readOnly ? (
      <ImagePanel
        key={sel.id}
        b={sel}
        blocks={selList}
        onTool={(tool) => editPage(sel.id, (l) => setTool(l, sel.id, tool))}
        onShape={() => editPage(sel.id, (l) => cycleShape(l, sel.id))}
        onCarousel={(on) =>
          editPage(sel.id, (l) => (on ? addCarousel(l, sel.id) : removeCarousel(l, sel.id, sel.row ? (carouselStarts.current.get(sel.row) ?? 0) : 0)))
        }
        onSwap={(d) => editPage(sel.id, (l) => swapInRow(l, sel.id, d))}
        onSwapText={() => editPage(sel.id, (l) => swapWithText(l, sel.id))}
        onRemove={() => removeBlock(sel.id)}
      />
    ) : null;

  const paged = body.pages.length > 1;
  return (
    <div className={cx("vn2-note relative flex min-h-0 flex-1 flex-col", square ? "vn2-square" : "vn2-vertical")} data-testid="notes-note-editor" data-format={body.format} data-pages={body.pages.length}>
      <div
        ref={scroller}
        onScroll={onScroll}
        onPaste={onPaste}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={onDrop}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest(".vn2-cell, .vn2-img-tools, .vn2-carousel-arrow")) setSelectedImage(null);
        }}
        className={cx("vn2-scroll min-h-0 flex-1", square ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto overflow-x-hidden")}
        data-notes-scroller
        data-testid="notes-paper-scroller"
      >
        {square ? (
          <div className="flex h-full items-center px-3 sm:px-12" style={{ paddingTop: 64, paddingBottom: ff === "mobile" ? 86 : 96 }}>
            <div
              ref={sheet}
              className="vn2-columns"
              style={{
                height: side,
                width: pageCount * side + (pageCount - 1) * GAP,
                columnCount: pageCount,
                columnGap: GAP,
                backgroundImage: `repeating-linear-gradient(90deg, var(--vn2-paper) 0 ${side}px, transparent ${side}px ${side + GAP}px)`,
                ["--vn2-side" as string]: `${side}px`,
              }}
              data-testid="notes-paper"
            >
              {body.pages.map((p, i) => (
                <Sheet
                  key={p.id}
                  page={p}
                  index={i}
                  mode="column"
                  readOnly={readOnly}
                  selected={selAt?.page === i ? selectedImage : null}
                  placeholderId={i === 0 ? placeholderId : null}
                  reveal={reveal}
                  act={act}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className={cx("mx-auto flex w-full max-w-[820px] flex-col px-0 pt-16 sm:px-6 sm:pt-[72px]", paged ? "gap-6 pb-40" : "min-h-full")}>
            {body.pages.map((p, i) => (
              <Sheet
                key={p.id}
                page={p}
                index={i}
                mode={paged ? "paged" : "open"}
                readOnly={readOnly}
                selected={selAt?.page === i ? selectedImage : null}
                placeholderId={i === 0 ? placeholderId : null}
                reveal={reveal}
                act={act}
              />
            ))}
          </div>
        )}
      </div>

      {/* While a picture's tools are open they take the bottom; the page navigator steps aside. */}
      {imageTools ? null : (
        <PageNav
          page={page}
          count={pageCount}
          onGo={goPage}
          readOnly={readOnly}
          canSplit={canSplit}
          canDelete
          clears={currentPage === 0}
          onNew={newPage}
          onSplit={splitHere}
          onDelete={deletePage}
          raised={!readOnly}
          compact={!square}
        />
      )}
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        onConfirm={() => {
          const at = askDelete;
          setAskDelete(null);
          if (at !== null) runDelete(at);
        }}
        title={askDelete === 0 ? t("notes.page.clearTitle") : t("notes.page.deleteTitle")}
        message={askDelete === 0 ? t("notes.page.clearBody") : t("notes.page.deleteBody")}
        confirmLabel={askDelete === 0 ? t("notes.page.clearConfirm") : t("notes.page.deleteConfirm")}
        danger
      />

      {!readOnly && (
        <Toolbar
          above={imageTools}
          current={current}
          uploading={uploading > 0}
          onKind={setKind}
          onBold={() => current && patch(current.id, { bold: !current.bold }, true)}
          onItalic={() => current && patch(current.id, { italic: !current.italic }, true)}
          onImages={(files) => void uploadImages(files, focused)}
          clears={currentPage === 0}
          onDeletePage={deletePage}
        />
      )}
      {preview && <ImagePreview url={preview} onClose={() => setPreview(null)} />}
      {dragCtl.overlay}
    </div>
  );
}

/**
 * One page. Memoised: typing in another page (or another block of this one)
 * leaves it alone; its layout of rows is worked out only when its blocks change.
 */
const Sheet = memo(function Sheet({
  page,
  index,
  mode,
  readOnly,
  selected,
  placeholderId,
  reveal,
  act,
}: {
  page: NotePage;
  index: number;
  /** open: the only page of a note (no page edge); paged: one of several; column: a square note's column. */
  mode: "open" | "paged" | "column";
  readOnly: boolean;
  selected: string | null;
  placeholderId: string | null;
  reveal: string | null;
  act: Actions;
}) {
  const t = useT();
  // Stage D: the page in the layout model (older notes are brought into it here, nothing is lost).
  const laid = useMemo(() => layoutFlow(normalizeBlocks(page.blocks)), [page.blocks]);
  const placeholder = t("notes.placeholder");
  const renderText = (b: NoteBlock) => <TextBlock key={b.id} b={b} placeholder={b.id === placeholderId ? placeholder : undefined} readOnly={readOnly} act={act} />;
  const blocks = laid.map((it) => {
    const first = it.kind === "row" ? (it.cells[0]!.kind === "image" ? it.cells[0]!.block.id : it.cells[0]!.blocks[0]!.id) : it.block.id;
    const lastCell = it.kind === "row" ? it.cells.at(-1)! : null;
    const last = it.kind === "row" ? (lastCell!.kind === "image" ? lastCell!.block.id : lastCell!.blocks.at(-1)!.id) : it.block.id;
    return (
      <div key={it.kind === "row" ? `row-${it.id}` : it.block.id} className="vn2-flow-item" data-flow-item={first} data-flow-last={last}>
        {it.kind === "row" ? <FlowRow item={it} selected={selected} readOnly={readOnly} act={act} renderText={renderText} reveal={reveal} /> : renderText(it.block)}
      </div>
    );
  });
  const lastId = page.blocks.at(-1)?.id;
  if (mode === "column")
    return (
      <div className="vn2-page-col" style={index > 0 ? { breakBefore: "column" } : undefined} data-page={index} data-page-last={lastId}>
        {blocks}
      </div>
    );
  return (
    <div className={cx("vn2-sheet", mode === "paged" ? "vn2-sheet-paged" : "vn2-sheet-open")} data-page={index} data-page-last={lastId} data-testid="notes-paper" data-open={mode === "open" || undefined}>
      {blocks}
      {!readOnly && <button type="button" aria-hidden tabIndex={-1} className="vn2-tail block w-full cursor-text [clear:both]" onClick={() => act.tail(index)} />}
    </div>
  );
});

/** A paragraph (any text style). Renders again only when its own block changes. */
const TextBlock = memo(function TextBlock({ b, placeholder, readOnly, act }: { b: NoteBlock; placeholder?: string; readOnly: boolean; act: Actions }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el;
      act.register(b.id, el);
    },
    [act, b.id],
  );
  // Sized once when it appears and again only when its own text changes (see fit).
  useLayoutEffect(() => fit(ref.current), [b.text, b.kind, b.size]);
  return (
    <div
      className={cx("vn2-b", `vn2-b-${b.kind}`, b.bold && "vn2-bold", b.italic && "vn2-italic", b.checked && "vn2-done")}
      style={b.size ? { fontSize: b.size } : undefined}
      data-block={b.id}
      data-kind={b.kind}
      data-size={b.size}
      {...(HEADING_LEVEL[b.kind] ? { role: "heading", "aria-level": HEADING_LEVEL[b.kind] } : {})}
    >
      {b.kind === "checklist" && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!b.checked}
          aria-label={b.text || t("notes.block.checklist")}
          disabled={readOnly}
          onClick={() => act.check(b)}
          className="vn2-check"
          data-testid="notes-check"
        />
      )}
      {b.kind === "bullet" && <span className="vn2-dot" aria-hidden />}
      <textarea
        ref={setRef}
        rows={1}
        value={b.text}
        readOnly={readOnly}
        spellCheck
        placeholder={placeholder}
        onChange={(e) => act.text(b, e.target.value)}
        onKeyDown={(e) => act.key(e, b)}
        onFocus={(e) => {
          act.focused(b.id);
          act.caret(b.id, e.currentTarget.selectionStart);
        }}
        onSelect={(e) => act.caret(b.id, e.currentTarget.selectionStart)}
        onKeyUp={(e) => act.caret(b.id, e.currentTarget.selectionStart)}
        onPointerUp={(e) => act.caret(b.id, e.currentTarget.selectionStart)}
        className="vn2-text"
        data-testid="notes-block"
        aria-label={t(`notes.block.${b.kind}`)}
      />
    </div>
  );
});

/** Step 2.16: a long-pressed picture, large in the middle over the note; a tap on the empty space around it closes it. */
function ImagePreview({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div
      className="vn2-preview absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-5 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal
      aria-label={t("notes.image.preview")}
      data-testid="notes-image-preview"
    >
      <img src={url} alt="" draggable={false} className="max-h-[86%] max-w-full rounded-[18px] object-contain shadow-[0_24px_80px_-20px_rgba(0,0,0,0.55)]" data-testid="notes-image-preview-img" />
    </div>
  );
}

/** ‹ 2 / 6 › with "+" (new page / split here / delete page). */
function PageNav({
  page,
  count,
  onGo,
  readOnly,
  canSplit,
  canDelete,
  clears,
  onNew,
  onSplit,
  onDelete,
  raised,
  compact,
}: {
  page: number;
  count: number;
  onGo: (i: number) => void;
  readOnly: boolean;
  canSplit: boolean;
  canDelete: boolean;
  /** The first page is cleared, not deleted. */
  clears: boolean;
  onNew: () => void;
  onSplit: () => void;
  onDelete: () => void;
  raised: boolean;
  compact: boolean;
}) {
  const t = useT();
  const pop = usePopover();
  if (readOnly && count <= 1) return null;
  const menu = (
    <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={230} testId="notes-page-menu">
      <Menu
        onDone={pop.close}
        items={[
          { id: "page-new", label: t("notes.page.new"), icon: <RiAddLine className="size-[18px]" />, onSelect: onNew },
          ...(canSplit ? [{ id: "page-split", label: t("notes.page.split"), icon: <RiScissorsCutLine className="size-[18px]" />, onSelect: onSplit }] : []),
          ...(canDelete
            ? [{ id: "page-delete", label: clears ? t("notes.page.clear") : t("notes.page.delete"), icon: clears ? <RiEraserLine className="size-[18px]" /> : <RiDeleteBinLine className="size-[18px]" />, onSelect: onDelete, danger: true, divider: true }]
            : []),
        ]}
      />
    </Popover>
  );
  // One continuous sheet: just the "+" for pages (no "1 / 1" over the text).
  if (count <= 1 && compact)
    return (
      <div className={cx("vn2-pagenav pointer-events-auto absolute right-3 z-20 rounded-full p-1", raised ? "vn2-pagenav-raised" : "bottom-[max(env(safe-area-inset-bottom),14px)]")} data-testid="notes-page-nav" data-compact>
        <button ref={pop.anchor} type="button" onClick={pop.toggle} aria-label={t("notes.page.new")} title={t("notes.page.new")} className="vn2-icon-btn size-9" data-testid="notes-page-add">
          <RiAddLine className="size-5" />
        </button>
        {menu}
      </div>
    );
  return (
    <div className={cx("vn2-pagenav pointer-events-auto absolute right-3 z-20 flex items-center gap-0.5 rounded-full p-1", raised ? "vn2-pagenav-raised" : "bottom-[max(env(safe-area-inset-bottom),14px)]")} data-testid="notes-page-nav">
      <button type="button" onClick={() => onGo(page - 1)} disabled={page <= 0} aria-label={t("notes.page.prev")} className="vn2-icon-btn size-9" data-testid="notes-page-prev">
        <RiArrowLeftSLine className="size-5" />
      </button>
      <span className="min-w-[44px] text-center text-[13.5px] font-medium tabular-nums text-text" data-testid="notes-page-indicator">
        {Math.min(page + 1, count)} / {count}
      </span>
      <button type="button" onClick={() => onGo(page + 1)} disabled={page >= count - 1} aria-label={t("notes.page.next")} className="vn2-icon-btn size-9" data-testid="notes-page-next">
        <RiArrowRightSLine className="size-5" />
      </button>
      {!readOnly && (
        <>
          <button ref={pop.anchor} type="button" onClick={pop.toggle} aria-label={t("notes.page.new")} title={t("notes.page.new")} className="vn2-icon-btn size-9" data-testid="notes-page-add">
            <RiAddLine className="size-5" />
          </button>
          {menu}
        </>
      )}
    </div>
  );
}

/**
 * The minimal toolbar: the block style selector (Step 2.13: Обычный,
 * Заголовок, Подзаголовок, Заголовок 2, Цитата, Код, for the paragraph the
 * cursor is in), list, checklist, picture, bold, italic, and delete page. On
 * phones it rides on top of the keyboard (visual viewport), never under it,
 * and scrolls sideways when it doesn't fit.
 */
function Toolbar({
  above,
  current,
  uploading,
  onKind,
  onBold,
  onItalic,
  onImages,
  clears,
  onDeletePage,
}: {
  /** Step 2.13: the selected picture's tools, shown above the bar. */
  above?: ReactNode;
  current?: NoteBlock;
  uploading: boolean;
  onKind: (k: NoteBlockKind) => void;
  onBold: () => void;
  onItalic: () => void;
  onImages: (files: File[]) => void;
  /** The first page is cleared, not deleted. */
  clears: boolean;
  onDeletePage: () => void;
}) {
  const t = useT();
  const pop = usePopover();
  const file = useRef<HTMLInputElement>(null);
  // Keep the text focused when a toolbar button is pressed.
  const keep = (e: RPointerEvent) => e.preventDefault();
  const kind = current && current.kind !== "image" ? current.kind : "text";
  const styleKey = TEXT_KINDS.find((k) => k.kind === kind)?.key ?? (kind === "bullet" || kind === "checklist" ? `notes.block.${kind}` : "notes.style.normal");
  return (
    // On phones it rides just above the keyboard (Step 2.8: the shared keyboard tracker, see lib/keyboard).
    <div className="vx-kb-bottom vn2-toolbar-wrap pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3" data-testid="notes-toolbar">
      {above}
      <div className="vn2-toolbar no-scrollbar pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1" onPointerDown={keep}>
        <button
          ref={pop.anchor}
          type="button"
          onClick={pop.toggle}
          aria-label={`${t("notes.tool.style")}: ${t(styleKey as MessageKey)}`}
          aria-haspopup="menu"
          title={t("notes.tool.style")}
          className={cx("vn2-style-btn flex h-11 shrink-0 items-center gap-1 rounded-full pl-3.5 pr-2 text-[14px] font-semibold", kind !== "text" ? "text-primary" : "text-text")}
          data-testid="notes-tool-style"
          data-kind={kind}
        >
          <span className="max-w-[112px] truncate">{t(styleKey as MessageKey)}</span>
          <RiArrowDownSLine className="size-4 shrink-0 opacity-70" />
        </button>
        <button
          type="button"
          onClick={() => onKind("bullet")}
          aria-label={t("notes.block.bullet")}
          title={t("notes.block.bullet")}
          aria-pressed={current?.kind === "bullet"}
          className={cx("vn2-icon-btn size-11 shrink-0", current?.kind === "bullet" && "text-primary")}
          data-testid="notes-tool-bullet"
        >
          <RiListUnordered className="size-[21px]" />
        </button>
        <button
          type="button"
          onClick={() => onKind("checklist")}
          aria-label={t("notes.block.checklist")}
          title={t("notes.block.checklist")}
          aria-pressed={current?.kind === "checklist"}
          className={cx("vn2-icon-btn size-11 shrink-0", current?.kind === "checklist" && "text-primary")}
          data-testid="notes-tool-checklist"
        >
          <RiCheckboxLine className="size-[21px]" />
        </button>
        <button
          type="button"
          onClick={() => file.current?.click()}
          aria-label={t("notes.tool.image")}
          title={t("notes.tool.image")}
          className="vn2-icon-btn size-11 shrink-0"
          data-testid="notes-tool-image"
        >
          {uploading ? <Spinner size={18} /> : <RiImageAddLine className="size-[21px]" />}
        </button>
        <span className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        <button
          type="button"
          onClick={onBold}
          aria-label={t("notes.tool.bold")}
          title={t("notes.tool.bold")}
          aria-pressed={!!current?.bold}
          className={cx("vn2-icon-btn size-11 shrink-0", current?.bold && "text-primary")}
          data-testid="notes-tool-bold"
        >
          <RiBold className="size-[20px]" />
        </button>
        <button
          type="button"
          onClick={onItalic}
          aria-label={t("notes.tool.italic")}
          title={t("notes.tool.italic")}
          aria-pressed={!!current?.italic}
          className={cx("vn2-icon-btn size-11 shrink-0", current?.italic && "text-primary")}
          data-testid="notes-tool-italic"
        >
          <RiItalic className="size-[20px]" />
        </button>
        {/* Step 2.8: deleting the current page is one tap away (the first page is cleared instead). */}
        <span className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        <button
          type="button"
          onClick={onDeletePage}
          aria-label={clears ? t("notes.page.clear") : t("notes.page.delete")}
          title={clears ? t("notes.page.clear") : t("notes.page.delete")}
          className="vn2-icon-btn size-11 shrink-0 text-danger"
          data-testid="notes-tool-delete-page"
        >
          {clears ? <RiEraserLine className="size-[20px]" /> : <RiDeleteBinLine className="size-[20px]" />}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          data-testid="notes-image-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onImages(files);
          }}
        />
        <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={230} testId="notes-style-menu">
          <Menu
            onDone={pop.close}
            items={TEXT_KINDS.map((k) => ({
              id: `style-${k.kind}`,
              label: t(k.key),
              labelNode: <span className={cx("vn2-style-sample", `vn2-style-sample-${k.kind}`)}>{t(k.key)}</span>,
              checked: kind === k.kind,
              onSelect: () => onKind(k.kind),
            }))}
          />
        </Popover>
      </div>
    </div>
  );
}
