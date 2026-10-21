/**
 * Voidex Notes — document logic (Step 2.6). Pure functions over the stored
 * shapes (see @voidex/shared notes.ts): pages of a note, Note → Presentation,
 * reflowing slides between formats. No React, no DOM: tested with node.
 */
import type { BookBody, NoteBlock, NoteBody, NoteImageShape, NotePage, PresentationBody, Slide, SlideFormat, SlideLayer } from "@voidex/shared";

/** A note or a book: pages of blocks (Step 2.13: the page functions serve both). */
export type PagedBody = NoteBody | BookBody;


export const newId = () => globalThis.crypto.randomUUID();

export function block(kind: NoteBlock["kind"] = "text", text = ""): NoteBlock {
  return { id: newId(), kind, text };
}

// ---------------------------------------------------------------- pages

/** A note with one page is continuous; with several it is paged. */
export const isPaged = (n: PagedBody) => n.pages.length > 1;


/** Splits the page that holds `blockId` so that block starts a new page ("Разделить здесь"). */
export function splitAt<T extends PagedBody>(n: T, blockId: string): T {
  const pages: NotePage[] = [];
  for (const p of n.pages) {
    const i = p.blocks.findIndex((b) => b.id === blockId);
    if (i <= 0) {
      pages.push(p);
      continue;
    }
    pages.push({ id: p.id, blocks: p.blocks.slice(0, i) }, { id: newId(), blocks: p.blocks.slice(i) });
  }
  return { ...n, pages };
}

/** Adds an empty page after page `index` (or at the end). */
export function addPage<T extends PagedBody>(n: T, index = n.pages.length - 1): { note: T; page: NotePage } {
  const page: NotePage = { id: newId(), blocks: [block()] };
  const pages = [...n.pages];
  pages.splice(index + 1, 0, page);
  return { note: { ...n, pages }, page };
}


export function mergePages<T extends PagedBody>(n: T): T {
  if (n.pages.length <= 1) return n;
  return { ...n, pages: [{ id: n.pages[0]!.id, blocks: n.pages.flatMap((p) => p.blocks) }] };
}

/** Removes a page; its blocks move to the previous page (never lost). */
export function removePage<T extends PagedBody>(n: T, index: number): T {
  if (n.pages.length <= 1 || index < 0 || index >= n.pages.length) return n;
  const pages = n.pages.map((p) => ({ ...p, blocks: [...p.blocks] }));
  const [gone] = pages.splice(index, 1);
  const target = pages[Math.max(0, index - 1)]!;
  const keep = gone!.blocks.filter((b) => b.text.trim() || b.kind === "image");
  if (index === 0) target.blocks.unshift(...keep);
  else target.blocks.push(...keep);
  return { ...n, pages };
}

/** True when a page holds anything (text or a picture). */
export function pageHasContent(n: PagedBody, index: number): boolean {
  return !!n.pages[index]?.blocks.some((b) => b.kind === "image" || b.text.trim());
}

/**
 * The page menu's "delete" (Step 2.7). A page after the first is deleted with
 * its content; the result says which page to show next (the one before it).
 * The first page is never deleted: it is cleared instead (whether it is the
 * only page or others follow), so a note always starts with a page.
 */
export function deleteOrClearPage<T extends PagedBody>(n: T, index: number): { note: T; show: number; cleared: boolean } {
  if (index < 0 || index >= n.pages.length) return { note: n, show: 0, cleared: false };
  if (index === 0) {
    const pages = n.pages.map((p, i) => (i === 0 ? { ...p, blocks: [block()] } : p));
    return { note: { ...n, pages }, show: 0, cleared: true };
  }
  const pages = n.pages.filter((_, i) => i !== index);
  return { note: { ...n, pages }, show: index - 1, cleared: false };
}

/** Switching vertical ↔ square keeps everything: content reflows, pages stay logical pages. */
export function setNoteFormat(n: NoteBody, format: NoteBody["format"]): NoteBody {
  return { ...n, format };
}

// ---------------------------------------------------------------- Note → Presentation

const TITLE_KINDS = new Set(["heading", "subheading"]);
/** Text that still fits a slide comfortably (characters of body text). */
const SLIDE_TEXT_BUDGET = 420;

function bulletLine(b: NoteBlock): string {
  if (b.kind === "bullet") return `• ${b.text}`;
  if (b.kind === "checklist") return `${b.checked ? "☑" : "☐"} ${b.text}`;
  if (b.kind === "quote") return `«${b.text}»`;
  return b.text;
}

/** Lays out one slide: title on top, text and pictures below (in % of the slide). */
function layoutSlide(title: string, texts: string[], images: NoteBlock[]): Slide {
  const layers: SlideLayer[] = [];
  let top = 8;
  if (title) {
    layers.push({ id: newId(), kind: "title", text: title, x: 7, y: top, w: 86, h: 16, align: "left" });
    top += 20;
  }
  const body = texts.filter((t) => t.trim()).join("\n");
  const hasImage = images.length > 0;
  if (body) layers.push({ id: newId(), kind: "text", text: body, x: 7, y: top, w: hasImage ? 46 : 86, h: 92 - top, align: "left" });
  images.slice(0, 2).forEach((img, i) => {
    const x = body ? 57 : 7 + i * 44;
    const w = body ? 36 : images.length > 1 ? 40 : 86;
    layers.push({ id: newId(), kind: "image", text: img.text, src: img.src, x, y: top + (body ? i * 34 : 0), w, h: body ? (images.length > 1 ? 30 : 60) : 92 - top });
  });
  if (!layers.length) layers.push({ id: newId(), kind: "title", text: "", x: 7, y: 40, w: 86, h: 16, align: "center" });
  return { id: newId(), transition: "fade", layers };
}

/**
 * Turns a note into a first-draft presentation (the note itself is not
 * touched): headings start slides and become their titles, paragraphs and
 * lists become the slide text, pictures become slide pictures, page breaks
 * start slides; long stretches without headings are cut into readable slides.
 */
export function noteToPresentation(n: NoteBody, title = "", format: SlideFormat = "rect"): PresentationBody {
  const slides: Slide[] = [];
  if (title.trim()) slides.push(layoutSlide(title.trim(), [], []));
  for (const page of n.pages) {
    let heading = "";
    let texts: string[] = [];
    let images: NoteBlock[] = [];
    let size = 0;
    const flush = () => {
      if (heading || texts.some((t) => t.trim()) || images.length) slides.push(layoutSlide(heading, texts, images));
      heading = "";
      texts = [];
      images = [];
      size = 0;
    };
    for (const b of page.blocks) {
      if (TITLE_KINDS.has(b.kind)) {
        flush();
        heading = b.text.trim();
        continue;
      }
      if (b.kind === "image") {
        if (!b.src) continue;
        if (images.length >= 2) flush();
        images.push(b);
        continue;
      }
      const line = bulletLine(b);
      if (!line.trim()) continue;
      if (size + line.length > SLIDE_TEXT_BUDGET && (texts.length || images.length)) {
        const keep = heading;
        flush();
        heading = keep ? `${keep} (продолжение)` : "";
      }
      texts.push(line);
      size += line.length;
    }
    flush(); // a page break always ends a slide
  }
  if (!slides.length) slides.push(layoutSlide(title.trim(), [], []));
  return { kind: "presentation", format, slides };
}

// ---------------------------------------------------------------- slide formats

/** Width / height of a slide format. */
export const slideRatio = (f: SlideFormat) => (f === "square" ? 1 : 16 / 9);

/**
 * Square ↔ widescreen: layers keep their logical place (positions are in %),
 * text boxes get the height they need at the new proportions, pictures keep
 * their own proportions, and nothing ends up outside the slide.
 */
export function reflowPresentation(p: PresentationBody, format: SlideFormat): PresentationBody {
  if (p.format === format) return p;
  const k = slideRatio(p.format) / slideRatio(format); // >1: the slide gets taller relative to its width
  return {
    ...p,
    format,
    slides: p.slides.map((s) => ({
      ...s,
      layers: s.layers.map((l) => {
        if (l.kind === "image") {
          // Same picture proportions: scale the height with the slide proportions.
          const h = Math.min(100 - l.y, l.h / k);
          return { ...l, h: Math.max(4, h) };
        }
        // Text keeps its box (it rewraps inside it); the editor warns when it no longer fits.
        const y = Math.min(l.y, 96);
        const h = Math.min(l.h, 100 - y);
        return { ...l, y, h: Math.max(4, h) };
      }),
    })),
  };
}


/**
 * Rough check that a text layer's words fit its box (characters per line
 * from the box width, lines from its height) — used to warn, never to cut.
 * The editor measures real text too; this keeps the warning testable.
 */
export function textFits(l: SlideLayer, format: SlideFormat | number): boolean {
  if (l.kind === "image") return true;
  const ratio = typeof format === "number" ? format : slideRatio(format);
  const base = l.kind === "title" ? 5.2 : 3.2; // font size in % of the slide height
  const font = base * (l.scale ?? 1);
  const charsPerLine = Math.max(1, Math.floor((l.w * ratio) / (font * 0.55)));
  const lines = l.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * font * 1.3 <= l.h + 0.5;
}

export function slideOverflows(s: Slide, format: SlideFormat | number): boolean {
  return s.layers.some((l) => !l.hidden && (l.y + l.h > 101 || l.x + l.w > 101 || !textFits(l, format)));
}

// ---------------------------------------------------------------- image rows (Step 2.13)

/** A run of blocks as laid out: a single block, or images standing side by side in one row. */
export type LaidOut = { kind: "block"; block: NoteBlock } | { kind: "row"; id: string; blocks: NoteBlock[] };

/** Neighbouring images with the same row id form a row; anything else stands on its own. */
export function layoutBlocks(blocks: NoteBlock[]): LaidOut[] {
  const out: LaidOut[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (b.kind === "image" && b.row && last) {
      if (last.kind === "row" && last.id === b.row) {
        last.blocks.push(b);
        continue;
      }
      if (last.kind === "block" && last.block.kind === "image" && last.block.row === b.row) {
        out[out.length - 1] = { kind: "row", id: b.row, blocks: [last.block, b] };
        continue;
      }
    }
    out.push({ kind: "block", block: b });
  }
  return out;
}

/** The indexes [from, to] of the row a block stands in (itself when it is alone). */
export function rowExtent(blocks: NoteBlock[], index: number): [number, number] {
  const row = blocks[index]?.row;
  if (!row || blocks[index]!.kind !== "image") return [index, index];
  let a = index;
  let z = index;
  while (a > 0 && blocks[a - 1]!.kind === "image" && blocks[a - 1]!.row === row) a--;
  while (z < blocks.length - 1 && blocks[z + 1]!.kind === "image" && blocks[z + 1]!.row === row) z++;
  return [a, z];
}

/** Step 2.16: the shape a row of pictures starts with. */
export const DEFAULT_ROW_SHAPE: NoteImageShape = "square";

/**
 * Puts the image at `index` beside the image before it (joining that one's
 * row, or starting one). Step 2.16: the row's first picture decides its size
 * and shape; the one that joins takes them on.
 */
export function joinRow(blocks: NoteBlock[], index: number, rowId: string): NoteBlock[] {
  const prev = blocks[index - 1];
  const b = blocks[index];
  if (!prev || !b || prev.kind !== "image" || b.kind !== "image") return blocks;
  const id = prev.row ?? rowId;
  const [a] = prev.row ? rowExtent(blocks, index - 1) : [index - 1];
  const first = blocks[a]!;
  const look = { width: first.width ?? 100, shape: first.shape ?? DEFAULT_ROW_SHAPE };
  return blocks.map((x, i) => (i === index - 1 || i === index || (i >= a && i < index && x.row === id) ? { ...x, row: id, wrap: undefined, align: undefined, ...look } : x));
}

/**
 * Step 2.16: the size (width of the whole row, % of the line) or the shape of
 * a row of pictures: every picture of the row takes it, so they always stand
 * at one height, side by side, never over one another. A picture on its own
 * just takes it itself.
 */
export function setRowLook(blocks: NoteBlock[], index: number, look: { width?: number; shape?: NoteImageShape }): NoteBlock[] {
  const [a, z] = rowExtent(blocks, index);
  const width = look.width === undefined ? undefined : Math.max(10, Math.min(100, Math.round(look.width)));
  return blocks.map((x, i) => (i >= a && i <= z ? { ...x, ...(width !== undefined ? { width } : {}), ...(look.shape ? { shape: look.shape } : {}) } : x));
}

/** Step 2.16: pictures added together stand in one row (the first one's size and the default shape). */
export function asRow(images: NoteBlock[], rowId: string): NoteBlock[] {
  if (images.length < 2) return images;
  const width = images[0]!.width ?? 100;
  return images.map((x) => ({ ...x, row: rowId, width, shape: x.shape ?? DEFAULT_ROW_SHAPE, align: undefined, wrap: undefined }));
}

/** Takes the image at `index` out of its row onto a line of its own (right after the row). */
export function leaveRow(blocks: NoteBlock[], index: number): NoteBlock[] {
  const b = blocks[index];
  if (!b?.row) return blocks;
  const [, z] = rowExtent(blocks, index);
  const list = blocks.map((x) => ({ ...x }));
  const [moved] = list.splice(index, 1);
  delete moved!.row;
  list.splice(z, 0, moved!);
  // A row left with a single image is no row any more.
  const rest = list.filter((x) => x.row === b.row);
  if (rest.length === 1) delete rest[0]!.row;
  return list;
}

/**
 * Moves a block one step (an image inside a row moves within it; at the row's
 * edge it steps out of the row; a block next to a row jumps over the whole row).
 * Returns null when it is already at the edge of the page.
 */
export function moveInPage(blocks: NoteBlock[], index: number, delta: -1 | 1): NoteBlock[] | null {
  const b = blocks[index];
  if (!b) return null;
  const list = blocks.map((x) => ({ ...x }));
  if (b.row) {
    const j = index + delta;
    if (list[j]?.kind === "image" && list[j]!.row === b.row) {
      [list[index], list[j]] = [list[j]!, list[index]!];
      return list;
    }
    return stepOut(blocks, index, delta);
  }
  const j = index + delta;
  if (j < 0 || j >= list.length) return null;
  const [a, z] = rowExtent(list, j);
  const [moved] = list.splice(index, 1);
  // Back: before the neighbour (or its whole row). Forward: after it (indexes past `index` shifted by one).
  list.splice(delta < 0 ? a : z, 0, moved!);
  return list;
}

function stepOut(blocks: NoteBlock[], index: number, delta: -1 | 1): NoteBlock[] {
  const [a, z] = rowExtent(blocks, index);
  const list = blocks.map((x) => ({ ...x }));
  const [moved] = list.splice(index, 1);
  const row = moved!.row;
  delete moved!.row;
  // Before the row when stepping back, after it when stepping forward.
  list.splice(delta < 0 ? a : z, 0, moved!);
  const rest = list.filter((x) => x.row === row);
  if (rest.length === 1) delete rest[0]!.row;
  return list;
}
