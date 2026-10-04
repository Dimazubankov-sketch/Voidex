/**
 * Voidex Notes (Step 2.5): limits and the shape check of stored documents,
 * shared by the server (it validates every save and share) and the app.
 *
 * The document itself (projects → spaces → pages → blocks) is owned by the
 * Notes package (packages/notes); this file only checks that what is stored
 * is a well-formed Notes workspace with sane sizes, and that pictures point to
 * Notes images on this server — never to other hosts or data: URLs.
 */

/** Largest stored workspace (serialized JSON). */
export const NOTES_DOC_MAX_BYTES = 8 * 1024 * 1024;
/** Largest image in a note. */
export const NOTES_MEDIA_MAX_BYTES = 12 * 1024 * 1024;
/** Images notes accept (checked by content, not by the name). SVG is never accepted. */
export const NOTES_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const NOTES_SHARES_MAX = 200;

export const NOTES_MEDIA_PREFIX = "/api/notes/media?id=";
const MEDIA_RE = /^\/api\/notes\/media\?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The image id of a Notes media path, or null. */
export function notesMediaId(src: unknown): string | null {
  if (typeof src !== "string") return null;
  return MEDIA_RE.exec(src)?.[1] ?? null;
}

const BACKGROUNDS = ["white", "milk", "lavender", "split", "wave", "graphite"];
const TRANSITIONS = ["none", "fade", "slide", "zoom", "page"];
const KINDS = ["text", "heading", "quote", "checklist", "code", "image"];
const ALIGN = ["left", "right", "center"];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const cover = (x: unknown) => typeof x === "string" && (BACKGROUNDS.includes(x) || notesMediaId(x) !== null);
const size = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 1 && x <= 12;

function validBlock(b: unknown) {
  return (
    isObj(b) &&
    str(b.id, 64) &&
    str(b.text, 100_000) &&
    KINDS.includes(b.kind as string) &&
    ALIGN.includes(b.align as string) &&
    size(b.size) &&
    (b.portraitSize === undefined || b.portraitSize === null || b.portraitSize === 0 || size(b.portraitSize)) &&
    (b.src === undefined || b.src === "" || notesMediaId(b.src) !== null) &&
    (b.label === undefined || str(b.label, 500))
  );
}

function validSlide(s: unknown) {
  return (
    isObj(s) &&
    str(s.id, 64) &&
    cover(s.background) &&
    TRANSITIONS.includes(s.transition as string) &&
    str(s.speaker, 100_000) &&
    Array.isArray(s.blocks) &&
    s.blocks.length <= 500 &&
    s.blocks.every(validBlock)
  );
}

export function validNotesSpace(s: unknown): boolean {
  return (
    isObj(s) &&
    str(s.id, 64) &&
    str(s.name, 200) &&
    cover(s.cover) &&
    ["notes", "presentation"].includes(s.mode as string) &&
    ["landscape", "portrait", "both"].includes(s.format as string) &&
    ["vertical", "horizontal"].includes(s.flow as string) &&
    Array.isArray(s.slides) &&
    s.slides.length > 0 &&
    s.slides.length <= 500 &&
    s.slides.every(validSlide)
  );
}

export function validNotesProject(p: unknown): boolean {
  return isObj(p) && str(p.id, 64) && str(p.name, 200) && cover(p.cover) && Array.isArray(p.spaces) && p.spaces.length <= 500 && p.spaces.every(validNotesSpace);
}

export function validNotesWorkspace(w: unknown): boolean {
  return isObj(w) && w.version === 1 && Array.isArray(w.projects) && w.projects.length <= 300 && w.projects.every(validNotesProject);
}

/** Every Notes image a space / project / workspace refers to. */
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

/** A copy for sharing: speaker notes (presenter / teleprompter text) never leave the owner. */
export function withoutSpeakerNotes<T>(x: T): T {
  if (Array.isArray(x)) return x.map(withoutSpeakerNotes) as T;
  if (isObj(x)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(x)) out[k] = k === "speaker" ? "" : withoutSpeakerNotes(v);
    return out as T;
  }
  return x;
}

export interface NotesDocDto {
  data: unknown;
  revision: number;
}

export interface NotesShareDto {
  token: string;
  name: string;
  /** Unix ms (the Notes package's own format). */
  created: number;
}
