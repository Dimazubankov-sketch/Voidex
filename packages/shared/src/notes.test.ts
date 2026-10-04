import { describe, expect, it } from "vitest";
import { notesMediaId, notesMediaIds, validNotesWorkspace, withoutSpeakerNotes } from "./notes.js";

const id = "0b9d6f7e-3a8e-4b0e-9a1a-2f2b4c5d6e7f";
const ws = (src?: string) => ({
  version: 1,
  projects: [
    {
      id: "p",
      name: "P",
      cover: "lavender",
      spaces: [
        {
          id: "s",
          name: "S",
          cover: `/api/notes/media?id=${id}`,
          mode: "notes",
          format: "both",
          flow: "vertical",
          paged: false,
          slides: [{ id: "a", background: "white", transition: "fade", speaker: "секрет", blocks: [{ id: "b", kind: "image", text: "", size: 6, align: "left", ...(src ? { src } : {}) }] }],
        },
      ],
    },
  ],
});

describe("notes document checks", () => {
  it("accepts only Notes media paths on this server", () => {
    expect(notesMediaId(`/api/notes/media?id=${id}`)).toBe(id);
    expect(notesMediaId(`/api/media?id=${id}`)).toBeNull();
    expect(notesMediaId(`https://x/api/notes/media?id=${id}`)).toBeNull();
    expect(validNotesWorkspace(ws())).toBe(true);
    expect(validNotesWorkspace(ws("javascript:alert(1)"))).toBe(false);
    expect(validNotesWorkspace(ws("data:image/svg+xml,<svg/>"))).toBe(false);
  });
  it("collects images and strips speaker notes", () => {
    expect([...notesMediaIds(ws(`/api/notes/media?id=${id}`))]).toEqual([id]);
    const shared = withoutSpeakerNotes(ws());
    expect(JSON.stringify(shared)).not.toContain("секрет");
    expect(shared.projects[0]!.spaces[0]!.slides[0]!.speaker).toBe("");
  });
});
