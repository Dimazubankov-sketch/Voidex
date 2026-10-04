import { test } from "node:test";
import assert from "node:assert/strict";
import { block, demoProject, slide, space, validWorkspace, type Workspace } from "../src/features/notes/model.ts";

const ws = (src?: string): Workspace => {
  const s = space("Заметка");
  if (src) s.slides[0]!.blocks.push({ ...block("image"), src, size: 6 });
  return { version: 1, projects: [{ id: "p", name: "Проект", cover: "lavender", updated: 0, spaces: [s] }] };
};

test("a new space is one continuous sheet by default", () => {
  const s = space("x");
  assert.equal(s.paged, false);
  assert.equal(s.mode, "notes");
  assert.equal(s.slides.length, 1);
});

test("the demo project and new pages are valid workspaces", () => {
  assert.ok(validWorkspace({ version: 1, projects: [demoProject()] }));
  const w = ws();
  w.projects[0]!.spaces[0]!.slides.push(slide());
  assert.ok(validWorkspace(w));
});

test("images must be Notes images of this server", () => {
  assert.ok(validWorkspace(ws("/api/notes/media?id=0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f")));
  assert.equal(validWorkspace(ws("/api/media?id=0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f")), false);
  assert.equal(validWorkspace(ws("https://example.com/a.png")), false);
  assert.equal(validWorkspace(ws("data:image/svg+xml,<svg/>")), false);
});

test("sizes stay on the 12-column grid", () => {
  const w = ws();
  w.projects[0]!.spaces[0]!.slides[0]!.blocks[0]!.size = 13;
  assert.equal(validWorkspace(w), false);
});
