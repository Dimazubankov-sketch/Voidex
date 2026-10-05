/**
 * Voidex Notes — document logic (Step 2.6). Pure functions over the stored
 * shapes (see @voidex/shared notes.ts): pages of a note, Note → Presentation,
 * reflowing slides between formats. No React, no DOM: tested with node.
 */
import type { NoteBlock, NoteBody, NotePage, PresentationBody, Slide, SlideFormat, SlideLayer } from "@voidex/shared";

export const newId = () => globalThis.crypto.randomUUID();

export function block(kind: NoteBlock["kind"] = "text", text = ""): NoteBlock {
  return { id: newId(), kind, text };
}

// ---------------------------------------------------------------- pages

/** A note with one page is continuous; with several it is paged. */
export const isPaged = (n: NoteBody) => n.pages.length > 1;

/** Splits the page that holds `blockId` so that block starts a new page ("Разделить здесь"). */
export function splitAt(n: NoteBody, blockId: string): NoteBody {
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
export function addPage(n: NoteBody, index = n.pages.length - 1): { note: NoteBody; page: NotePage } {
  const page: NotePage = { id: newId(), blocks: [block()] };
  const pages = [...n.pages];
  pages.splice(index + 1, 0, page);
  return { note: { ...n, pages }, page };
}

/** Joins all pages back into one continuous sheet (nothing is lost). */
export function mergePages(n: NoteBody): NoteBody {
  if (n.pages.length <= 1) return n;
  return { ...n, pages: [{ id: n.pages[0]!.id, blocks: n.pages.flatMap((p) => p.blocks) }] };
}

/** Removes a page; its blocks move to the previous page (never lost). */
export function removePage(n: NoteBody, index: number): NoteBody {
  if (n.pages.length <= 1 || index < 0 || index >= n.pages.length) return n;
  const pages = n.pages.map((p) => ({ ...p, blocks: [...p.blocks] }));
  const [gone] = pages.splice(index, 1);
  const target = pages[Math.max(0, index - 1)]!;
  const keep = gone!.blocks.filter((b) => b.text.trim() || b.kind === "image");
  if (index === 0) target.blocks.unshift(...keep);
  else target.blocks.push(...keep);
  return { ...n, pages };
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
export function textFits(l: SlideLayer, format: SlideFormat): boolean {
  if (l.kind === "image") return true;
  const ratio = slideRatio(format);
  const base = l.kind === "title" ? 5.2 : 3.2; // font size in % of the slide height
  const font = base * (l.scale ?? 1);
  const charsPerLine = Math.max(1, Math.floor((l.w * ratio) / (font * 0.55)));
  const lines = l.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * font * 1.3 <= l.h + 0.5;
}

export function slideOverflows(s: Slide, format: SlideFormat): boolean {
  return s.layers.some((l) => !l.hidden && (l.y + l.h > 101 || l.x + l.w > 101 || !textFits(l, format)));
}
