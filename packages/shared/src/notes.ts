/**
 * Voidex Notes (Step 2.6): projects hold documents directly — notes and
 * presentations (the old "spaces" level is gone). Each document is stored and
 * saved on its own (revision, compare-and-swap), can be shared as a copy or
 * as access to the original (editor / viewer), and its pictures are Notes
 * images on this server — never other hosts or data: URLs.
 *
 * This file holds the stored shapes and their checks (the server validates
 * every save), the DTOs, and the one-time conversion of the old per-account
 * workspace (projects → spaces → slides) into projects and documents.
 */

/** Largest stored document (serialized JSON). */
export const NOTES_DOC_MAX_BYTES = 4 * 1024 * 1024;
/** Largest legacy workspace accepted by the old snapshot checks. */
export const NOTES_LEGACY_MAX_BYTES = 8 * 1024 * 1024;
/** Largest image in a note. */
export const NOTES_MEDIA_MAX_BYTES = 12 * 1024 * 1024;
/** Images notes accept (checked by content, not by the name). SVG is never accepted. */
export const NOTES_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const NOTES_SHARES_MAX = 300;
export const NOTES_PROJECTS_MAX = 300;
export const NOTES_DOCS_MAX = 500;
export const NOTES_NAME_MAX = 120;

export const NOTES_MEDIA_PREFIX = "/api/notes/media?id=";
const MEDIA_RE = /^\/api\/notes\/media\?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The image id of a Notes media path, or null. */
export function notesMediaId(src: unknown): string | null {
  if (typeof src !== "string") return null;
  return MEDIA_RE.exec(src)?.[1] ?? null;
}

// ---------------------------------------------------------------- documents

export type NotesDocKind = "note" | "presentation" | "book";
/** Step 2.13: the file extension of a share card / file. */
export type NotesExt = ".txt" | ".prsn" | ".book";
export type NotesRole = "owner" | "editor" | "viewer";
/** A note is a portrait sheet that grows downwards, or square pages that continue sideways. */
export type NoteFormat = "vertical" | "square";
/** A presentation is widescreen (16:9) or square. */
export type SlideFormat = "rect" | "square";
export type SlideTransition = "none" | "fade" | "slide" | "scale";

export const NOTE_BLOCK_KINDS = ["text", "heading", "subheading", "heading2", "quote", "checklist", "bullet", "code", "image"] as const;
/** Step 2.13: the text sizes a Book offers (px at 100 %). */
export const BOOK_FONT_SIZES = [12, 14, 16, 18, 20, 24, 32] as const;
export type NoteBlockKind = (typeof NOTE_BLOCK_KINDS)[number];
export const SLIDE_TRANSITIONS: SlideTransition[] = ["none", "fade", "slide", "scale"];

export interface NoteBlock {
  id: string;
  kind: NoteBlockKind;
  text: string;
  checked?: boolean;
  /** Image blocks: a Notes image path. */
  src?: string;
  /** Image width in % of the line (20…100). */
  width?: number;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  /** Step 2.13: text size in px (one of BOOK_FONT_SIZES); unset = the style's own size. */
  size?: number;
  /** Step 2.13: an image aligned left / right lets the text that follows flow beside it. */
  wrap?: boolean;
  /** Step 2.13: neighbouring images with the same row id stand side by side in one row. */
  row?: string;
  /**
   * Step 2.16: the shape of the pictures of a row (all pictures of a row share
   * it, and the row's width): square, portrait (vertical) or landscape.
   */
  shape?: NoteImageShape;
  /** Step 2.16: a picture's width / height, known when it is added (its place is kept while it loads). */
  ratio?: number;
}
export const NOTE_IMAGE_SHAPES = ["square", "portrait", "landscape"] as const;
export type NoteImageShape = (typeof NOTE_IMAGE_SHAPES)[number];
/** A page of a note. A note with one page is continuous (it grows as you write). */
export interface NotePage {
  id: string;
  blocks: NoteBlock[];
}
export interface NoteBody {
  kind: "note";
  format: NoteFormat;
  pages: NotePage[];
}

/** An element on a slide, in % of the slide (so it reflows between formats). */
export interface SlideLayer {
  id: string;
  kind: "title" | "text" | "image";
  text: string;
  src?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  align?: "left" | "center" | "right";
  /** Text size multiplier (1 = the kind's default). */
  scale?: number;
  hidden?: boolean;
  locked?: boolean;
  /**
   * Stage C (images): "cover" = the picture fills the whole slide, cropped only on screen (the file is
   * untouched). Unset = the picture is shown whole inside its box.
   */
  fit?: "cover";
  /** Stage C: the picture's own width / height (to restore its proportions and fit it). */
  ratio?: number;
  /** Stage C: the picture's size in pixels when it was added (shown in its menu). */
  px?: { w: number; h: number };
}
export interface Slide {
  id: string;
  transition: SlideTransition;
  layers: SlideLayer[];
}
export interface PresentationBody {
  kind: "presentation";
  /** "square" when the canvas is square, else "rect" (older apps read only this: 16:9 / 1:1). */
  format: SlideFormat;
  slides: Slide[];
  /**
   * Stage C: the canvas in pixels (16:9 1920×1080, 4:3, 9:16, a custom size, a picture's proportions).
   * Absent in presentations made before it: 1920×1080 for "rect", 1080×1080 for "square".
   */
  canvas?: { w: number; h: number };
}
export const CANVAS_MIN = 64;
export const CANVAS_MAX = 8192;
/**
 * Step 2.13: a book. Fixed pages (shown as spreads on wide screens) holding
 * the same blocks as a note; pages are only added by the person ("+"), never
 * by themselves.
 */
export interface BookBody {
  kind: "book";
  format: "book";
  pages: NotePage[];
}
export type NotesBody = NoteBody | PresentationBody | BookBody;


type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const num = (x: unknown, min: number, max: number) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const opt = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || x === null || ok(x);
const bool = (x: unknown) => typeof x === "boolean";
const ALIGN = ["left", "center", "right"];

/** A cover: a Notes image, or nothing (a generated preview is shown). */
export const validCover = (x: unknown) => x === null || x === undefined || notesMediaId(x) !== null;

function validBlock(b: unknown) {
  return (
    isObj(b) &&
    str(b.id, 64) &&
    (NOTE_BLOCK_KINDS as readonly string[]).includes(b.kind as string) &&
    str(b.text, 100_000) &&
    opt(b.checked, bool) &&
    (b.src === undefined || b.src === "" || notesMediaId(b.src) !== null) &&
    opt(b.width, (v) => num(v, 10, 100)) &&
    opt(b.align, (v) => ALIGN.includes(v as string)) &&
    opt(b.bold, bool) &&
    opt(b.italic, bool) &&
    opt(b.size, (v) => (BOOK_FONT_SIZES as readonly number[]).includes(v as number)) &&
    opt(b.wrap, bool) &&
    opt(b.row, (v) => str(v, 64)) &&
    opt(b.shape, (v) => (NOTE_IMAGE_SHAPES as readonly string[]).includes(v as string)) &&
    opt(b.ratio, (v) => num(v, 0.05, 20))
  );
}


const validPages = (x: unknown, max: number) =>
  Array.isArray(x) && x.length >= 1 && x.length <= max && x.every((p) => isObj(p) && str(p.id, 64) && Array.isArray(p.blocks) && p.blocks.length <= 3000 && p.blocks.every(validBlock));

export function validNoteBody(x: unknown): x is NoteBody {
  return isObj(x) && x.kind === "note" && (x.format === "vertical" || x.format === "square") && validPages(x.pages, 500);
}

/** Step 2.13: a book (up to 1000 pages). */
export function validBookBody(x: unknown): x is BookBody {
  return isObj(x) && x.kind === "book" && x.format === "book" && validPages(x.pages, 1000);
}

function validLayer(l: unknown) {
  return (
    isObj(l) &&
    str(l.id, 64) &&
    ["title", "text", "image"].includes(l.kind as string) &&
    str(l.text, 20_000) &&
    (l.src === undefined || l.src === "" || notesMediaId(l.src) !== null) &&
    num(l.x, -50, 150) &&
    num(l.y, -50, 150) &&
    num(l.w, 1, 200) &&
    num(l.h, 1, 200) &&
    opt(l.align, (v) => ALIGN.includes(v as string)) &&
    opt(l.scale, (v) => num(v, 0.3, 4)) &&
    opt(l.hidden, bool) &&
    opt(l.locked, bool) &&
    opt(l.fit, (v) => v === "cover") &&
    opt(l.ratio, (v) => num(v, 0.01, 100)) &&
    opt(l.px, (v) => isObj(v) && num(v.w, 1, 100_000) && num(v.h, 1, 100_000))
  );
}

export function validPresentationBody(x: unknown): x is PresentationBody {
  return (
    isObj(x) &&
    x.kind === "presentation" &&
    (x.format === "rect" || x.format === "square") &&
    opt(x.canvas, (c) => isObj(c) && Number.isInteger(c.w) && Number.isInteger(c.h) && num(c.w, CANVAS_MIN, CANVAS_MAX) && num(c.h, CANVAS_MIN, CANVAS_MAX) && (c.w as number) / (c.h as number) <= 8 && (c.h as number) / (c.w as number) <= 8) &&
    Array.isArray(x.slides) &&
    x.slides.length >= 1 &&
    x.slides.length <= 300 &&
    x.slides.every(
      (s) =>
        isObj(s) &&
        str(s.id, 64) &&
        (SLIDE_TRANSITIONS as string[]).includes(s.transition as string) &&
        Array.isArray(s.layers) &&
        s.layers.length <= 100 &&
        s.layers.every(validLayer),
    )
  );
}

export function validNotesBody(kind: NotesDocKind, x: unknown): x is NotesBody {
  return kind === "note" ? validNoteBody(x) : kind === "book" ? validBookBody(x) : validPresentationBody(x);
}

/** Every Notes image something refers to (src / cover / background). */
export function notesMediaIds(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) {
    for (const v of x) notesMediaIds(v, out);
  } else if (isObj(x)) {
    for (const [k, v] of Object.entries(x)) {
      if ((k === "src" || k === "cover" || k === "background") && typeof v === "string") {
        const id = notesMediaId(v);
        if (id) out.add(id);
      } else if (typeof v === "object") notesMediaIds(v, out);
    }
  }
  return out;
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function emptyNote(format: NoteFormat = "vertical"): NoteBody {
  return { kind: "note", format, pages: [{ id: newId(), blocks: [{ id: newId(), kind: "text", text: "" }] }] };
}

/**
 * Step 2.16: books are gone. A book written earlier opens (and is saved) as a
 * note with the same pages: nothing of it is lost.
 */
export function bookAsNote(b: BookBody): NoteBody {
  return { kind: "note", format: "vertical", pages: b.pages };
}

/** Step 2.13: a new book opens on its first spread (two empty pages). */
export function emptyBook(): BookBody {
  const page = (): NotePage => ({ id: newId(), blocks: [{ id: newId(), kind: "text", text: "" }] });
  return { kind: "book", format: "book", pages: [page(), page()] };
}


export function titleSlide(title = "", subtitle = ""): Slide {
  return {
    id: newId(),
    transition: "fade",
    layers: [
      { id: newId(), kind: "title", text: title, x: 8, y: 30, w: 84, h: 20, align: "center" },
      { id: newId(), kind: "text", text: subtitle, x: 14, y: 54, w: 72, h: 16, align: "center" },
    ],
  };
}

export function emptyPresentation(format: SlideFormat = "rect"): PresentationBody {
  return { kind: "presentation", format, slides: [titleSlide()] };
}

/** First words of a document (for the lists). */
export function notesPreview(body: unknown, max = 160): string {
  const parts: string[] = [];
  if (isObj(body) && Array.isArray(body.pages)) {
    for (const p of body.pages) if (isObj(p) && Array.isArray(p.blocks)) for (const b of p.blocks) if (isObj(b) && typeof b.text === "string" && b.kind !== "image") parts.push(b.text);
  } else if (isObj(body) && Array.isArray(body.slides)) {
    for (const s of body.slides) if (isObj(s) && Array.isArray(s.layers)) for (const l of s.layers) if (isObj(l) && typeof l.text === "string" && l.kind !== "image") parts.push(l.text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Pages of a note / slides of a presentation. */
export function notesPageCount(body: unknown): number {
  if (isObj(body) && Array.isArray(body.pages)) return body.pages.length;
  if (isObj(body) && Array.isArray(body.slides)) return body.slides.length;
  return 0;
}

// ---------------------------------------------------------------- DTOs

export interface NotesPersonDto {
  id: string;
  name: string;
  username: string;
  mailAddress: string;
  avatarVersion: number;
}

export interface NotesProjectDto {
  id: string;
  name: string;
  cover: string | null;
  /** My role in it. */
  role: NotesRole;
  owner: NotesPersonDto;
  documents: number;
  /** Other people have access (it is shared). */
  shared: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotesDocMetaDto {
  id: string;
  projectId: string;
  kind: NotesDocKind;
  name: string;
  cover: string | null;
  format: NoteFormat | SlideFormat | "book";
  role: NotesRole;
  revision: number;
  pages: number;
  preview: string;
  position: number;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotesDocumentDto extends NotesDocMetaDto {
  data: NotesBody;
  projectName: string;
  owner: NotesPersonDto;
}

export interface NotesProjectDetailDto {
  project: NotesProjectDto;
  documents: NotesDocMetaDto[];
}

export interface NotesMemberDto extends NotesPersonDto {
  role: NotesRole;
  since: string;
}

export type NotesShareMode = "copy" | "access";
export type NotesShareKind = NotesDocKind | "project";

/** What a share link is (no content: opening needs access, a copy is made by "Add to my Notes"). */
export interface NotesShareInfoDto {
  token: string;
  mode: NotesShareMode;
  role: Exclude<NotesRole, "owner">;
  kind: NotesShareKind;
  name: string;
  ext: NotesExt;
  owner: { id: string; name: string };
  /** My access to the original right now. */
  access: NotesRole | "none";
  /** The original (only when I may open it). */
  projectId?: string;
  documentId?: string;
  /** The link was revoked or the original deleted. */
  gone: boolean;
}

/** A Notes share as a file card in Vibex messages and VoidOps letters. */
export interface NotesCardDto {
  token: string;
  title: string;
  ext: NotesExt;
  kind: NotesShareKind;
}

export interface NotesShareDto {
  token: string;
  mode: NotesShareMode;
  role: Exclude<NotesRole, "owner">;
  createdAt: string;
}

export interface NotesPrefsDto {
  projectsView: "grid" | "list";
  projectsSort: "custom" | "name" | "modified" | "created";
  docsView: "grid" | "list";
  docsSort: "custom" | "name" | "modified" | "created";
}
export const DEFAULT_NOTES_PREFS: NotesPrefsDto = { projectsView: "grid", projectsSort: "modified", docsView: "grid", docsSort: "custom" };

/** The file-card extension: presentations are .prsn; notes (Step 2.16: books written earlier too) and whole projects .txt. */
export const notesExt = (kind: NotesShareKind): NotesExt => (kind === "presentation" ? ".prsn" : ".txt");


// ---------------------------------------------------------------- legacy (Step 2.5 workspace)

/** A document converted from an old space. */
export interface LegacyDocument {
  legacyId: string;
  kind: NotesDocKind;
  name: string;
  cover: string | null;
  data: NotesBody;
}
export interface LegacyProject {
  legacyId: string;
  name: string;
  cover: string | null;
  documents: LegacyDocument[];
}

const coverOf = (x: unknown): string | null => (notesMediaId(x) ? (x as string) : null);
const clampName = (x: unknown, fallback: string) => (typeof x === "string" && x.trim() ? x.trim().slice(0, NOTES_NAME_MAX) : fallback);

function legacyBlock(b: Obj): NoteBlock | null {
  const kind = (NOTE_BLOCK_KINDS as readonly string[]).includes(b.kind as string) ? (b.kind as NoteBlockKind) : "text";
  const out: NoteBlock = { id: typeof b.id === "string" ? b.id.slice(0, 64) : newId(), kind, text: typeof b.text === "string" ? b.text.slice(0, 100_000) : "" };
  if (kind === "image") {
    if (!notesMediaId(b.src)) return null;
    out.src = b.src as string;
    out.width = Math.max(20, Math.min(100, Math.round(((typeof b.size === "number" ? b.size : 12) / 12) * 100)));
  }
  if (b.checked === true) out.checked = true;
  if (b.align === "center" || b.align === "right") out.align = b.align;
  if (b.bold === true) out.bold = true;
  if (b.italic === true) out.italic = true;
  return out;
}

function legacyBlocks(slide: Obj): NoteBlock[] {
  const blocks = Array.isArray(slide.blocks) ? slide.blocks : [];
  return blocks.filter(isObj).filter((b) => b.hidden !== true).map(legacyBlock).filter((b): b is NoteBlock => !!b);
}

function legacyNote(space: Obj): NoteBody {
  const slides = (Array.isArray(space.slides) ? space.slides : []).filter(isObj);
  const pages: NotePage[] = slides.map((s) => ({ id: typeof s.id === "string" ? s.id.slice(0, 64) : newId(), blocks: legacyBlocks(s) }));
  // A continuous note was stored as several slides shown one after another: keep them as one sheet.
  const paged = space.paged === true;
  const merged: NotePage[] = paged || pages.length <= 1 ? pages : [{ id: pages[0]!.id, blocks: pages.flatMap((p) => p.blocks) }];
  const list = merged.length ? merged : [{ id: newId(), blocks: [] }];
  for (const p of list) if (!p.blocks.length) p.blocks.push({ id: newId(), kind: "text", text: "" });
  return { kind: "note", format: space.flow === "horizontal" ? "square" : "vertical", pages: list };
}

const TRANSITION_MAP: Record<string, SlideTransition> = { none: "none", fade: "fade", slide: "slide", zoom: "scale", page: "slide" };

function legacyPresentation(space: Obj): PresentationBody {
  const slides = (Array.isArray(space.slides) ? space.slides : []).filter(isObj).map((s): Slide => {
    const layers: SlideLayer[] = [];
    let y = 8;
    for (const b of legacyBlocks(s)) {
      if (y > 92) break;
      if (b.kind === "image") {
        const h = 34;
        layers.push({ id: b.id, kind: "image", text: b.text, src: b.src, x: 25, y, w: 50, h });
        y += h + 3;
      } else {
        const title = b.kind === "heading" || b.kind === "subheading";
        const lines = Math.max(1, Math.ceil(b.text.length / (title ? 40 : 70)));
        const h = Math.min(60, (title ? 13 : 7) * lines);
        layers.push({ id: b.id, kind: title ? "title" : "text", text: b.text, x: 8, y, w: 84, h, align: b.align ?? "left" });
        y += h + 2;
      }
    }
    return { id: typeof s.id === "string" ? s.id.slice(0, 64) : newId(), transition: TRANSITION_MAP[s.transition as string] ?? "fade", layers };
  });
  return { kind: "presentation", format: space.format === "portrait" ? "square" : "rect", slides: slides.length ? slides : [titleSlide()] };
}

/** One old space → one document (its mode decides note / presentation). */
export function legacySpaceToDocument(space: unknown): LegacyDocument | null {
  if (!isObj(space)) return null;
  const kind: NotesDocKind = space.mode === "presentation" ? "presentation" : "note";
  return {
    legacyId: typeof space.id === "string" ? space.id.slice(0, 64) : newId(),
    kind,
    name: clampName(space.name, kind === "note" ? "Заметка" : "Презентация"),
    cover: coverOf(space.cover),
    data: kind === "note" ? legacyNote(space) : legacyPresentation(space),
  };
}

/** Makes names unique inside one project ("Идеи", "Идеи (2)", …) without losing any document. */
export function uniqueNames<T extends { name: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const key = it.name.toLocaleLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? it : { ...it, name: `${it.name} (${n})`.slice(0, NOTES_NAME_MAX) };
  });
}

/** One old project → a project whose documents are its spaces (in their order). */
export function legacyProject(p: unknown): LegacyProject | null {
  if (!isObj(p)) return null;
  const spaces = Array.isArray(p.spaces) ? p.spaces : [];
  return {
    legacyId: typeof p.id === "string" ? p.id.slice(0, 64) : newId(),
    name: clampName(p.name, "Проект"),
    cover: coverOf(p.cover),
    documents: uniqueNames(spaces.map(legacySpaceToDocument).filter((d): d is LegacyDocument => !!d)),
  };
}

/** The whole old workspace (projects → spaces) → projects → documents. Nothing is dropped. */
export function legacyWorkspace(w: unknown): LegacyProject[] {
  if (!isObj(w) || !Array.isArray(w.projects)) return [];
  return w.projects.map(legacyProject).filter((p): p is LegacyProject => !!p);
}

/** An old share snapshot (a space or a project) as a project to copy. */
export function legacySnapshot(x: unknown): LegacyProject | null {
  if (!isObj(x)) return null;
  if (Array.isArray(x.spaces)) return legacyProject(x);
  const doc = legacySpaceToDocument(x);
  return doc ? { legacyId: doc.legacyId, name: doc.name, cover: doc.cover, documents: [doc] } : null;
}
