/**
 * Stage D — one layout model for text and pictures in a note.
 *
 * A page stays a flat list of blocks (what older VOIDEX versions read and write). Blocks that share a `row`
 * id and stand next to each other form a ROW:
 *   - pictures of one size: 100 % (one per row), 50 % (up to two) or 25 % (up to four) of the line;
 *   - plus at most one TEXT COLUMN: the row's text blocks, stacked, taking the rest of the line;
 *   - or, with `carousel`, any number of pictures scrolling sideways (no text), 100 / size of them in view.
 * A block without a row is a full-width paragraph; a picture without a row stands alone at its size.
 *
 * `normalizeBlocks` is the single consistency rule (pure, idempotent): it is applied on every edit and
 * when a note is shown, so notes written by earlier versions (any width 10–100 %, left / right pictures
 * with text flowing around them, rows of up to four pictures) open in this model without a migration
 * step and without losing anything; their stored form changes only with the next edit.
 */
import type { NoteBlock, NoteImageShape } from "@voidex/shared";

export const IMAGE_SIZES = [25, 50, 100] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
/** The text column never gets narrower than a quarter of the line. */
export const TEXT_MIN = 25;
export const SHAPES: NoteImageShape[] = ["square", "portrait", "landscape"];
export const DEFAULT_SHAPE: NoteImageShape = "square";

const isImage = (b: NoteBlock | undefined): boolean => !!b && b.kind === "image";

/** The nearest allowed size (older notes: any width 10–100 %). */
export function snapSize(width: number | undefined): ImageSize {
  const w = width ?? 100;
  // Ties go to the smaller size (75 % → 50 %): it always fits where the larger one did.
  let best: ImageSize = IMAGE_SIZES[0];
  for (const s of IMAGE_SIZES) if (Math.abs(s - w) < Math.abs(best - w)) best = s;
  return best;
}

export const sizeOf = (b: NoteBlock): ImageSize => snapSize(b.width);
/** Pictures of a size that fit one line (the text column needs TEXT_MIN of it). */
export const perLine = (size: ImageSize, withText = false) => Math.max(1, Math.floor((withText ? 100 - TEXT_MIN : 100) / size));

// ------------------------------------------------------------------ reading the layout

export type Cell = { kind: "image"; block: NoteBlock } | { kind: "text"; blocks: NoteBlock[] };
export type FlowItem =
  | { kind: "block"; block: NoteBlock }
  | { kind: "row"; id: string; cells: Cell[]; size: ImageSize; shape: NoteImageShape; carousel: boolean; images: NoteBlock[] };

/** The runs of a page: plain blocks and rows (see the module comment). Expects normalized blocks. */
export function layoutFlow(blocks: NoteBlock[]): FlowItem[] {
  const out: FlowItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (!b.row && !isImage(b)) {
      out.push({ kind: "block", block: b });
      i++;
      continue;
    }
    const id = b.row ?? b.id;
    const run: NoteBlock[] = [];
    if (b.row) while (i < blocks.length && blocks[i]!.row === id) run.push(blocks[i++]!);
    else run.push(blocks[i++]!);
    const cells: Cell[] = [];
    for (const x of run) {
      if (isImage(x)) cells.push({ kind: "image", block: x });
      else {
        const last = cells.at(-1);
        if (last?.kind === "text") last.blocks.push(x);
        else cells.push({ kind: "text", blocks: [x] });
      }
    }
    const images = run.filter(isImage);
    const first = images[0];
    out.push({
      kind: "row",
      id,
      cells,
      images,
      size: first ? sizeOf(first) : 100,
      shape: first?.shape ?? DEFAULT_SHAPE,
      carousel: !!first?.carousel,
    });
  }
  return out;
}

/** Index range [from, to] of the row (or the lone block) at `index`. */
export function extentOf(blocks: NoteBlock[], index: number): [number, number] {
  const row = blocks[index]?.row;
  if (!row) return [index, index];
  let a = index;
  let z = index;
  while (a > 0 && blocks[a - 1]!.row === row) a--;
  while (z < blocks.length - 1 && blocks[z + 1]!.row === row) z++;
  return [a, z];
}

const clone = (blocks: NoteBlock[]) => blocks.map((b) => ({ ...b }));
const rowIdFor = (first: NoteBlock) => `r${first.id}`.slice(0, 64);
function strip(b: NoteBlock): NoteBlock {
  const x = { ...b };
  delete x.row;
  delete x.carousel;
  return x;
}

// ------------------------------------------------------------------ the consistency rule

/**
 * Brings any list of blocks into the model (pure, idempotent). Nothing is ever dropped: pictures and
 * text only change rows, size or order inside a row.
 */
export function normalizeBlocks(input: NoteBlock[]): NoteBlock[] {
  let list = clone(input);

  // 1. Older pictures: sizes snap to 25 / 50 / 100; a left / right picture with text around it becomes a
  //    row: the picture (at most half the line) and the text that followed it as its text column.
  const migrated: NoteBlock[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (isImage(b) && !b.row && b.wrap && (b.align === "left" || b.align === "right")) {
      const texts: NoteBlock[] = [];
      while (texts.length < 2 && list[i + 1] && !isImage(list[i + 1]) && !list[i + 1]!.row) texts.push(list[++i]!);
      const size = Math.min(50, snapSize(b.width)) as ImageSize;
      const pic: NoteBlock = { ...b, width: size };
      delete pic.wrap;
      delete pic.align;
      if (!texts.length) {
        migrated.push(pic);
        continue;
      }
      const row = rowIdFor(pic);
      const cells = [{ ...pic, row }, ...texts.map((x) => ({ ...x, row }))];
      if (b.align === "right") cells.push(cells.shift()!);
      migrated.push(...cells);
      continue;
    }
    if (isImage(b)) {
      const x = { ...b, width: snapSize(b.width) };
      delete x.wrap;
      delete x.align;
      migrated.push(x);
    } else migrated.push(b);
  }
  list = migrated;

  // 2. A row id that shows up again further down is another row there.
  const seen = new Set<string>();
  for (let i = 0; i < list.length; ) {
    const row = list[i]!.row;
    if (!row) {
      i++;
      continue;
    }
    const [, z] = extentOf(list, i);
    if (seen.has(row)) {
      const id = rowIdFor(list[i]!);
      for (let k = i; k <= z; k++) list[k] = { ...list[k]!, row: id };
      seen.add(id);
    } else seen.add(row);
    i = z + 1;
  }

  // 3. Each row on its own.
  const out: NoteBlock[] = [];
  for (let i = 0; i < list.length; ) {
    const b = list[i]!;
    if (!b.row) {
      out.push(strip(b)); // a carousel always has a row id; without one a block stands alone
      i++;
      continue;
    }
    const [, z] = extentOf(list, i);
    out.push(...normalizeRow(list.slice(i, z + 1)));
    i = z + 1;
  }
  return out;
}

/** One row: one size and shape, one text column, nothing past the line (the rest goes on below, in order). */
function normalizeRow(run: NoteBlock[]): NoteBlock[] {
  const images = run.filter(isImage);
  if (!images.length) return run.map(strip); // text alone is just paragraphs
  const first = images[0]!;
  const size = sizeOf(first);
  const shape = first.shape ?? DEFAULT_SHAPE;
  const id = run[0]!.row!;
  const carousel = !!first.carousel;
  const look = (x: NoteBlock): NoteBlock => {
    const y: NoteBlock = { ...x, width: size, shape, row: id };
    if (carousel) y.carousel = true;
    else delete y.carousel;
    return y;
  };
  if (carousel) {
    // A carousel holds pictures only: its text goes on right after it.
    return [...images.map(look), ...run.filter((x) => !isImage(x)).map(strip)];
  }
  // One text column: all the row's text, in order, where its first block stood.
  const firstText = run.findIndex((x) => !isImage(x));
  const texts = run.filter((x) => !isImage(x));
  let cells: NoteBlock[] = run.filter(isImage);
  if (texts.length) {
    const imagesBefore = run.slice(0, firstText).filter(isImage).length;
    cells = [...cells.slice(0, imagesBefore), ...texts, ...cells.slice(imagesBefore)];
  }
  // A full-width picture leaves no room for text: the text goes on as paragraphs, in its order.
  if (texts.length && size > 100 - TEXT_MIN) {
    const before = run.slice(0, firstText).filter(isImage).length === 0;
    const pics = normalizeRow(images);
    const paras = texts.map(strip);
    return before ? [...paras, ...pics] : [...pics, ...paras];
  }
  const withText = texts.length > 0;
  const fit = perLine(size, withText);
  if (images.length <= fit) {
    // A picture alone (no text) needs no row.
    if (images.length === 1 && !withText) return [strip({ ...look(first) })];
    return cells.map((x) => (isImage(x) ? look(x) : { ...x, row: id }));
  }
  // Too many: the first ones (and the text) stay, the rest go on in rows of their own below, in order.
  const keep = new Set(images.slice(0, fit).map((x) => x.id));
  const stay = cells.filter((x) => !isImage(x) || keep.has(x.id)).map((x) => (isImage(x) ? look(x) : { ...x, row: id }));
  const rest = images.filter((x) => !keep.has(x.id));
  const more: NoteBlock[] = [];
  const per = perLine(size);
  for (let k = 0; k < rest.length; k += per) {
    const chunk = rest.slice(k, k + per);
    const rid = rowIdFor(chunk[0]!);
    if (chunk.length === 1) more.push(strip({ ...chunk[0]!, width: size, shape }));
    else more.push(...chunk.map((x) => ({ ...x, width: size, shape, row: rid })));
  }
  if (stay.filter(isImage).length === 1 && !withText) return [strip(stay[0]!), ...more];
  return [...stay, ...more];
}

// ------------------------------------------------------------------ edits (all return normalized blocks)

const indexOf = (blocks: NoteBlock[], id: string) => blocks.findIndex((b) => b.id === id);

/**
 * New pictures at the place of the cursor (D1): `at` is the text block and the caret in it; text after
 * the caret moves below the pictures. Without a place they go to the end. Pictures start at 100 %, each
 * on its own line; inside a carousel they join it next to the selected picture.
 */
export function insertImages(blocks: NoteBlock[], images: NoteBlock[], at: { id: string; pos?: number } | null, make: (text: string) => NoteBlock): NoteBlock[] {
  let list = clone(blocks);
  const fresh = images.map((x) => ({ ...strip(x), width: x.width ?? 100 }));
  const i = at ? indexOf(list, at.id) : -1;
  if (i < 0) return normalizeBlocks([...list, ...fresh]);
  const target = list[i]!;
  // Into a carousel: right after the chosen picture, at the carousel's size.
  if (isImage(target) && target.carousel && target.row) {
    const added = fresh.map((x) => ({ ...x, row: target.row, carousel: true, width: target.width, shape: target.shape }));
    list.splice(i + 1, 0, ...added);
    return normalizeBlocks(list);
  }
  // After the row the place is in (never inside a text column next to a picture: below it).
  let insertAt = i + 1;
  if (!isImage(target) && at?.pos !== undefined && at.pos > 0 && at.pos < target.text.length && !target.row) {
    // Split the paragraph at the caret.
    const tail = { ...make(target.text.slice(at.pos)), kind: target.kind, ...(target.size ? { size: target.size } : {}) };
    list[i] = { ...target, text: target.text.slice(0, at.pos) };
    list.splice(i + 1, 0, ...fresh, tail);
    return normalizeBlocks(list);
  }
  if (!isImage(target) && at?.pos === 0 && !target.row && target.text) insertAt = i; // caret at the start: above it
  if (target.row) insertAt = extentOf(list, i)[1] + 1;
  list.splice(insertAt, 0, ...fresh);
  list = normalizeBlocks(list);
  return list;
}

/** The size of a picture's row (D4: 100 / 50 / 25); what no longer fits goes on below. */
export function setImageSize(blocks: NoteBlock[], id: string, size: ImageSize): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0) return blocks;
  const [a, z] = extentOf(list, i);
  for (let k = a; k <= z; k++) if (isImage(list[k])) list[k] = { ...list[k]!, width: size };
  if (!list[i]!.row) list[i] = { ...list[i]!, width: size };
  return normalizeBlocks(list);
}

/** D8: square → portrait → landscape → square, for the whole row or carousel. */
export function cycleShape(blocks: NoteBlock[], id: string): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0) return blocks;
  const cur = list[i]!.shape ?? DEFAULT_SHAPE;
  const next = SHAPES[(SHAPES.indexOf(cur) + 1) % SHAPES.length]!;
  const [a, z] = extentOf(list, i);
  for (let k = a; k <= z; k++) if (isImage(list[k])) list[k] = { ...list[k]!, shape: next };
  return normalizeBlocks(list);
}

/** D1: the picture's tool is remembered with it. */
export function setTool(blocks: NoteBlock[], id: string, tool: "move" | "scale"): NoteBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, tool } : b));
}

/** D5 / D7: the picture swaps with the neighbouring picture of its row or carousel (text stays put). */
export function swapInRow(blocks: NoteBlock[], id: string, dir: -1 | 1): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0 || !list[i]!.row) return blocks;
  const [a, z] = extentOf(list, i);
  let j = i + dir;
  while (j >= a && j <= z && !isImage(list[j])) j += dir;
  if (j < a || j > z) return blocks;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return normalizeBlocks(list);
}

/** Can the picture move left / right inside its row (D5: arrows only when there is someone to swap with)? */
export function swapTargets(blocks: NoteBlock[], id: string): { left: boolean; right: boolean } {
  const i = indexOf(blocks, id);
  if (i < 0 || !blocks[i]!.row) return { left: false, right: false };
  const [a, z] = extentOf(blocks, i);
  return { left: blocks.slice(a, i).some(isImage), right: blocks.slice(i + 1, z + 1).some(isImage) };
}

/** D6: does the picture stand right beside the row's text column? */
export function besideText(blocks: NoteBlock[], id: string): boolean {
  const i = indexOf(blocks, id);
  if (i < 0 || !blocks[i]!.row) return false;
  const [a, z] = extentOf(blocks, i);
  return (i > a && !isImage(blocks[i - 1])) || (i < z && !isImage(blocks[i + 1]));
}

/** D6: the picture and the text column beside it change places (no text is lost). */
export function swapWithText(blocks: NoteBlock[], id: string): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0 || !list[i]!.row) return blocks;
  const [a, z] = extentOf(list, i);
  const pic = list[i]!;
  // The text column right after the picture moves before it, or the one right before moves after it.
  if (i < z && !isImage(list[i + 1])) {
    let e = i + 1;
    while (e + 1 <= z && !isImage(list[e + 1])) e++;
    const texts = list.slice(i + 1, e + 1);
    list.splice(i, e - i + 1, ...texts, pic);
    return normalizeBlocks(list);
  }
  if (i > a && !isImage(list[i - 1])) {
    let s = i - 1;
    while (s - 1 >= a && !isImage(list[s - 1])) s--;
    const texts = list.slice(s, i);
    list.splice(s, i - s + 1, pic, ...texts);
    return normalizeBlocks(list);
  }
  return blocks;
}

/** Room left on the picture's line for a text column (D3: tap beside a picture to write there). */
export function canAddText(blocks: NoteBlock[], id: string): boolean {
  const i = indexOf(blocks, id);
  const b = blocks[i];
  if (!b || !isImage(b) || b.carousel) return false;
  const [a, z] = extentOf(blocks, i);
  const run = blocks.slice(a, z + 1);
  if (run.some((x) => !isImage(x))) return false;
  return run.filter(isImage).length * sizeOf(b) <= 100 - TEXT_MIN;
}

/** D3: an empty text column beside the picture (right after the row's pictures, or `side: "left"`). */
export function addTextBeside(blocks: NoteBlock[], id: string, make: () => NoteBlock, side: "left" | "right" = "right"): { blocks: NoteBlock[]; textId: string | null } {
  if (!canAddText(blocks, id)) return { blocks, textId: null };
  const list = clone(blocks);
  const i = indexOf(list, id);
  const pic = list[i]!;
  const row = pic.row ?? rowIdFor(pic);
  const [a, z] = extentOf(list, i);
  for (let k = a; k <= z; k++) list[k] = { ...list[k]!, row };
  list[i] = { ...list[i]!, row };
  const text = { ...make(), row };
  list.splice(side === "left" ? a : z + 1, 0, text);
  return { blocks: normalizeBlocks(list), textId: text.id };
}

export type DropTarget =
  | { kind: "before" | "after"; id: string } // a line of its own, above / below this block (or its row)
  | { kind: "beside"; id: string; side: "left" | "right" } // into this block's row, next to it
  | { kind: "onto"; id: string }; // onto a picture: a carousel

/** Can `dragged` go into the row of `target` (same size, room on the line)? */
export function fitsBeside(blocks: NoteBlock[], dragged: string, target: string): boolean {
  const ti = indexOf(blocks, target);
  const t = blocks[ti];
  const d = blocks[indexOf(blocks, dragged)];
  if (!t || !d || !isImage(d) || t.id === d.id) return false;
  if (t.row && t.row === d.row) return true; // a move inside its own row
  if (isImage(t) && t.carousel) return true; // joins the carousel
  const [a, z] = t.row ? extentOf(blocks, ti) : [ti, ti];
  const run = blocks.slice(a, z + 1);
  const imgs = run.filter(isImage);
  const size = imgs[0] ? sizeOf(imgs[0]) : sizeOf(d);
  const withText = run.some((x) => !isImage(x));
  return imgs.length + 1 <= perLine(size, withText) && sizeOf(d) <= (withText ? 100 - TEXT_MIN : 100);
}

/**
 * D2: drops a picture. Before / after: on a line of its own there. Beside: into that row when it fits
 * (taking the row's size), otherwise right after the row. Onto another picture: they become a carousel
 * (or it joins the carousel there). Nothing else moves; the picture keeps its size outside rows.
 */
export function dropImage(blocks: NoteBlock[], dragged: string, target: DropTarget): NoteBlock[] {
  const from = indexOf(blocks, dragged);
  if (from < 0 || target.id === dragged) return blocks;
  if (target.kind === "onto") return makeCarousel(blocks, dragged, target.id);
  let list = clone(blocks);
  const pic = strip(list[from]!);
  const ownRow = list[from]!.row;
  list.splice(from, 1);
  const ti = indexOf(list, target.id);
  if (ti < 0) return blocks;
  const t = list[ti]!;
  if (target.kind === "beside" && (fitsBeside(blocks, dragged, target.id) || (ownRow && t.row === ownRow))) {
    const row = t.row ?? rowIdFor(t);
    const [a, z] = t.row ? extentOf(list, ti) : [ti, ti];
    for (let k = a; k <= z; k++) list[k] = { ...list[k]!, row };
    const refImg = list.slice(a, z + 1).find(isImage);
    const joined: NoteBlock = { ...pic, row, ...(refImg ? { width: refImg.width, shape: refImg.shape } : {}), ...(refImg?.carousel ? { carousel: true } : {}) };
    list.splice(target.side === "left" ? ti : ti + 1, 0, joined);
    return normalizeBlocks(list);
  }
  const [a, z] = t.row ? extentOf(list, ti) : [ti, ti];
  list.splice(target.kind === "before" ? a : z + 1, 0, pic);
  list = normalizeBlocks(list);
  return list;
}

/** D7: `dragged` dropped onto `target` → one carousel (the target's whole row), dragged right after target. */
export function makeCarousel(blocks: NoteBlock[], dragged: string, target: string): NoteBlock[] {
  const list = clone(blocks);
  const from = indexOf(list, dragged);
  if (from < 0) return blocks;
  const pic = strip(list[from]!);
  list.splice(from, 1);
  const ti = indexOf(list, target);
  if (ti < 0 || !isImage(list[ti])) return blocks;
  const t = list[ti]!;
  const row = t.row ?? rowIdFor(t);
  const [a, z] = t.row ? extentOf(list, ti) : [ti, ti];
  const size = sizeOf(t);
  for (let k = a; k <= z; k++) if (isImage(list[k])) list[k] = { ...list[k]!, row, carousel: true };
  list[ti] = { ...list[ti]!, row, carousel: true };
  list.splice(ti + 1, 0, { ...pic, row, carousel: true, width: size, shape: t.shape });
  return normalizeBlocks(list);
}

/** D7 «Добавить карусель»: the picture's row becomes a carousel (a lone picture: a carousel of one). */
export function addCarousel(blocks: NoteBlock[], id: string): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0 || !isImage(list[i])) return blocks;
  const row = list[i]!.row ?? rowIdFor(list[i]!);
  const [a, z] = list[i]!.row ? extentOf(list, i) : [i, i];
  for (let k = a; k <= z; k++) if (isImage(list[k])) list[k] = { ...list[k]!, row, carousel: true };
  return normalizeBlocks(list);
}

/**
 * D7 «Убрать карусель»: every picture stays. The ones in view (from `start`) form an ordinary row; the
 * rest go into rows of their own before and after it, in their order.
 */
export function removeCarousel(blocks: NoteBlock[], id: string, start = 0): NoteBlock[] {
  const list = clone(blocks);
  const i = indexOf(list, id);
  if (i < 0 || !list[i]!.carousel) return blocks;
  const [a, z] = extentOf(list, i);
  const imgs = list.slice(a, z + 1).filter(isImage);
  const size = sizeOf(imgs[0]!);
  const per = perLine(size);
  const s = Math.max(0, Math.min(start, Math.max(0, imgs.length - per)));
  const view = imgs.slice(s, s + per);
  const before = imgs.slice(0, s);
  const after = imgs.slice(s + per);
  const rows: NoteBlock[][] = [];
  // Before the view: whole rows counted back from it (the first row may be shorter).
  const headCount = before.length % per;
  if (headCount) rows.push(before.slice(0, headCount));
  for (let k = headCount; k < before.length; k += per) rows.push(before.slice(k, k + per));
  rows.push(view);
  for (let k = 0; k < after.length; k += per) rows.push(after.slice(k, k + per));
  const out = rows.flatMap((r) => {
    const rid = rowIdFor(r[0]!);
    return r.map((x) => {
      const y = { ...x, row: rid };
      delete y.carousel;
      return y;
    });
  });
  list.splice(a, z - a + 1, ...out);
  return normalizeBlocks(list);
}

/** Removes a block; its row closes up (a row left with one picture and no text is no row any more). */
export function removeFromFlow(blocks: NoteBlock[], id: string, make: () => NoteBlock): NoteBlock[] {
  const out = blocks.filter((b) => b.id !== id);
  return out.length ? normalizeBlocks(out) : [make()];
}

/** The carousel window after adding pictures: the start index that shows `id` (D7: new ones are in view). */
export function windowFor(images: NoteBlock[], id: string, start: number, per: number): number {
  const i = images.findIndex((x) => x.id === id);
  if (i < 0) return start;
  if (i < start) return i;
  if (i >= start + per) return i - per + 1;
  return start;
}
