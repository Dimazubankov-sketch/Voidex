import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoteBlock } from "@voidex/shared";
import {
  addCarousel,
  addTextBeside,
  besideText,
  canAddText,
  cycleShape,
  dropImage,
  fitsBeside,
  insertImages,
  layoutFlow,
  makeCarousel,
  normalizeBlocks,
  removeCarousel,
  removeFromFlow,
  setImageSize,
  setTool,
  snapSize,
  swapInRow,
  swapTargets,
  swapWithText,
  windowFor,
} from "../src/flow.ts";

let seq = 0;
const T = (text: string, extra: Partial<NoteBlock> = {}): NoteBlock => ({ id: `t${++seq}`, kind: "text", text, ...extra });
const I = (extra: Partial<NoteBlock> = {}): NoteBlock => ({ id: `i${++seq}`, kind: "image", text: "", src: "/api/notes/media?id=x", width: 100, ...extra });
const make = (text = "") => T(text);
const ids = (bs: NoteBlock[]) => bs.map((b) => b.id);
const shape = (bs: NoteBlock[]) =>
  layoutFlow(bs).map((it) => (it.kind === "block" ? it.block.id : `[${it.carousel ? "C:" : ""}${it.size}:${it.cells.map((c) => (c.kind === "image" ? c.block.id : `(${c.blocks.map((b) => b.id).join(",")})`)).join(" ")}]`));

test("D4: only 100 / 50 / 25 %; older widths snap to the nearest", () => {
  assert.deepEqual([10, 30, 37, 38, 60, 75, 76, 100, undefined].map(snapSize), [25, 25, 25, 50, 50, 50, 100, 100, 100]);
  const a = I({ width: 33 });
  assert.equal(normalizeBlocks([a])[0]!.width, 25);
});

test("migration: an older left / right picture with text around it becomes a row; nothing is lost", () => {
  const pic = I({ width: 40, align: "right", wrap: true });
  const a = T("рядом 1");
  const b = T("рядом 2");
  const c = T("ниже");
  const out = normalizeBlocks([pic, a, b, c]);
  assert.deepEqual(shape(out), [`[50:(${a.id},${b.id}) ${pic.id}]`, c.id]);
  assert.equal(out.find((x) => x.id === pic.id)!.wrap, undefined);
  assert.equal(out.length, 4);
  // Idempotent.
  assert.deepEqual(normalizeBlocks(out), out);
  // A large picture with wrap is at most half the line.
  assert.equal(normalizeBlocks([I({ width: 90, align: "left", wrap: true }), T("x")])[0]!.width, 50);
});

test("D5: at most 1 / 2 / 4 per row; extra pictures go on below in order", () => {
  const imgs = [1, 2, 3, 4, 5].map(() => I({ width: 50, row: "r" }));
  const out = normalizeBlocks(imgs);
  assert.deepEqual(shape(out), [`[50:${imgs[0]!.id} ${imgs[1]!.id}]`, `[50:${imgs[2]!.id} ${imgs[3]!.id}]`, `[50:${imgs[4]!.id}]`]);
  assert.deepEqual(ids(out), ids(imgs));
  const q = [1, 2, 3, 4, 5, 6].map(() => I({ width: 25, row: "q" }));
  assert.deepEqual(shape(normalizeBlocks(q)).length, 2);
  // A row of one picture without text is no row.
  assert.equal(normalizeBlocks([I({ row: "lone" })])[0]!.row, undefined);
});

test("D6: a row of pictures and one text column; the text never goes past the line", () => {
  const a = I({ width: 25, row: "m" });
  const t1 = T("текст", { row: "m" });
  const b = I({ width: 25, row: "m" });
  const t2 = T("ещё", { row: "m" });
  // Text split by a picture becomes one column (where its first block stood).
  assert.deepEqual(shape(normalizeBlocks([a, t1, b, t2])), [`[25:${a.id} (${t1.id},${t2.id}) ${b.id}]`]);
  // 50 % + text fits; 100 % + text does not: the text goes on below as plain paragraphs.
  const big = I({ width: 100, row: "z" });
  const tz = T("под", { row: "z" });
  assert.deepEqual(shape(normalizeBlocks([big, tz])), [`[100:${big.id}]`, tz.id]);
  // 25 %: one, two or three pictures with text.
  for (const n of [1, 2, 3]) {
    const imgs = Array.from({ length: n }, () => I({ width: 25, row: `k${n}` }));
    const txt = T("t", { row: `k${n}` });
    const lines = layoutFlow(normalizeBlocks([...imgs, txt]));
    assert.equal(lines.length, 1, `${n} pictures + text`);
  }
  const four = Array.from({ length: 4 }, () => I({ width: 25, row: "k4" }));
  assert.equal(layoutFlow(normalizeBlocks([...four, T("t", { row: "k4" })])).length, 2);
});

test("D1: new pictures go where the cursor was (splitting the paragraph), 100 % each", () => {
  const p = T("Начало конец");
  const pic = I({ width: undefined });
  const out = insertImages([p], [pic], { id: p.id, pos: 6 }, make);
  assert.equal(out[0]!.text, "Начало");
  assert.equal(out[1]!.id, pic.id);
  assert.equal(out[1]!.width, 100);
  assert.equal(out[2]!.text, " конец");
  // Caret at the start: above the paragraph; no place: at the end.
  const q = T("абв");
  assert.equal(insertImages([q], [I()], { id: q.id, pos: 0 }, make)[0]!.kind, "image");
  assert.equal(insertImages([q], [I()], null, make).at(-1)!.kind, "image");
  // In a text column: below the row, never inside it.
  const a = I({ width: 50, row: "r" });
  const t = T("рядом", { row: "r" });
  const after = insertImages([a, t], [I()], { id: t.id, pos: 2 }, make);
  assert.deepEqual(after.slice(0, 2).map((x) => x.row), ["r", "r"]);
  assert.equal(after[2]!.row, undefined);
});

test("D4: resizing a picture resizes its row; what no longer fits goes on below", () => {
  const a = I({ width: 50, row: "r" });
  const b = I({ width: 50, row: "r" });
  const big = setImageSize([a, b], a.id, 100);
  assert.deepEqual(shape(big), [`[100:${a.id}]`, `[100:${b.id}]`]);
  const small = setImageSize([a, b], b.id, 25);
  assert.deepEqual(shape(small), [`[25:${a.id} ${b.id}]`]);
});

test("D2: dropping a picture: own line above / below, beside another (if it fits), onto one = carousel", () => {
  const t1 = T("один");
  const a = I({ width: 50 });
  const t2 = T("два");
  const b = I({ width: 50 });
  let l = normalizeBlocks([t1, a, t2, b]);
  // Below "один"? It is already there; above it:
  assert.deepEqual(ids(dropImage(l, a.id, { kind: "before", id: t1.id })), [a.id, t1.id, t2.id, b.id]);
  // Beside b: a row of two 50 % pictures.
  l = dropImage(l, a.id, { kind: "beside", id: b.id, side: "right" });
  assert.deepEqual(shape(l), [t1.id, t2.id, `[50:${b.id} ${a.id}]`]);
  // A 100 % picture does not fit beside them: it goes on its own line after the row.
  const c = I({ width: 100 });
  l = [...l, c];
  assert.equal(fitsBeside(l, c.id, a.id), false);
  l = dropImage(l, c.id, { kind: "beside", id: a.id, side: "right" });
  assert.deepEqual(shape(l).at(-1), `[100:${c.id}]`);
  // Onto a picture: one carousel; the dropped picture takes the carousel's size.
  l = dropImage(l, c.id, { kind: "onto", id: b.id });
  const car = layoutFlow(l).find((x) => x.kind === "row" && x.carousel);
  assert.ok(car && car.kind === "row");
  assert.deepEqual(ids(car.images), [b.id, c.id, a.id]);
  assert.ok(car.images.every((x) => x.width === 50));
  // Nothing was lost.
  assert.equal(l.length, 5);
});

test("D5 / D6: arrows swap pictures in a row; text and picture swap places without losing text", () => {
  const a = I({ width: 25, row: "r" });
  const t = T("текст", { row: "r" });
  const b = I({ width: 25, row: "r" });
  let l = normalizeBlocks([a, t, b]);
  assert.deepEqual(swapTargets(l, a.id), { left: false, right: true });
  l = swapInRow(l, a.id, 1);
  assert.deepEqual(shape(l), [`[25:${b.id} (${t.id}) ${a.id}]`]);
  assert.equal(besideText(l, a.id), true);
  l = swapWithText(l, a.id);
  assert.deepEqual(shape(l), [`[25:${b.id} ${a.id} (${t.id})]`]);
  assert.equal(l.find((x) => x.id === t.id)!.text, "текст");
  // A lone picture has nobody to swap with.
  const lone = I();
  assert.deepEqual(swapTargets([lone], lone.id), { left: false, right: false });
});

test("D3: tap beside a picture: a text column, only where there is room", () => {
  const a = I({ width: 50 });
  assert.equal(canAddText([a], a.id), true);
  const r = addTextBeside([a], a.id, () => T(""));
  assert.ok(r.textId);
  assert.deepEqual(shape(r.blocks), [`[50:${a.id} (${r.textId})]`]);
  // Again: there is a text column already.
  assert.equal(canAddText(r.blocks, a.id), false);
  const full = I({ width: 100 });
  assert.equal(canAddText([full], full.id), false);
});

test("D7: carousels: add, remove (all pictures kept, the ones in view stay together, order kept)", () => {
  const imgs = [1, 2, 3, 4, 5, 6].map(() => I({ width: 50 }));
  let l = normalizeBlocks(imgs.slice(0, 1));
  l = addCarousel(l, imgs[0]!.id);
  assert.ok(l[0]!.carousel && l[0]!.row);
  for (const x of imgs.slice(1)) l = makeCarousel([...l, x], x.id, l.at(-1)!.id);
  const car = layoutFlow(l)[0]!;
  assert.ok(car.kind === "row" && car.carousel && car.images.length === 6);
  // Remove with 3 and 4 in view (window start 2, two at a time).
  const out = removeCarousel(l, imgs[0]!.id, 2);
  assert.deepEqual(ids(out), ids(imgs));
  assert.ok(out.every((x) => !x.carousel));
  const lines = layoutFlow(out).map((x) => (x.kind === "row" ? ids(x.images) : [x.block.id]));
  assert.deepEqual(lines, [ids(imgs.slice(0, 2)), ids(imgs.slice(2, 4)), ids(imgs.slice(4, 6))]);
  // Window 1: [1] [2,3] [4,5] [6]
  const odd = layoutFlow(removeCarousel(l, imgs[0]!.id, 1)).map((x) => (x.kind === "row" ? x.images.length : 1));
  assert.deepEqual(odd, [1, 2, 2, 1]);
  // A carousel keeps text out of it.
  const tx = T("не в карусели", { row: l[0]!.row });
  assert.equal(normalizeBlocks([...l, tx]).at(-1)!.row, undefined);
  // New pictures inserted while a carousel picture is chosen join it next to that picture.
  const added = I({ width: 100 });
  const more = insertImages(l, [added], { id: imgs[2]!.id }, make);
  const c2 = layoutFlow(more)[0]!;
  assert.ok(c2.kind === "row" && c2.images[3]!.id === added.id && c2.images[3]!.width === 50);
  assert.equal(windowFor(c2.kind === "row" ? c2.images : [], added.id, 0, 2), 2);
});

test("D8 / D1: the row's shape cycles for all its pictures; the tool is remembered per picture", () => {
  const a = I({ width: 50, row: "r", shape: "square" });
  const b = I({ width: 50, row: "r" });
  let l = normalizeBlocks([a, b]);
  l = cycleShape(l, b.id);
  assert.deepEqual(l.map((x) => x.shape), ["portrait", "portrait"]);
  l = cycleShape(cycleShape(l, a.id), a.id);
  assert.deepEqual(l.map((x) => x.shape), ["square", "square"]);
  l = setTool(l, a.id, "scale");
  assert.equal(l[0]!.tool, "scale");
  assert.equal(l[1]!.tool, undefined);
});

test("removing a picture closes its row up; the last block of a page is never removed", () => {
  const a = I({ width: 50, row: "r" });
  const b = I({ width: 50, row: "r" });
  const out = removeFromFlow([a, b], a.id, () => T(""));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.row, undefined);
  assert.equal(removeFromFlow([a], a.id, () => T("")).length, 1);
});

test("fuzz: any sequence of edits keeps every block, stays normalized and never overfills a line", () => {
  let rnd = 12345;
  const r = (n: number) => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd % n;
  };
  for (let run = 0; run < 60; run++) {
    let l: NoteBlock[] = normalizeBlocks([T("a"), I({ width: [25, 50, 100][r(3)] }), T("b"), I({ width: 50 }), I({ width: 25 }), T("c")]);
    const all = new Set(ids(l));
    for (let step = 0; step < 40; step++) {
      const imgs = l.filter((x) => x.kind === "image");
      const pick = () => imgs[r(imgs.length)]!;
      const any = () => l[r(l.length)]!;
      switch (r(10)) {
        case 0: l = setImageSize(l, pick().id, ([25, 50, 100] as const)[r(3)]!); break;
        case 1: { const d = pick(); const t = any(); l = dropImage(l, d.id, (["before", "after"] as const)[r(2)] ? { kind: (["before", "after"] as const)[r(2)]!, id: t.id } : { kind: "after", id: t.id }); break; }
        case 2: { const d = pick(); const t = pick(); l = dropImage(l, d.id, { kind: "beside", id: t.id, side: r(2) ? "left" : "right" }); break; }
        case 3: { const d = pick(); const t = pick(); if (d.id !== t.id) l = dropImage(l, d.id, { kind: "onto", id: t.id }); break; }
        case 4: l = addCarousel(l, pick().id); break;
        case 5: l = removeCarousel(l, pick().id, r(3)); break;
        case 6: l = swapInRow(l, pick().id, r(2) ? 1 : -1); break;
        case 7: l = swapWithText(l, pick().id); break;
        case 8: { const res = addTextBeside(l, pick().id, () => T("new")); l = res.blocks; if (res.textId) all.add(res.textId); break; }
        case 9: l = cycleShape(l, pick().id); break;
      }
      assert.deepEqual(new Set(ids(l)), all, `run ${run} step ${step}: blocks lost or added`);
      assert.equal(ids(l).length, all.size);
      assert.deepEqual(normalizeBlocks(l), l, `run ${run} step ${step}: not normalized`);
      for (const it of layoutFlow(l)) {
        if (it.kind !== "row" || it.carousel) continue;
        const used = it.images.length * it.size + (it.cells.some((c) => c.kind === "text") ? 25 : 0);
        assert.ok(used <= 100, `run ${run} step ${step}: line overfilled ${used}`);
        assert.ok(it.images.every((x) => x.width === it.size), "one size per row");
        assert.ok(it.cells.filter((c) => c.kind === "text").length <= 1, "one text column");
      }
    }
  }
});
