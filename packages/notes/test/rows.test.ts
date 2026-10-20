import { test } from "node:test";
import assert from "node:assert/strict";
import { asRow, joinRow, layoutBlocks, leaveRow, moveInPage, rowExtent, setRowLook } from "../src/document.ts";
import type { NoteBlock } from "@voidex/shared";

const IMG = "/api/notes/media?id=0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f";
const img = (id: string, row?: string): NoteBlock => ({ id, kind: "image", text: "", src: IMG, width: 50, ...(row ? { row } : {}) });
const txt = (id: string): NoteBlock => ({ id, kind: "text", text: id });
const ids = (l: NoteBlock[]) => l.map((b) => b.id + (b.row ? `@${b.row}` : "")).join(" ");

test("images with the same row id stand in one row; text and other images stand alone", () => {
  const l = layoutBlocks([txt("t1"), img("a", "r"), img("b", "r"), img("c"), txt("t2"), img("d", "r")]);
  assert.deepEqual(
    l.map((x) => (x.kind === "row" ? `row(${x.blocks.map((b) => b.id).join(",")})` : x.block.id)),
    ["t1", "row(a,b)", "c", "t2", "d"],
  );
  assert.deepEqual(rowExtent([txt("t"), img("a", "r"), img("b", "r"), img("c", "r")], 2), [1, 3]);
});

test("join the previous image's row, step out of it, back to a line of its own", () => {
  let l = [txt("t"), img("a"), img("b"), img("c")];
  l = joinRow(l, 2, "r1");
  assert.equal(ids(l), "t a@r1 b@r1 c");
  l = joinRow(l, 3, "r2");
  assert.equal(ids(l), "t a@r1 b@r1 c@r1");
  l = leaveRow(l, 1);
  assert.equal(ids(l), "t b@r1 c@r1 a");
  l = leaveRow(l, 1);
  // A row of one is no row.
  assert.equal(ids(l), "t c b a");
});

test("reorder inside a row; at its edge an image steps out; other blocks jump over a whole row", () => {
  const row = [txt("t"), img("a", "r"), img("b", "r"), img("c", "r"), txt("u")];
  assert.equal(ids(moveInPage(row, 1, 1)!), "t b@r a@r c@r u");
  assert.equal(ids(moveInPage(row, 1, -1)!), "t a b@r c@r u");
  assert.equal(ids(moveInPage(row, 3, 1)!), "t a@r b@r c u");
  assert.equal(ids(moveInPage(row, 4, -1)!), "t u a@r b@r c@r");
  assert.equal(ids(moveInPage(row, 0, 1)!), "a@r b@r c@r t u");
  assert.equal(moveInPage(row, 0, -1), null);
});

test("Step 2.16: a row shares one size and one shape; the first picture decides; pictures added together form a row", () => {
  let l: NoteBlock[] = [txt("t"), { ...img("a"), width: 80, shape: "portrait" }, img("b"), img("c")];
  l = joinRow(l, 2, "r1");
  assert.deepEqual(l.slice(1, 3).map((b) => [b.row, b.width, b.shape]), [["r1", 80, "portrait"], ["r1", 80, "portrait"]]);
  l = joinRow(l, 3, "r2");
  assert.deepEqual(l.slice(1).map((b) => [b.row, b.width, b.shape]), [["r1", 80, "portrait"], ["r1", 80, "portrait"], ["r1", 80, "portrait"]]);
  // Resizing or reshaping any of them changes them all.
  l = setRowLook(l, 3, { width: 60 });
  l = setRowLook(l, 2, { shape: "landscape" });
  assert.deepEqual(l.slice(1).map((b) => [b.width, b.shape]), [[60, "landscape"], [60, "landscape"], [60, "landscape"]]);
  assert.equal(l[0]!.width, undefined);
  const row = asRow([{ ...img("x"), width: 100 }, img("y"), img("z")], "r9");
  assert.deepEqual(row.map((b) => [b.row, b.width, b.shape]), [["r9", 100, "square"], ["r9", 100, "square"], ["r9", 100, "square"]]);
  assert.deepEqual(asRow([img("solo")], "r"), [img("solo")]);
});
