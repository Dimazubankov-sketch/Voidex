import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import {
  RiAddLine,
  RiAlignCenter,
  RiAlignLeft,
  RiAlignRight,
  RiArrowDownLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiBold,
  RiCheckboxLine,
  RiDeleteBinLine,
  RiFontSize,
  RiImageAddLine,
  RiItalic,
  RiListUnordered,
  RiScissorsCutLine,
} from "@remixicon/react";
import type { NoteBlock, NoteBlockKind, NoteBody } from "@voidex/shared";
import { addPage, block, removePage, splitAt } from "@voidex/notes";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { Popover, toast, usePopover } from "@/ui/overlays";
import { downscale, notesApi, useMediaUrl } from "./data";
import { Menu } from "./kit";

type Change = (next: NoteBody, structural?: boolean) => void;

const TEXT_KINDS: { kind: NoteBlockKind; key: MessageKey }[] = [
  { kind: "text", key: "notes.block.text" },
  { kind: "heading", key: "notes.block.heading" },
  { kind: "subheading", key: "notes.block.subheading" },
  { kind: "quote", key: "notes.block.quote" },
  { kind: "code", key: "notes.block.code" },
];
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

function mapBlocks(n: NoteBody, fn: (b: NoteBlock) => NoteBlock): NoteBody {
  return { ...n, pages: n.pages.map((p) => ({ ...p, blocks: p.blocks.map(fn) })) };
}

function locate(n: NoteBody, id: string): { page: number; index: number } | null {
  for (let p = 0; p < n.pages.length; p++) {
    const i = n.pages[p]!.blocks.findIndex((b) => b.id === id);
    if (i >= 0) return { page: p, index: i };
  }
  return null;
}

function withPage(n: NoteBody, page: number, fn: (blocks: NoteBlock[]) => NoteBlock[]): NoteBody {
  return { ...n, pages: n.pages.map((p, i) => (i === page ? { ...p, blocks: fn([...p.blocks]) } : p)) };
}

const allBlocks = (n: NoteBody) => n.pages.flatMap((p) => p.blocks);

/**
 * The note editor (Step 2.6): clean paper — no block frames, no grid — with a
 * small toolbar. Vertical: a portrait sheet that grows as you write (one
 * page = unlimited length), pages stacked downwards. Square: square pages
 * running sideways (the wheel scrolls them), text flowing on to the next
 * page by itself. Pages: "+ Новая страница" and "Разделить здесь" in the
 * page navigator (‹ 2 / 6 ›); there is no page-break button.
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
  const [pageCount, setPageCount] = useState(body.pages.length);
  const [side, setSide] = useState(600);
  const square = body.format === "square";
  const bodyRef = useRef(body);
  bodyRef.current = body;

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
    if (!el) return;
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
      const next = block(kind, after);
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
      const anchor = afterId ?? focused ?? n.pages[Math.min(page, n.pages.length - 1)]!.blocks.at(-1)?.id ?? null;
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
    const j = at.index + delta;
    if (j >= 0 && j < list.length) {
      onChange(
        withPage(n, at.page, (l) => {
          const [x] = l.splice(at.index, 1);
          l.splice(j, 0, x!);
          return l;
        }),
        true,
      );
      return;
    }
    // Over the page edge: onto the neighbouring page.
    const p2 = at.page + delta;
    if (p2 < 0 || p2 >= n.pages.length) return;
    const moved = list[at.index]!;
    const without = withPage(n, at.page, (l) => l.filter((x) => x.id !== id));
    onChange(withPage(without, p2, (l) => (delta < 0 ? [...l, moved] : [moved, ...l])), true);
  };

  const removeBlock = (id: string) => {
    const n = bodyRef.current;
    const at = locate(n, id);
    if (!at) return;
    onChange(
      withPage(n, at.page, (l) => {
        const out = l.filter((x) => x.id !== id);
        return out.length ? out : [block()];
      }),
      true,
    );
    setSelectedImage(null);
  };

  // ------------------------------------------------------------ pages
  const newPage = () => {
    const at = focused ? locate(bodyRef.current, focused) : null;
    const { note, page: p } = addPage(bodyRef.current, at?.page ?? bodyRef.current.pages.length - 1);
    onChange(note, true);
    pendingFocus.current = { id: p.blocks[0]!.id, pos: 0 };
    requestAnimationFrame(() => goPage(note.pages.findIndex((x) => x.id === p.id)));
  };
  const canSplit = !!focused && (locate(body, focused)?.index ?? 0) > 0;
  const splitHere = () => {
    if (!focused) return;
    onChange(splitAt(bodyRef.current, focused), true);
    pendingFocus.current = { id: focused, pos: 0 };
  };
  const deletePage = () => {
    const at = Math.min(page, body.pages.length - 1);
    onChange(removePage(bodyRef.current, at), true);
  };

  // ------------------------------------------------------------ focused block style
  const current = focused ? allBlocks(body).find((b) => b.id === focused) : undefined;
  const setKind = (kind: NoteBlockKind) => {
    if (!current) return;
    patch(current.id, { kind: current.kind === kind && kind !== "text" ? "text" : kind }, true);
    pendingFocus.current = { id: current.id, pos: -1 };
  };

  const placeholder = t("notes.placeholder");
  const firstId = body.pages[0]?.blocks[0]?.id;
  const empty = allBlocks(body).every((b) => b.kind !== "image" && !b.text);

  const renderBlock = (b: NoteBlock) =>
    b.kind === "image" ? (
      <ImageBlock
        key={b.id}
        b={b}
        selected={selectedImage === b.id}
        readOnly={readOnly}
        onSelect={() => setSelectedImage(b.id)}
        onPatch={(p, structural) => patch(b.id, p, structural)}
        onMove={(d) => moveBlock(b.id, d)}
        onRemove={() => removeBlock(b.id)}
      />
    ) : (
      <div key={b.id} className={cx("vn2-b", `vn2-b-${b.kind}`, b.bold && "vn2-bold", b.italic && "vn2-italic", b.checked && "vn2-done")} data-block={b.id} data-kind={b.kind}>
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
          if (!(e.target as HTMLElement).closest(".vn2-img")) setSelectedImage(null);
        }}
        className={cx("vn2-scroll min-h-0 flex-1", square ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto overflow-x-hidden")}
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
                <div key={p.id} className="vn2-page-col" style={i > 0 ? { breakBefore: "column" } : undefined} data-page={i}>
                  {p.blocks.map(renderBlock)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-0 pb-40 pt-16 sm:px-6 sm:pt-[72px]">
            {body.pages.map((p, i) => (
              <div key={p.id} className={cx("vn2-sheet", paged && "vn2-sheet-paged")} data-page={i} data-testid="notes-paper">
                {p.blocks.map(renderBlock)}
                {!readOnly && (
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    className="block h-16 w-full cursor-text"
                    onClick={() => {
                      const last = p.blocks.at(-1);
                      if (last && last.kind !== "image" && !last.text) focusBlock(last.id, 0);
                      else if (last) {
                        const nb = block();
                        insertAfter(last.id, [nb], { id: nb.id, pos: 0 });
                      }
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <PageNav
        page={page}
        count={pageCount}
        onGo={goPage}
        readOnly={readOnly}
        canSplit={canSplit}
        canDelete={body.pages.length > 1}
        onNew={newPage}
        onSplit={splitHere}
        onDelete={deletePage}
        raised={!readOnly}
        compact={!square}
      />

      {!readOnly && (
        <Toolbar
          current={current}
          uploading={uploading > 0}
          onKind={setKind}
          onBold={() => current && patch(current.id, { bold: !current.bold }, true)}
          onItalic={() => current && patch(current.id, { italic: !current.italic }, true)}
          onImages={(files) => void uploadImages(files, focused)}
        />
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
          ...(canDelete ? [{ id: "page-delete", label: t("notes.page.delete"), icon: <RiDeleteBinLine className="size-[18px]" />, onSelect: onDelete, danger: true, divider: true }] : []),
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
 * The minimal toolbar: text style, list, checklist, picture, bold, italic.
 * On phones it rides on top of the keyboard (visual viewport), never under it.
 */
function Toolbar({
  current,
  uploading,
  onKind,
  onBold,
  onItalic,
  onImages,
}: {
  current?: NoteBlock;
  uploading: boolean;
  onKind: (k: NoteBlockKind) => void;
  onBold: () => void;
  onItalic: () => void;
  onImages: (files: File[]) => void;
}) {
  const t = useT();
  const ff = useFormFactor();
  const style = useKeyboardInset(ff === "mobile");
  const pop = usePopover();
  const file = useRef<HTMLInputElement>(null);
  // Keep the text focused when a toolbar button is pressed.
  const keep = (e: RPointerEvent) => e.preventDefault();
  return (
    <div className="vn2-toolbar-wrap pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3" style={style} data-testid="notes-toolbar">
      <div className="vn2-toolbar pointer-events-auto flex items-center gap-0.5 rounded-full p-1" onPointerDown={keep}>
        <button ref={pop.anchor} type="button" onClick={pop.toggle} aria-label={t("notes.tool.style")} title={t("notes.tool.style")} className={cx("vn2-icon-btn size-11", current && current.kind !== "text" && "text-primary")} data-testid="notes-tool-style">
          <RiFontSize className="size-[21px]" />
        </button>
        <button type="button" onClick={() => onKind("bullet")} aria-label={t("notes.block.bullet")} title={t("notes.block.bullet")} aria-pressed={current?.kind === "bullet"} className={cx("vn2-icon-btn size-11", current?.kind === "bullet" && "text-primary")} data-testid="notes-tool-bullet">
          <RiListUnordered className="size-[21px]" />
        </button>
        <button type="button" onClick={() => onKind("checklist")} aria-label={t("notes.block.checklist")} title={t("notes.block.checklist")} aria-pressed={current?.kind === "checklist"} className={cx("vn2-icon-btn size-11", current?.kind === "checklist" && "text-primary")} data-testid="notes-tool-checklist">
          <RiCheckboxLine className="size-[21px]" />
        </button>
        <button type="button" onClick={() => file.current?.click()} aria-label={t("notes.tool.image")} title={t("notes.tool.image")} className="vn2-icon-btn size-11" data-testid="notes-tool-image">
          {uploading ? <Spinner size={18} /> : <RiImageAddLine className="size-[21px]" />}
        </button>
        <span className="mx-0.5 h-6 w-px bg-border" />
        <button type="button" onClick={onBold} aria-label={t("notes.tool.bold")} title={t("notes.tool.bold")} aria-pressed={!!current?.bold} className={cx("vn2-icon-btn size-11", current?.bold && "text-primary")} data-testid="notes-tool-bold">
          <RiBold className="size-[20px]" />
        </button>
        <button type="button" onClick={onItalic} aria-label={t("notes.tool.italic")} title={t("notes.tool.italic")} aria-pressed={!!current?.italic} className={cx("vn2-icon-btn size-11", current?.italic && "text-primary")} data-testid="notes-tool-italic">
          <RiItalic className="size-[20px]" />
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
        <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={220} testId="notes-style-menu">
          <Menu onDone={pop.close} items={TEXT_KINDS.map((k) => ({ id: `style-${k.kind}`, label: t(k.key), checked: (current?.kind ?? "text") === k.kind, onSelect: () => onKind(k.kind) }))} />
        </Popover>
      </div>
    </div>
  );
}

/** Bottom offset that keeps a bar above the on-screen keyboard. */
export function useKeyboardInset(on: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [on]);
  return { paddingBottom: inset > 40 ? inset + 8 : "max(env(safe-area-inset-bottom), 14px)" };
}

/** A picture: tap to select, then width (drag the corner or 25/50/75/100%), alignment, move, remove. */
function ImageBlock({
  b,
  selected,
  readOnly,
  onSelect,
  onPatch,
  onMove,
  onRemove,
}: {
  b: NoteBlock;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onPatch: (p: Partial<NoteBlock>, structural?: boolean) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const url = useMediaUrl(b.src);
  const box = useRef<HTMLDivElement>(null);
  const width = b.width ?? 100;
  const align = b.align ?? "center";
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number; box: number } | null>(null);
  const shown = live ?? width;
  const startResize = (e: RPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, box: box.current?.clientWidth ?? 600 };
  };
  const moveResize = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = align === "center" ? 2 : align === "right" ? -1 : 1;
    setLive(Math.round(Math.max(10, Math.min(100, d.w + (((e.clientX - d.x) * k) / d.box) * 100))));
  };
  const endResize = () => {
    if (drag.current && live !== null) onPatch({ width: live }, true);
    drag.current = null;
    setLive(null);
  };
  return (
    <div ref={box} className={cx("vn2-img", `vn2-img-${align}`)} data-block={b.id} data-kind="image" data-testid="notes-image-block" data-width={shown} data-align={align}>
      <div className="relative" style={{ width: `${shown}%` }}>
        {url ? (
          <img
            src={url}
            alt={b.text}
            draggable={false}
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
              className={cx("absolute bottom-[-10px] grid size-7 touch-none place-items-center rounded-full border-2 border-white bg-primary shadow", align === "right" ? "left-[-10px] cursor-nesw-resize" : "right-[-10px] cursor-nwse-resize")}
              aria-label={t("notes.image.resize")}
              data-testid="notes-image-resize"
            />
            <div className="vn2-img-tools absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1" onPointerDown={(e) => e.stopPropagation()} data-testid="notes-image-tools">
              {[25, 50, 75, 100].map((w) => (
                <button key={w} type="button" onClick={() => onPatch({ width: w }, true)} className={cx("h-8 rounded-full px-2 text-[12.5px] font-semibold", width === w ? "bg-primary text-white" : "text-text")} data-testid={`notes-image-w${w}`}>
                  {w === 100 ? t("notes.image.full") : `${w}%`}
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-border" />
              {(
                [
                  ["left", <RiAlignLeft key="l" className="size-[17px]" />],
                  ["center", <RiAlignCenter key="c" className="size-[17px]" />],
                  ["right", <RiAlignRight key="r" className="size-[17px]" />],
                ] as const
              ).map(([a, icon]) => (
                <button key={a} type="button" onClick={() => onPatch({ align: a }, true)} aria-label={t(`notes.image.${a}`)} className={cx("vn2-icon-btn size-8", align === a && "text-primary")} data-testid={`notes-image-${a}`}>
                  {icon}
                </button>
              ))}
              <span className="mx-0.5 h-5 w-px bg-border" />
              <button type="button" onClick={() => onMove(-1)} aria-label={t("notes.moveUp")} className="vn2-icon-btn size-8" data-testid="notes-image-up">
                <RiArrowUpLine className="size-[17px]" />
              </button>
              <button type="button" onClick={() => onMove(1)} aria-label={t("notes.moveDown")} className="vn2-icon-btn size-8" data-testid="notes-image-down">
                <RiArrowDownLine className="size-[17px]" />
              </button>
              <button type="button" onClick={onRemove} aria-label={t("notes.delete")} className="vn2-icon-btn size-8 text-danger" data-testid="notes-image-remove">
                <RiDeleteBinLine className="size-[17px]" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
