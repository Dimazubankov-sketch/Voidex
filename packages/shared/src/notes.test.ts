import { describe, expect, it } from "vitest";
import {
  emptyNote,
  emptyPresentation,
  legacySnapshot,
  legacyWorkspace,
  notesExt,
  notesMediaId,
  notesMediaIds,
  notesPreview,
  uniqueNames,
  validNoteBody,
  validPresentationBody,
} from "./notes.js";

const id = "0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f";
const media = `/api/notes/media?id=${id}`;

/** A Step 2.5 workspace: project → spaces (a continuous note, a paged note, a presentation). */
const oldWorkspace = () => ({
  version: 1,
  projects: [
    {
      id: "p1",
      name: "Работа",
      cover: media,
      updated: 1,
      spaces: [
        {
          id: "s1",
          name: "Идеи",
          cover: "lavender",
          mode: "notes",
          format: "both",
          flow: "vertical",
          paged: false,
          slides: [
            { id: "a", background: "white", transition: "fade", speaker: "", blocks: [{ id: "b1", kind: "heading", text: "Заголовок", size: 12, align: "left" }] },
            { id: "b", background: "milk", transition: "fade", speaker: "", blocks: [{ id: "b2", kind: "image", text: "фото", src: media, size: 6, align: "left" }, { id: "b3", kind: "checklist", text: "Сделать", checked: true, size: 12, align: "left" }] },
          ],
        },
        {
          id: "s2",
          name: "Идеи",
          cover: "milk",
          mode: "notes",
          format: "both",
          flow: "horizontal",
          paged: true,
          slides: [
            { id: "c", background: "white", transition: "fade", speaker: "", blocks: [{ id: "c1", kind: "text", text: "Первая", size: 12, align: "left" }] },
            { id: "d", background: "white", transition: "fade", speaker: "", blocks: [{ id: "d1", kind: "text", text: "Вторая", size: 12, align: "left" }] },
          ],
        },
        {
          id: "s3",
          name: "Питч",
          cover: "wave",
          mode: "presentation",
          format: "landscape",
          flow: "vertical",
          paged: true,
          slides: [{ id: "e", background: "wave", transition: "zoom", speaker: "секрет", blocks: [{ id: "e1", kind: "heading", text: "VOIDEX", size: 12, align: "center" }] }],
        },
      ],
    },
  ],
});

describe("Notes document checks (Step 2.6)", () => {
  it("accepts only Notes media paths on this server", () => {
    expect(notesMediaId(media)).toBe(id);
    expect(notesMediaId("https://evil.example/x.png")).toBeNull();
    expect(notesMediaId("data:image/png;base64,AAAA")).toBeNull();
    expect([...notesMediaIds({ cover: media, pages: [{ blocks: [{ src: media }] }] })]).toEqual([id]);
  });

  it("validates note and presentation bodies", () => {
    expect(validNoteBody(emptyNote())).toBe(true);
    expect(validNoteBody(emptyNote("square"))).toBe(true);
    expect(validPresentationBody(emptyPresentation())).toBe(true);
    expect(validNoteBody({ ...emptyNote(), format: "diagonal" })).toBe(false);
    expect(validNoteBody({ ...emptyNote(), pages: [] })).toBe(false);
    const bad = emptyNote();
    bad.pages[0]!.blocks.push({ id: "x", kind: "image", text: "", src: "https://evil.example/a.png" });
    expect(validNoteBody(bad)).toBe(false);
    const p = emptyPresentation();
    p.slides[0]!.transition = "spin" as never;
    expect(validPresentationBody(p)).toBe(false);
  });

  it("file-card extensions: presentations .prsn, notes and projects .txt", () => {
    expect(notesExt("presentation")).toBe(".prsn");
    expect(notesExt("note")).toBe(".txt");
    expect(notesExt("project")).toBe(".txt");
  });
});

describe("Step 2.5 workspace → projects with documents (no spaces)", () => {
  it("every space becomes a document of its project, in order, nothing lost", () => {
    const [p] = legacyWorkspace(oldWorkspace());
    expect(p!.name).toBe("Работа");
    expect(p!.cover).toBe(media);
    expect(p!.documents.map((d) => [d.kind, d.name])).toEqual([
      ["note", "Идеи"],
      ["note", "Идеи (2)"], // same name in one project: kept apart, not merged or dropped
      ["presentation", "Питч"],
    ]);
    const [continuous, paged, deck] = p!.documents;
    // A continuous note stays one sheet with all its blocks (image and checked item kept).
    expect(continuous!.data.kind).toBe("note");
    expect(validNoteBody(continuous!.data)).toBe(true);
    if (continuous!.data.kind === "note") {
      expect(continuous!.data.pages).toHaveLength(1);
      expect(continuous!.data.pages[0]!.blocks.map((b) => b.kind)).toEqual(["heading", "image", "checklist"]);
      expect(continuous!.data.pages[0]!.blocks[1]).toMatchObject({ src: media, width: 50 });
      expect(continuous!.data.pages[0]!.blocks[2]).toMatchObject({ checked: true });
      expect(continuous!.data.format).toBe("vertical");
    }
    // A paged note keeps its pages; sideways flow becomes the square format.
    if (paged!.data.kind === "note") {
      expect(paged!.data.pages).toHaveLength(2);
      expect(paged!.data.format).toBe("square");
    }
    // Presentations keep slides; old covers that were backgrounds become "no cover".
    expect(validPresentationBody(deck!.data)).toBe(true);
    if (deck!.data.kind === "presentation") {
      expect(deck!.data.slides[0]!.transition).toBe("scale");
      expect(deck!.data.slides[0]!.layers[0]).toMatchObject({ kind: "title", text: "VOIDEX" });
    }
    expect(deck!.cover).toBeNull();
    expect(notesPreview(continuous!.data)).toContain("Заголовок");
  });

  it("old share snapshots (a space or a project) can still be copied", () => {
    const ws = oldWorkspace();
    expect(legacySnapshot(ws.projects[0])!.documents).toHaveLength(3);
    const one = legacySnapshot(ws.projects[0]!.spaces[2]);
    expect(one!.documents).toHaveLength(1);
    expect(one!.documents[0]!.kind).toBe("presentation");
  });

  it("unique names never collide", () => {
    expect(uniqueNames([{ name: "A" }, { name: "a" }, { name: "A" }, { name: "B" }]).map((x) => x.name)).toEqual(["A", "a (2)", "A (3)", "B"]);
  });
});
