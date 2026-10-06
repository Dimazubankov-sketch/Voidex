import { test } from "node:test";
import assert from "node:assert/strict";
import { addPage, block, deleteOrClearPage, isPaged, pageHasContent, mergePages, noteToPresentation, reflowPresentation, removePage, slideOverflows, splitAt, textFits } from "../src/document.ts";

const IMG = "/api/notes/media?id=0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f";

function note(...blocks: ReturnType<typeof block>[]) {
  return { kind: "note" as const, format: "vertical" as const, pages: [{ id: "p1", blocks }] };
}

test("a new note is one continuous sheet; pages are made by splitting, never by a page-break block", () => {
  const a = block("text", "один");
  const b = block("text", "два");
  const n = note(a, b);
  assert.equal(isPaged(n), false);
  const split = splitAt(n, b.id);
  assert.equal(split.pages.length, 2);
  assert.deepEqual(split.pages.map((p) => p.blocks.map((x) => x.text)), [["один"], ["два"]]);
  assert.ok(!JSON.stringify(split).includes("pagebreak"));
  // Splitting at the first block of a page does nothing (no empty pages).
  assert.equal(splitAt(split, a.id).pages.length, 2);
});

test("pages: add, remove (content kept), merge back into one sheet", () => {
  const n = note(block("text", "один"));
  const { note: two, page } = addPage(n);
  assert.equal(two.pages.length, 2);
  assert.equal(two.pages[1]!.id, page.id);
  two.pages[1]!.blocks[0]!.text = "вторая страница";
  const removed = removePage(two, 1);
  assert.equal(removed.pages.length, 1);
  assert.deepEqual(removed.pages[0]!.blocks.map((x) => x.text), ["один", "вторая страница"]);
  const merged = mergePages(splitAt(note(block("text", "a"), block("text", "b"), block("text", "c")), two.pages[0]!.blocks[0]!.id));
  assert.equal(merged.pages.length, 1);
});

test("page menu: a later page is deleted with its content, the first page is cleared instead", () => {
  const n = note(block("text", "один"));
  const { note: two } = addPage(n);
  two.pages[1]!.blocks[0]!.text = "вторая";
  const { note: three } = addPage(two);
  assert.equal(pageHasContent(three, 1), true);
  assert.equal(pageHasContent(three, 2), false);
  // Page 2 of 3: gone with its text; show page 1.
  const del = deleteOrClearPage(three, 1);
  assert.equal(del.cleared, false);
  assert.equal(del.show, 0);
  assert.equal(del.note.pages.length, 2);
  assert.ok(!JSON.stringify(del.note).includes("вторая"));
  // First page while others exist: cleared, the others stay.
  const first = deleteOrClearPage(three, 0);
  assert.equal(first.cleared, true);
  assert.equal(first.note.pages.length, 3);
  assert.equal(pageHasContent(first.note, 0), false);
  assert.equal(first.note.pages[0]!.id, three.pages[0]!.id);
  // The only page: cleared, never removed.
  const only = deleteOrClearPage(note(block("heading", "Заголовок"), block("text", "текст")), 0);
  assert.equal(only.cleared, true);
  assert.equal(only.note.pages.length, 1);
  assert.equal(only.note.pages[0]!.blocks.length, 1);
  assert.equal(only.note.pages[0]!.blocks[0]!.text, "");
});

test("Note → Presentation: headings become slide titles, text and lists the slide text, pictures slide pictures", () => {
  const n = {
    kind: "note" as const,
    format: "vertical" as const,
    pages: [
      { id: "p1", blocks: [block("heading", "Проблема"), block("text", "Слишком много приложений."), block("bullet", "Почта"), block("bullet", "Чаты")] },
      { id: "p2", blocks: [block("heading", "Решение"), { ...block("image", "Скриншот"), src: IMG }, block("text", "Одно пространство.")] },
    ],
  };
  const original = JSON.stringify(n);
  const p = noteToPresentation(n, "VOIDEX");
  assert.equal(JSON.stringify(n), original, "the note itself is not changed");
  assert.equal(p.kind, "presentation");
  assert.deepEqual(p.slides.map((s) => s.layers.find((l) => l.kind === "title")?.text ?? ""), ["VOIDEX", "Проблема", "Решение"]);
  const problem = p.slides[1]!.layers.find((l) => l.kind === "text")!;
  assert.match(problem.text, /Слишком много приложений\.\n• Почта\n• Чаты/);
  const solution = p.slides[2]!;
  assert.equal(solution.layers.find((l) => l.kind === "image")!.src, IMG);
  for (const s of p.slides) for (const l of s.layers) assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= 100.01 && l.y + l.h <= 100.01, "inside the slide");
});

test("Note → Presentation: a long continuous note without headings is cut into readable slides; page breaks start slides", () => {
  const long = Array.from({ length: 12 }, (_, i) => block("text", `Абзац ${i} `.repeat(12)));
  const p = noteToPresentation(note(...long));
  assert.ok(p.slides.length >= 3, `got ${p.slides.length} slides`);
  const paged = noteToPresentation({ kind: "note", format: "square", pages: [{ id: "a", blocks: [block("text", "one")] }, { id: "b", blocks: [block("text", "two")] }] });
  assert.equal(paged.slides.length, 2);
  // An empty note still makes a (one-slide) presentation.
  assert.equal(noteToPresentation(note(block("text", ""))).slides.length, 1);
});

test("square ↔ widescreen keeps every layer inside the slide and warns (doesn't cut) when text no longer fits", () => {
  const p = noteToPresentation(note(block("heading", "Заголовок"), { ...block("image", ""), src: IMG }, block("text", "Короткий текст")));
  const square = reflowPresentation(p, "square");
  assert.equal(square.format, "square");
  for (const s of square.slides) for (const l of s.layers) assert.ok(l.y + l.h <= 100.01);
  const back = reflowPresentation(square, "rect");
  assert.equal(back.slides.length, p.slides.length);
  assert.equal(JSON.stringify(back.slides.map((s) => s.layers.map((l) => l.text))), JSON.stringify(p.slides.map((s) => s.layers.map((l) => l.text))));
  const crowded = { id: "t", kind: "text" as const, text: "слово ".repeat(400), x: 10, y: 10, w: 30, h: 10 };
  assert.equal(textFits(crowded, "rect"), false);
  assert.equal(slideOverflows({ id: "s", transition: "none", layers: [crowded] }, "rect"), true);
  assert.equal(textFits({ ...crowded, text: "Коротко" }, "rect"), true);
});
