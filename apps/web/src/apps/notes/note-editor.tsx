import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import {
  RiAddLine,
  RiAlignCenter,
  RiAlignLeft,
  RiAlignRight,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiBold,
  RiBookOpenLine,
  RiCheckboxLine,
  RiDeleteBinLine,
  RiEraserLine,
  RiFontSize,
  RiImageAddLine,
  RiItalic,
  RiLayoutColumnLine,
  RiLayoutRowLine,
  RiListUnordered,
  RiScissorsCutLine,
  RiTextWrap,
} from "@remixicon/react";
import { BOOK_FONT_SIZES, type NoteBlock, type NoteBlockKind } from "@voidex/shared";
import { addPage, addSpread, block, deleteOrClearPage, joinRow, layoutBlocks, leaveRow, moveInPage, newId, pageHasContent, removePage, splitAt, type PagedBody } from "@voidex/notes";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { ConfirmDialog, Popover, toast, usePopover } from "@/ui/overlays";
import { downscale, notesApi, useMediaUrl } from "./data";
import { Menu } from "./kit";

type Change = (next: PagedBody, structural?: boolean) => void;

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

function fit(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function mapBlocks<T extends PagedBody>(n: T, fn: (b: NoteBlock) => NoteBlock): T {
  return { ...n, pages: n.pages.map((p) => ({ ...p, blocks: p.blocks.map(fn) })) };
}

function locate(n: PagedBody, id: string): { page: number; index: number } | null {
  for (let p = 0; p < n.pages.length; p++) {
    const i = n.pages[p]!.blocks.findIndex((b) => b.id === id);
    if (i >= 0) return { page: p, index: i };
  }
  return null;
}

function withPage<T extends PagedBody>(n: T, page: number, fn: (blocks: NoteBlock[]) => NoteBlock[]): T {
  return { ...n, pages: n.pages.map((p, i) => (i === page ? { ...p, blocks: fn([...p.blocks]) } : p)) };
}

const allBlocks = (n: PagedBody) => n.pages.flatMap((p) => p.blocks);


/**
 * The note editor (Step 2.6): clean paper — no block frames, no grid — with a
 * small toolbar. Vertical: a portrait sheet that grows as you write (one
 * page = unlimited length), pages stacked downwards. Square: square pages
 * running sideways (the wheel scrolls them), text flowing on to the next
 * page by itself. Pages: "+ Новая страница" and "Разделить здесь" in the
 * page navigator (‹ 2 / 6 ›); there is no page-break button.
 *
 * Step 2.13: the same editor writes books (`.book`): fixed pages shown as a
 * spread on wide screens and one page on phones; only the shown pages are
 * rendered; pages come only from "+" (a page or a spread), never by
 * themselves. Notes and books share blocks, pictures (rows of pictures side
 * by side, text flowing around a picture on the left or right) and styles.
 */
export function NoteEditor({
  body,
  onChange,
  readOnly,
  initialPage = 0,
  onPage,
}: {
  body: PagedBody;
  onChange: Change;
  readOnly: boolean;
  /** Books: the page to open on (back from reading mode on the page that was read). */
  initialPage?: number;
  /** Books: the first page shown changed. */
  onPage?: (page: number) => void;
}) {
  const t = useT();
  const ff = useFormFactor();
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; pos: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageCount, setPageCount] = useState(body.pages.length);
  const [side, setSide] = useState(600);
  const [box, setBox] = useState({ w: 800, h: 700 });
  const book = body.kind === "book";
  const square = body.kind === "note" && body.format === "square";
  const bodyRef = useRef(body);
  bodyRef.current = body;

  // Book: a spread (two pages) when there is room for two readable pages, one page otherwise.
  const spread = book && box.w >= 820;
  const per = spread ? 2 : 1;
  const bookPageW = Math.floor(spread ? Math.max(260, Math.min((box.w - 120) / 2, ((box.h - 180) / 1.414) * 1.05, 560)) : Math.max(240, Math.min(box.w - 24, 620)));
  const first = book ? Math.min(page, Math.max(0, body.pages.length - 1)) - (Math.min(page, Math.max(0, body.pages.length - 1)) % per) : 0;
  const visible = (p: number) => !book || (p >= first && p < first + per);
  useEffect(() => {
    if (book) onPage?.(first);
  }, [book, first, onPage]);


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
    if (book) {
      // A book shows only its current pages: turn to the page that holds the block.
      const at = locate(bodyRef.current, id);
      if (at && !visible(at.page)) setPage(at.page);
    }
    const el = areas.current.get(id);
    if (el) {
      pendingFocus.current = null;
      el.focus();
      const p = pos < 0 ? el.value.length : Math.min(pos, el.value.length);
      el.setSelectionRange(p, p);
    }
  };

  // ------------------------------------------------------------ layout: square side, columns, page indicator
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const mobile = w < 600;
      const s = Math.floor(Math.max(260, Math.min(mobile ? w - 24 : w - 96, h - (mobile ? 150 : 170), 860)));
      setSide(s);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
      for (const a of areas.current.values()) fit(a);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const GAP = 28;
  // Square: the number of columns (pages) the text needs, from where the last block lands.
  useLayoutEffect(() => {
    if (!square) {
      setPageCount(body.pages.length);
      return;
    }
    const s = sheet.current;
    if (!s) return;
    let max = 0;
    for (const el of s.querySelectorAll<HTMLElement>("[data-block]")) max = Math.max(max, el.offsetLeft + 1);
    const n = Math.max(1, Math.floor(max / (side + GAP)) + 1, body.pages.length);
    if (n !== pageCount) setPageCount(n);
  });

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || book) return;
    if (square) {
      setPage(Math.round(el.scrollLeft / (side + GAP)));
      return;
    }
    const sheets = el.querySelectorAll<HTMLElement>("[data-page]");
    const mid = el.scrollTop + el.clientHeight / 3;
    let current = 0;
    sheets.forEach((s, i) => {
      if (s.offsetTop <= mid) current = i;
    });
    setPage(current);
  }, [square, side, book]);


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
    if (book) {
      const target = Math.max(0, Math.min(bodyRef.current.pages.length - 1, i));
      setPage(target - (target % per));
      el.scrollTo({ top: 0 });
      return;
    }
    const target = Math.max(0, Math.min(pageCount - 1, i));
    if (square) el.scrollTo({ left: target * (side + GAP), behavior: "smooth" });
    else el.querySelectorAll<HTMLElement>("[data-page]")[target]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPage(target);
  };

  // Book: ← / → turn the pages when no text field has the keyboard.
  useEffect(() => {
    if (!book) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.closest("textarea, input, [contenteditable=true], [role=dialog], [role=menu]") || !scroller.current?.closest("[data-testid=notes-doc]")?.isConnected)) return;
      if (e.key === "ArrowRight") goPage(first + per);
      else if (e.key === "ArrowLeft") goPage(first - per);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });


  // ------------------------------------------------------------ edits
  const patch = (id: string, p: Partial<NoteBlock>, structural = false) => onChange(mapBlocks(bodyRef.current, (b) => (b.id === id ? { ...b, ...p } : b)), structural);

  const setText = (b: NoteBlock, text: string) => {
    for (const [re, kind] of SHORTCUTS) {
      if (b.kind === "text" && re.test(text)) {
        patch(b.id, { kind, text: "" }, true);
        return;
      }
    }
    patch(b.id, { text });
  };

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
    const flat = allBlocks(n);
    const idx = flat.findIndex((x) => x.id === b.id);
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
        if (last) {
          pendingFocus.current = { id: last.id, pos: -1 };
          if (book) setPage(at.page - 1);
        }
        return;
      }
    }
    if (e.key === "ArrowUp" && start === 0 && end === 0) {
      const prev = flat.slice(0, idx).reverse().find((x) => x.kind !== "image");
      if (prev) {
        e.preventDefault();
        focusBlock(prev.id, -1);
      }
    }
    if (e.key === "ArrowDown" && start === b.text.length && end === start) {
      const next = flat.slice(idx + 1).find((x) => x.kind !== "image");
      if (next) {
        e.preventDefault();
        focusBlock(next.id, 0);
      }
    }
  };

  // ------------------------------------------------------------ images
  const uploadImages = async (files: File[], afterId: string | null) => {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    if (!images.length || readOnly) return;
    setUploading((n) => n + images.length);
    try {
      const blocks: NoteBlock[] = [];
      for (const f of images) {
        const src = await notesApi.upload(f.type === "image/gif" ? f : await downscale(f, 2000));
        blocks.push({ ...block("image"), src, width: 100, align: "center" });
      }
      const n = bodyRef.current;
      const anchor = afterId ?? focused ?? n.pages[Math.min(book ? first : page, n.pages.length - 1)]!.blocks.at(-1)?.id ?? null;
      const tail = block("text");
      if (anchor && locate(n, anchor)) insertAfter(anchor, [...blocks, tail]);
      else onChange(withPage(n, n.pages.length - 1, (l) => [...l, ...blocks, tail]), true);
      setSelectedImage(blocks[0]!.id);
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

  const moveBlock = (id: string, delta: -1 | 1) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    const list = n.pages[at.page]!.blocks;
    // Inside the page (Step 2.13: within a row, out of a row at its edge, over a whole row).
    const moved = moveInPage(list, at.index, delta);
    if (moved) {
      onChange(
        withPage(n, at.page, () => moved),
        true,
      );
      return;
    }
    // Over the page edge: onto the neighbouring page.
    const p2 = at.page + delta;
    if (p2 < 0 || p2 >= n.pages.length) return;
    const it = { ...list[at.index]! };
    delete it.row;
    const without = withPage(n, at.page, (l) => l.filter((x) => x.id !== id));
    onChange(
      withPage(without, p2, (l) => (delta < 0 ? [...l, it] : [it, ...l])),
      true,
    );
    if (book) setPage(p2);
  };

  /** Step 2.13: beside the picture before it (a row), or back on a line of its own. */
  const setRow = (id: string, join: boolean) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    onChange(
      withPage(n, at.page, (l) => (join ? joinRow(l, at.index, newId()) : leaveRow(l, at.index))),
      true,
    );
  };

  const removeBlock = (id: string) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    onChange(
      withPage(n, at.page, (l) => {
        const gone = l[at.index];
        let out = l.filter((x) => x.id !== id);
        // A row left with one picture is no row any more.
        if (gone?.row && out.filter((x) => x.row === gone.row).length === 1) out = out.map((x) => (x.row === gone.row ? { ...x, row: undefined } : x));
        return out.length ? out : [block()];
      }),
      true,
    );
    setSelectedImage(null);
  };

  // ------------------------------------------------------------ pages
  const focusedPage = focused ? (locate(body, focused)?.page ?? null) : null;
  /** The page the page actions work on: the focused one, else the one shown (a spread: its left page). */
  const currentPage = Math.min(book ? (focusedPage !== null && visible(focusedPage) ? focusedPage : first) : page, body.pages.length - 1);
  const newPage = (two = false) => {
    const n = bodyRef.current;
    const at = focused ? locate(n, focused) : null;
    const after = book ? Math.min(n.pages.length - 1, first + per - 1) : (at?.page ?? n.pages.length - 1);
    const { note, page: p } = two ? addSpread(n, after) : addPage(n, after);
    onChange(note, true);
    pendingFocus.current = { id: p.blocks[0]!.id, pos: 0 };
    const index = note.pages.findIndex((x) => x.id === p.id);
    if (book) setPage(index - (index % per));
    else requestAnimationFrame(() => goPage(index));
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
    if (book) setPage(r.show - (r.show % per));
    else requestAnimationFrame(() => goPage(r.show));
  };
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
  const setSize = (size: number | null) => {
    if (!current) return;
    patch(current.id, { size: size ?? undefined }, true);
    pendingFocus.current = { id: current.id, pos: -1 };
  };


  const placeholder = t("notes.placeholder");
  const firstId = body.pages[0]?.blocks[0]?.id;
  const empty = allBlocks(body).every((b) => b.kind !== "image" && !b.text);

  const renderImage = (b: NoteBlock, row?: { pos: "first" | "mid" | "last" }) => (
    <ImageBlock key={b.id} b={b} row={row} selected={selectedImage === b.id} readOnly={readOnly} onSelect={() => setSelectedImage(b.id)} onPatch={(p, structural) => patch(b.id, p, structural)} />
  );

  // The selected picture's tools (a bar above the toolbar).
  const selAt = selectedImage ? locate(body, selectedImage) : null;
  const selList = selAt ? body.pages[selAt.page]!.blocks : [];
  const sel = selAt ? selList[selAt.index] : undefined;
  const selInRow = !!sel?.row && (selList[selAt!.index - 1]?.row === sel.row || selList[selAt!.index + 1]?.row === sel.row);
  const imageTools =
    sel && sel.kind === "image" && !readOnly ? (
      <ImageTools
        key={sel.id}
        b={sel}
        row={selInRow}
        canJoin={!selInRow && selList[selAt!.index - 1]?.kind === "image"}
        onPatch={(p, structural) => patch(sel.id, p, structural)}
        onMove={(d) => moveBlock(sel.id, d)}
        onRow={(join) => setRow(sel.id, join)}
        onRemove={() => removeBlock(sel.id)}
      />
    ) : null;

  const renderText = (b: NoteBlock) => (
    <div
      key={b.id}
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
          onClick={() => patch(b.id, { checked: !b.checked }, true)}
          className="vn2-check"
          data-testid="notes-check"
        />
      )}
      {b.kind === "bullet" && <span className="vn2-dot" aria-hidden />}
      <textarea
        ref={(el) => {
          if (el) {
            areas.current.set(b.id, el);
            fit(el);
          } else areas.current.delete(b.id);
        }}
        rows={1}
        value={b.text}
        readOnly={readOnly}
        spellCheck
        placeholder={b.id === firstId && empty ? placeholder : undefined}
        onChange={(e) => {
          setText(b, e.target.value);
          fit(e.target);
        }}
        onKeyDown={(e) => onKey(e, b)}
        onFocus={() => {
          setFocused(b.id);
          setSelectedImage(null);
        }}
        className="vn2-text"
        data-testid="notes-block"
        aria-label={t(`notes.block.${b.kind}`)}
      />
    </div>
  );

  /** A page's blocks as laid out (Step 2.13: pictures side by side in rows, text beside a wrapped picture). */
  const renderBlocks = (list: NoteBlock[]) =>
    layoutBlocks(list).map((it) =>
      it.kind === "row" ? (
        <div key={`row-${it.id}-${it.blocks[0]!.id}`} className="vn2-img-row" data-testid="notes-image-row" data-row={it.id} data-count={it.blocks.length}>
          {it.blocks.map((b, i) => renderImage(b, { pos: i === 0 ? "first" : i === it.blocks.length - 1 ? "last" : "mid" }))}
        </div>
      ) : it.block.kind === "image" ? (
        renderImage(it.block)
      ) : (
        renderText(it.block)
      ),
    );


  const tailClick = (p: { blocks: NoteBlock[] }) => {
    const last = p.blocks.at(-1);
    if (last && last.kind !== "image" && !last.text) focusBlock(last.id, 0);
    else if (last) {
      const nb = block();
      insertAfter(last.id, [nb], { id: nb.id, pos: 0 });
    }
  };

  const paged = body.pages.length > 1;
  const bookPages = book ? body.pages.slice(first, first + per) : [];
  return (
    <div
      className={cx("vn2-note relative flex min-h-0 flex-1 flex-col", book ? "vn2-book" : square ? "vn2-square" : "vn2-vertical")}
      data-testid={book ? "notes-book-editor" : "notes-note-editor"}
      data-format={body.format}
      data-pages={body.pages.length}
      data-spread={book ? (spread ? "two" : "one") : undefined}
      data-first={book ? first : undefined}
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        onPaste={onPaste}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={onDrop}
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest(".vn2-img, .vn2-img-tools")) setSelectedImage(null);
        }}
        className={cx("vn2-scroll min-h-0 flex-1", square ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto overflow-x-hidden")}
        data-testid="notes-paper-scroller"
      >
        {book ? (
          <div className="flex min-h-full items-start justify-center px-3 pb-40 pt-16 sm:px-8 sm:pt-[72px]">
            <div className={cx("vn2-spread flex", spread && "vn2-spread-two")} data-testid="book-spread">
              {bookPages.map((p, k) => {
                const i = first + k;
                return (
                  <div
                    key={p.id}
                    className={cx("vn2-book-page", spread && (k === 0 ? "vn2-book-left" : "vn2-book-right"))}
                    style={{
                      width: bookPageW,
                      minHeight: Math.round(bookPageW * 1.414),
                    }}
                    data-page={i}
                    data-testid="book-page"
                  >
                    <div className="vn2-book-content">
                      {renderBlocks(p.blocks)}
                      {!readOnly && <button type="button" aria-hidden tabIndex={-1} className="block h-12 w-full cursor-text [clear:both]" onClick={() => tailClick(p)} />}
                    </div>
                    <span className="vn2-book-number" data-testid="book-page-number">
                      {i + 1}
                    </span>
                  </div>
                );
              })}
              {spread && bookPages.length === 1 && (
                <div
                  className="vn2-book-page vn2-book-right vn2-book-blank grid place-items-center"
                  style={{
                    width: bookPageW,
                    minHeight: Math.round(bookPageW * 1.414),
                  }}
                >
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => newPage()}
                      className="flex flex-col items-center gap-2 rounded-2xl px-5 py-4 text-[14px] font-medium text-text-tertiary hover:text-primary"
                      data-testid="book-add-page-slot"
                    >
                      <RiAddLine className="size-7" />
                      {t("notes.book.addPage")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : square ? (
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
                <div key={p.id} className="vn2-page-col" style={i > 0 ? { breakBefore: "column" } : undefined} data-page={i}>
                  {renderBlocks(p.blocks)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-0 pb-40 pt-16 sm:px-6 sm:pt-[72px]">
            {body.pages.map((p, i) => (
              <div key={p.id} className={cx("vn2-sheet", paged && "vn2-sheet-paged")} data-page={i} data-testid="notes-paper">
                {renderBlocks(p.blocks)}
                {!readOnly && <button type="button" aria-hidden tabIndex={-1} className="block h-16 w-full cursor-text [clear:both]" onClick={() => tailClick(p)} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* While a picture's tools are open they take the bottom; the page navigator steps aside. */}
      {imageTools ? null : book ? (
        <BookNav
          first={first}
          per={per}
          count={body.pages.length}
          onGo={goPage}
          readOnly={readOnly}
          clears={currentPage === 0}
          onNewPage={() => newPage()}
          onNewSpread={() => newPage(true)}
          onDelete={deletePage}
        />
      ) : (
        <PageNav
          page={page}
          count={pageCount}
          onGo={goPage}
          readOnly={readOnly}
          canSplit={canSplit}
          canDelete
          clears={Math.min(page, body.pages.length - 1) === 0}
          onNew={() => newPage()}
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
          sizes={book}
          onKind={setKind}
          onSize={setSize}
          onBold={() => current && patch(current.id, { bold: !current.bold }, true)}
          onItalic={() => current && patch(current.id, { italic: !current.italic }, true)}
          onImages={(files) => void uploadImages(files, focused)}
          clears={currentPage === 0}
          onDeletePage={deletePage}
        />
      )}
    </div>
  );
}

/** Step 2.13: the book's page navigator: ← 3–4 / 12 → and "+" (a page, a spread, delete the page). */
function BookNav({
  first,
  per,
  count,
  onGo,
  readOnly,
  clears,
  onNewPage,
  onNewSpread,
  onDelete,
}: {
  first: number;
  per: number;
  count: number;
  onGo: (i: number) => void;
  readOnly: boolean;
  clears: boolean;
  onNewPage: () => void;
  onNewSpread: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const pop = usePopover();
  const last = Math.min(count, first + per);
  return (
    <div
      className={cx(
        "vn2-pagenav pointer-events-auto absolute right-3 z-20 flex items-center gap-0.5 rounded-full p-1",
        readOnly ? "bottom-[max(env(safe-area-inset-bottom),14px)]" : "vn2-pagenav-raised",
      )}
      data-testid="notes-page-nav"
      data-book
    >
      <button type="button" onClick={() => onGo(first - per)} disabled={first <= 0} aria-label={t("notes.page.prev")} className="vn2-icon-btn size-9" data-testid="notes-page-prev">
        <RiArrowLeftSLine className="size-5" />
      </button>
      <span className="min-w-[52px] text-center text-[13.5px] font-medium tabular-nums text-text" data-testid="notes-page-indicator" aria-live="polite">
        {last - first > 1 ? `${first + 1}–${last}` : first + 1} / {count}
      </span>
      <button type="button" onClick={() => onGo(first + per)} disabled={first + per >= count} aria-label={t("notes.page.next")} className="vn2-icon-btn size-9" data-testid="notes-page-next">
        <RiArrowRightSLine className="size-5" />
      </button>
      {!readOnly && (
        <>
          <button ref={pop.anchor} type="button" onClick={pop.toggle} aria-label={t("notes.book.addPage")} title={t("notes.book.addPage")} className="vn2-icon-btn size-9" data-testid="notes-page-add">
            <RiAddLine className="size-5" />
          </button>
          <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={230} testId="notes-page-menu">
            <Menu
              onDone={pop.close}
              items={[
                {
                  id: "page-new",
                  label: t("notes.book.addPage"),
                  icon: <RiAddLine className="size-[18px]" />,
                  onSelect: onNewPage,
                },
                {
                  id: "spread-new",
                  label: t("notes.book.addSpread"),
                  icon: <RiBookOpenLine className="size-[18px]" />,
                  onSelect: onNewSpread,
                },
                {
                  id: "page-delete",
                  label: clears ? t("notes.page.clear") : t("notes.page.delete"),
                  icon: clears ? <RiEraserLine className="size-[18px]" /> : <RiDeleteBinLine className="size-[18px]" />,
                  onSelect: onDelete,
                  danger: true,
                  divider: true,
                },
              ]}
            />
          </Popover>
        </>
      )}
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
 * cursor is in), text size (books), list, checklist, picture, bold, italic,
 * and delete page. On phones it rides on top of the keyboard (visual
 * viewport), never under it, and scrolls sideways when it doesn't fit.
 */
function Toolbar({
  above,
  current,
  uploading,
  sizes,
  onKind,
  onSize,
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
  /** Books offer text sizes. */
  sizes: boolean;
  onKind: (k: NoteBlockKind) => void;
  onSize: (size: number | null) => void;
  onBold: () => void;
  onItalic: () => void;
  onImages: (files: File[]) => void;
  /** The first page is cleared, not deleted. */
  clears: boolean;
  onDeletePage: () => void;
}) {
  const t = useT();
  const pop = usePopover();
  const sizePop = usePopover();
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
        {sizes && (
          <button
            ref={sizePop.anchor}
            type="button"
            onClick={sizePop.toggle}
            aria-label={t("notes.tool.size")}
            aria-haspopup="menu"
            title={t("notes.tool.size")}
            className={cx("vn2-icon-btn h-11 shrink-0 grid-flow-col gap-0.5 px-2", current?.size && "text-primary")}
            data-testid="notes-tool-size"
            data-size={current?.size}
          >
            <RiFontSize className="size-[19px]" />
            <span className="text-[12.5px] font-semibold tabular-nums">{current?.size ?? ""}</span>
          </button>
        )}
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
        {sizes && (
          <Popover open={sizePop.open} onClose={sizePop.close} anchor={sizePop.anchor} width={200} testId="notes-size-menu">
            <Menu
              onDone={sizePop.close}
              items={[
                {
                  id: "size-default",
                  label: t("notes.size.default"),
                  checked: !current?.size,
                  onSelect: () => onSize(null),
                },
                ...BOOK_FONT_SIZES.map((n, i) => ({
                  id: `size-${n}`,
                  label: `${n}`,
                  checked: current?.size === n,
                  onSelect: () => onSize(n),
                  divider: i === 0,
                })),
              ]}
            />
          </Popover>
        )}
      </div>
    </div>
  );
}

/** A picture: tap to select (the tools open above the toolbar), drag the corner to resize. */
function ImageBlock({
  b,
  row,
  selected,
  readOnly,
  onSelect,
  onPatch,
}: {
  b: NoteBlock;
  /** Set when it stands in a row of pictures. */
  row?: { pos: "first" | "mid" | "last" };
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onPatch: (p: Partial<NoteBlock>, structural?: boolean) => void;
}) {
  const t = useT();
  const url = useMediaUrl(b.src);
  const box = useRef<HTMLDivElement>(null);
  const width = b.width ?? 100;
  const align = b.align ?? "center";
  const wrap = !row && !!b.wrap && align !== "center";
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number; box: number } | null>(null);
  const shown = live ?? width;
  const startResize = (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // A wrapped picture is sized against the page, not against its own box.
    const host = wrap || row ? (box.current?.parentElement?.clientWidth ?? 600) : (box.current?.clientWidth ?? 600);
    drag.current = { x: e.clientX, w: width, box: host };
  };
  const moveResize = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = row ? 1 : align === "center" ? 2 : align === "right" ? -1 : 1;
    setLive(Math.round(Math.max(10, Math.min(100, d.w + (((e.clientX - d.x) * k) / d.box) * 100))));
  };
  const endResize = () => {
    if (drag.current && live !== null) onPatch({ width: live }, true);
    drag.current = null;
    setLive(null);
  };
  const outerStyle = row ? { flex: `${shown} 1 0%` } : wrap ? { width: `${shown}%` } : undefined;
  return (
    <div
      ref={box}
      className={cx("vn2-img", row ? "vn2-img-in-row" : `vn2-img-${align}`, wrap && `vn2-img-wrap vn2-img-wrap-${align}`)}
      style={outerStyle}
      data-block={b.id}
      data-kind="image"
      data-testid="notes-image-block"
      data-width={shown}
      data-align={align}
      data-wrap={wrap || undefined}
      data-row={b.row}
    >
      <div className="relative" style={{ width: row || wrap ? "100%" : `${shown}%` }}>
        {url ? (
          <img
            src={url}
            alt={b.text}
            draggable={false}
            loading="lazy"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className={cx("block w-full rounded-[10px]", selected && !readOnly && "outline outline-[3px] outline-offset-2 outline-primary")}
            data-testid="notes-image"
          />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-[10px] bg-surface-secondary">
            <Spinner />
          </div>
        )}
        {selected && !readOnly && (
          <>
            <span
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              className={cx(
                "absolute bottom-[-10px] grid size-7 touch-none place-items-center rounded-full border-2 border-white bg-primary shadow",
                align === "right" && !row ? "left-[-10px] cursor-nesw-resize" : "right-[-10px] cursor-nwse-resize",
              )}
              aria-label={t("notes.image.resize")}
              data-testid="notes-image-resize"
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The selected picture's tools (Step 2.13: a bar above the toolbar, so they
 * never cover the text beside a picture): width 25/50/75/100 %, alignment,
 * text flowing around it (left / right), beside the picture before it (a
 * row) or back on a line of its own, move (inside a row: left / right),
 * remove.
 */
function ImageTools({
  b,
  row,
  canJoin,
  onPatch,
  onMove,
  onRow,
  onRemove,
}: {
  b: NoteBlock;
  row: boolean;
  canJoin: boolean;
  onPatch: (p: Partial<NoteBlock>, structural?: boolean) => void;
  onMove: (d: -1 | 1) => void;
  onRow: (join: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const width = b.width ?? 100;
  const align = b.align ?? "center";
  const wrap = !row && !!b.wrap && align !== "center";
  return (
    <div
      className="vn2-img-tools pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-[22px] p-1"
      onPointerDown={(e) => e.preventDefault()}
      data-testid="notes-image-tools"
      data-image={b.id}
    >
      {[25, 50, 75, 100].map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onPatch({ width: w }, true)}
          className={cx("h-8 rounded-full px-2 text-[12.5px] font-semibold", width === w ? "bg-primary text-white" : "text-text")}
          data-testid={`notes-image-w${w}`}
        >
          {w === 100 && !row ? t("notes.image.full") : `${w}%`}
        </button>
      ))}
      {!row && (
        <>
          <span className="mx-0.5 h-5 w-px bg-border" />
          {(
            [
              ["left", <RiAlignLeft key="l" className="size-[17px]" />],
              ["center", <RiAlignCenter key="c" className="size-[17px]" />],
              ["right", <RiAlignRight key="r" className="size-[17px]" />],
            ] as const
          ).map(([a, icon]) => (
            <button
              key={a}
              type="button"
              onClick={() => onPatch({ align: a, ...(a === "center" ? { wrap: undefined } : {}) }, true)}
              aria-label={t(`notes.image.${a}`)}
              aria-pressed={align === a}
              className={cx("vn2-icon-btn size-8", align === a && "text-primary")}
              data-testid={`notes-image-${a}`}
            >
              {icon}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              onPatch(
                align === "center"
                  ? { wrap: true, align: "left", width: Math.min(width, 50) }
                  : {
                      wrap: !b.wrap,
                      ...(!b.wrap && width > 60 ? { width: 50 } : {}),
                    },
                true,
              )
            }
            aria-label={t("notes.image.wrap")}
            title={t("notes.image.wrap")}
            aria-pressed={wrap}
            className={cx("vn2-icon-btn size-8", wrap && "text-primary")}
            data-testid="notes-image-wrap"
          >
            <RiTextWrap className="size-[17px]" />
          </button>
        </>
      )}
      <span className="mx-0.5 h-5 w-px bg-border" />
      {canJoin && (
        <button type="button" onClick={() => onRow(true)} aria-label={t("notes.image.beside")} title={t("notes.image.beside")} className="vn2-icon-btn size-8" data-testid="notes-image-join">
          <RiLayoutColumnLine className="size-[17px]" />
        </button>
      )}
      {row && (
        <button type="button" onClick={() => onRow(false)} aria-label={t("notes.image.ownLine")} title={t("notes.image.ownLine")} className="vn2-icon-btn size-8" data-testid="notes-image-leave">
          <RiLayoutRowLine className="size-[17px]" />
        </button>
      )}
      <button type="button" onClick={() => onMove(-1)} aria-label={row ? t("notes.image.moveLeft") : t("notes.moveUp")} className="vn2-icon-btn size-8" data-testid="notes-image-up">
        {row ? <RiArrowLeftLine className="size-[17px]" /> : <RiArrowUpLine className="size-[17px]" />}
      </button>
      <button type="button" onClick={() => onMove(1)} aria-label={row ? t("notes.image.moveRight") : t("notes.moveDown")} className="vn2-icon-btn size-8" data-testid="notes-image-down">
        {row ? <RiArrowRightLine className="size-[17px]" /> : <RiArrowDownLine className="size-[17px]" />}
      </button>
      <button type="button" onClick={onRemove} aria-label={t("notes.delete")} className="vn2-icon-btn size-8 text-danger" data-testid="notes-image-remove">
        <RiDeleteBinLine className="size-[17px]" />
      </button>
    </div>
  );
}
