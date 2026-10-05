import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ServerEvent } from "@voidex/shared";
import { notesWorkspaces } from "../src/db/schema.js";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Заметки" });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;

/** Events pushed to a user's devices. */
function listen(u: U) {
  const got: ServerEvent[] = [];
  const off = env.app.ctx.events.subscribe(u.id, "test-listener", (e) => got.push(e));
  return { got, off };
}

const uid = () => crypto.randomUUID();
const note = (text: string, src?: string) => ({
  kind: "note",
  format: "vertical",
  pages: [{ id: uid(), blocks: [{ id: uid(), kind: "text", text }, ...(src ? [{ id: uid(), kind: "image", text: "", src, width: 60 }] : [])] }],
});

async function project(u: U, name = "Проект") {
  const r = await u.d.post("/api/notes/projects", { name });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function doc(u: U, projectId: string, kind: "note" | "presentation" = "note", name = "Заметка") {
  const r = await u.d.post(`/api/notes/projects/${projectId}/documents`, { kind, name });
  expect(r.status).toBe(201);
  return r.body as { id: string; revision: number };
}
function upload(u: U, data: Buffer, type = "image/png") {
  return u.d.post("/api/notes/media", data, { headers: { "content-type": type } });
}
function media(u: U, url: string) {
  return env.app.inject({ method: "GET", url, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}

describe("Voidex Notes (Step 2.6): projects → documents", () => {
  it("requires sign-in", async () => {
    const d = new Device(env.app);
    expect((await d.get("/api/notes/projects")).status).toBe(401);
    expect((await d.post("/api/notes/projects", { name: "x" })).status).toBe(401);
    expect((await d.get(`/api/notes/documents/${uid()}`)).status).toBe(401);
  });

  it("a project holds notes and presentations directly; opening a project lists them (no spaces)", async () => {
    const a = await user("Анна");
    const p = await project(a, "Дипломная работа");
    const n = await doc(a, p, "note", "Черновик");
    const s = await doc(a, p, "presentation", "Защита");
    const detail = await a.d.get(`/api/notes/projects/${p}`);
    expect(detail.status).toBe(200);
    expect(detail.body.project).toMatchObject({ name: "Дипломная работа", role: "owner", documents: 2 });
    expect(detail.body.documents.map((d: { kind: string; name: string }) => [d.kind, d.name])).toEqual([
      ["note", "Черновик"],
      ["presentation", "Защита"],
    ]);
    expect(JSON.stringify(detail.body)).not.toContain("spaces");
    // The body is loaded only when a document is opened.
    expect(detail.body.documents[0].data).toBeUndefined();
    const opened = await a.d.get(`/api/notes/documents/${n.id}`);
    expect(opened.body).toMatchObject({ kind: "note", format: "vertical", role: "owner", projectName: "Дипломная работа" });
    expect((await a.d.get(`/api/notes/documents/${s.id}`)).body.data.kind).toBe("presentation");
    const list = await a.d.get("/api/notes/projects");
    expect(list.body.projects.map((x: { name: string }) => x.name)).toContain("Дипломная работа");
  });

  it("saves with revisions: a stale save is refused (409), never overwrites", async () => {
    const a = await user("Борис");
    const p = await project(a);
    const n = await doc(a, p);
    const first = await a.d.put(`/api/notes/documents/${n.id}`, { data: note("один"), revision: n.revision });
    expect(first.status).toBe(200);
    expect(first.body.revision).toBe(n.revision + 1);
    const stale = await a.d.put(`/api/notes/documents/${n.id}`, { data: note("чужое"), revision: n.revision });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "notes_conflict", details: { revision: n.revision + 1 } });
    expect(JSON.stringify((await a.d.get(`/api/notes/documents/${n.id}`)).body.data)).toContain("один");
    // Invalid bodies (wrong shape, foreign image hosts) are refused.
    expect((await a.d.put(`/api/notes/documents/${n.id}`, { data: { kind: "note", format: "vertical", pages: [] }, revision: first.body.revision })).status).toBe(400);
    const evil = note("x");
    (evil.pages[0]!.blocks as unknown[]).push({ id: uid(), kind: "image", text: "", src: "https://evil.example/a.png" });
    expect((await a.d.put(`/api/notes/documents/${n.id}`, { data: evil, revision: first.body.revision })).status).toBe(400);
  });

  it("rename, cover add / remove for projects and documents", async () => {
    const a = await user("Вера");
    const p = await project(a, "Старое");
    const n = await doc(a, p);
    const img = (await upload(a, PNG)).body.url as string;
    expect((await a.d.patch(`/api/notes/projects/${p}`, { name: "Новое", cover: img })).status).toBe(200);
    expect((await a.d.patch(`/api/notes/documents/${n.id}`, { name: "Имя", cover: img })).status).toBe(200);
    let detail = (await a.d.get(`/api/notes/projects/${p}`)).body;
    expect(detail.project).toMatchObject({ name: "Новое", cover: img });
    expect(detail.documents[0]).toMatchObject({ name: "Имя", cover: img });
    expect((await a.d.patch(`/api/notes/documents/${n.id}`, { cover: null })).status).toBe(200);
    detail = (await a.d.get(`/api/notes/projects/${p}`)).body;
    expect(detail.documents[0].cover).toBeNull();
    // Only Notes images on this server.
    expect((await a.d.patch(`/api/notes/projects/${p}`, { cover: "https://evil.example/x.png" })).status).toBe(400);
  });

  it("images: JPEG/PNG/WebP/GIF by content, never SVG; private until shared", async () => {
    const a = await user("Глеб");
    const b = await user("Дина");
    expect((await upload(a, SVG, "image/png")).status).toBe(415);
    const img = (await upload(a, PNG)).body.url as string;
    expect((await media(a, img)).statusCode).toBe(200);
    expect((await media(b, img)).statusCode).toBe(404);
    // B can't put A's image into B's own document either.
    const pb = await project(b);
    const nb = await doc(b, pb);
    expect((await b.d.put(`/api/notes/documents/${nb.id}`, { data: note("x", img), revision: nb.revision })).status).toBe(400);
  });
});

describe("Notes ACL (User A vs User B)", () => {
  it("B can't open, edit, upload into, rename, list members of or delete A's private project / note", async () => {
    const a = await user("Ева");
    const b = await user("Жора");
    const p = await project(a, "Секрет");
    const n = await doc(a, p);
    expect((await b.d.get(`/api/notes/projects/${p}`)).status).toBe(404);
    expect((await b.d.get(`/api/notes/documents/${n.id}`)).status).toBe(404);
    expect((await b.d.put(`/api/notes/documents/${n.id}`, { data: note("взлом"), revision: n.revision })).status).toBe(404);
    expect((await b.d.patch(`/api/notes/projects/${p}`, { name: "Моё" })).status).toBe(404);
    expect((await b.d.patch(`/api/notes/documents/${n.id}`, { name: "Моё" })).status).toBe(404);
    expect((await b.d.post(`/api/notes/projects/${p}/documents`, { kind: "note", name: "x" })).status).toBe(404);
    expect((await b.d.get(`/api/notes/access/project/${p}`)).status).toBe(404);
    expect((await b.d.delete(`/api/notes/access/project/${p}/${a.id}`)).status).toBe(404);
    expect((await b.d.delete(`/api/notes/documents/${n.id}`)).status).toBe(404);
    expect((await b.d.delete(`/api/notes/projects/${p}`)).status).toBe(404);
    expect((await b.d.post("/api/notes/shares", { resourceType: "project", resourceId: p, mode: "access", role: "editor" })).status).toBe(404);
    expect((await b.d.get("/api/notes/projects")).body.projects.map((x: { id: string }) => x.id)).not.toContain(p);
    expect((await a.d.get(`/api/notes/documents/${n.id}`)).body.name).toBe("Заметка");
  });
});

describe("Notes sharing: a copy vs access to the original", () => {
  it("COPY: B opens the link, adds a copy, edits it; A's original is unchanged (and the other way round)", async () => {
    const a = await user("Зоя");
    const b = await user("Иван");
    const p = await project(a, "Идеи");
    const n = await doc(a, p, "note", "Идеи продукта");
    const img = (await upload(a, PNG)).body.url as string;
    const saved = await a.d.put(`/api/notes/documents/${n.id}`, { data: note("оригинал", img), revision: n.revision });
    const share = await a.d.post("/api/notes/shares", { resourceType: "document", resourceId: n.id, mode: "copy" });
    expect(share.status).toBe(201);
    expect(share.body.card).toMatchObject({ title: "Идеи продукта", ext: ".txt", kind: "note" });
    const token = share.body.token as string;
    expect(token.length).toBeGreaterThanOrEqual(32);
    // The link alone shows no content and no access to the original.
    const info = await b.d.get(`/api/notes/shares/${token}`);
    expect(info.body).toMatchObject({ mode: "copy", kind: "note", name: "Идеи продукта", ext: ".txt", access: "none" });
    expect(info.body.documentId).toBeUndefined();
    expect(JSON.stringify(info.body)).not.toContain("оригинал");
    const accepted = await b.d.post(`/api/notes/shares/${token}/accept`, {});
    expect(accepted.status).toBe(200);
    const copy = await b.d.get(`/api/notes/documents/${accepted.body.documentId}`);
    expect(copy.body).toMatchObject({ role: "owner", name: "Идеи продукта", projectName: "Полученные" });
    expect(JSON.stringify(copy.body.data)).toContain("оригинал");
    // The copy's picture is B's own now (independent of A).
    const copyImg = copy.body.data.pages[0].blocks[1].src as string;
    expect(copyImg).not.toBe(img);
    expect((await media(b, copyImg)).statusCode).toBe(200);
    // B edits the copy: A's original stays as it was; A's edits don't reach B's copy.
    expect((await b.d.put(`/api/notes/documents/${copy.body.id}`, { data: note("копия Б", copyImg), revision: copy.body.revision })).status).toBe(200);
    expect(JSON.stringify((await a.d.get(`/api/notes/documents/${n.id}`)).body.data)).toContain("оригинал");
    await a.d.put(`/api/notes/documents/${n.id}`, { data: note("правка А"), revision: saved.body.revision });
    expect(JSON.stringify((await b.d.get(`/api/notes/documents/${copy.body.id}`)).body.data)).toContain("копия Б");
    // B still can't open A's original.
    expect((await b.d.get(`/api/notes/documents/${n.id}`)).status).toBe(404);
  });

  it("ACCESS (edit): B edits the original, A sees it; a viewer can't save; revoking closes it right away", async () => {
    const a = await user("Карина");
    const b = await user("Лев");
    const c = await user("Мила");
    const p = await project(a, "Общий");
    const n = await doc(a, p, "note", "Совместная");
    const share = await a.d.post("/api/notes/shares", { resourceType: "document", resourceId: n.id, mode: "access", role: "editor" });
    const token = share.body.token as string;
    const aEvents = listen(a);
    const bEvents = listen(b);
    const accepted = await b.d.post(`/api/notes/shares/${token}/accept`, {});
    expect(accepted.body.documentId).toBe(n.id);
    const opened = await b.d.get(`/api/notes/documents/${n.id}`);
    expect(opened.body.role).toBe("editor");
    const saved = await b.d.put(`/api/notes/documents/${n.id}`, { data: note("Б написал"), revision: opened.body.revision });
    expect(saved.status).toBe(200);
    expect(JSON.stringify((await a.d.get(`/api/notes/documents/${n.id}`)).body.data)).toContain("Б написал");
    expect(aEvents.got).toContainEqual(expect.objectContaining({ type: "notes.document.updated", documentId: n.id, byUserId: b.id }));
    // Shared document appears in B's list (outside A's project, which B can't open).
    expect((await b.d.get("/api/notes/projects")).body.sharedDocuments.map((d: { id: string }) => d.id)).toContain(n.id);
    expect((await b.d.get(`/api/notes/projects/${p}`)).status).toBe(404);
    // Editors can't delete the original or share it further.
    expect((await b.d.delete(`/api/notes/documents/${n.id}`)).status).toBe(403);
    expect((await b.d.post("/api/notes/shares", { resourceType: "document", resourceId: n.id, mode: "copy" })).status).toBe(403);
    // Users tab: owner first, then B as editor; owner makes B a viewer.
    const members = await a.d.get(`/api/notes/access/document/${n.id}`);
    expect(members.body.map((m: { id: string; role: string }) => [m.id, m.role])).toEqual([
      [a.id, "owner"],
      [b.id, "editor"],
    ]);
    expect((await b.d.patch(`/api/notes/access/document/${n.id}/${b.id}`, { role: "editor" })).status).toBe(403);
    expect((await a.d.patch(`/api/notes/access/document/${n.id}/${b.id}`, { role: "viewer" })).status).toBe(200);
    const asViewer = await b.d.put(`/api/notes/documents/${n.id}`, { data: note("ещё"), revision: saved.body.revision });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.code).toBe("notes_access_revoked");
    // C (another link holder) gets editor via the link; the owner removes C: the next write is rejected, C is told now.
    await c.d.post(`/api/notes/shares/${token}/accept`, {});
    const cDoc = await c.d.get(`/api/notes/documents/${n.id}`);
    const cEvents = listen(c);
    expect((await a.d.delete(`/api/notes/access/document/${n.id}/${c.id}`)).status).toBe(200);
    expect(cEvents.got).toContainEqual(expect.objectContaining({ type: "notes.access.revoked", resourceType: "document", resourceId: n.id }));
    expect((await c.d.put(`/api/notes/documents/${n.id}`, { data: note("после отзыва"), revision: cDoc.body.revision })).status).toBe(404);
    expect((await c.d.get(`/api/notes/documents/${n.id}`)).status).toBe(404);
    // The owner revokes the link: nobody new can use it.
    expect((await a.d.delete(`/api/notes/shares/${token}`)).status).toBe(200);
    expect((await c.d.post(`/api/notes/shares/${token}/accept`, {})).status).toBe(410);
    // Deleting the original tells everyone who had it.
    expect((await a.d.delete(`/api/notes/documents/${n.id}`)).status).toBe(200);
    expect(bEvents.got).toContainEqual(expect.objectContaining({ type: "notes.resource.deleted", resourceId: n.id }));
    aEvents.off();
    bEvents.off();
    cEvents.off();
  });

  it("a whole project can be shared (access) and copied; presentations are .prsn cards", async () => {
    const a = await user("Нина");
    const b = await user("Олег");
    const p = await project(a, "VOIDEX");
    await doc(a, p, "note", "План");
    const deck = await doc(a, p, "presentation", "VOIDEX Pitch");
    const img = (await upload(a, PNG)).body.url as string;
    await a.d.patch(`/api/notes/projects/${p}`, { cover: img });
    const card = await a.d.post("/api/notes/shares", { resourceType: "document", resourceId: deck.id, mode: "copy" });
    expect(card.body.card).toMatchObject({ title: "VOIDEX Pitch", ext: ".prsn", kind: "presentation" });
    const proj = await a.d.post("/api/notes/shares", { resourceType: "project", resourceId: p, mode: "access", role: "viewer", recipientIds: [b.id] });
    expect(proj.body.card).toMatchObject({ title: "VOIDEX", ext: ".txt", kind: "project" });
    // Sent to B directly: already in B's list, read-only.
    const list = await b.d.get("/api/notes/projects");
    expect(list.body.projects.find((x: { id: string }) => x.id === p)).toMatchObject({ role: "viewer", name: "VOIDEX" });
    const detail = await b.d.get(`/api/notes/projects/${p}`);
    expect(detail.body.documents).toHaveLength(2);
    expect((await media(b, img)).statusCode).toBe(200);
    expect((await b.d.put(`/api/notes/documents/${deck.id}`, { data: { kind: "presentation", format: "rect", slides: [{ id: uid(), transition: "fade", layers: [] }] }, revision: deck.revision })).status).toBe(403);
    expect((await b.d.patch(`/api/notes/projects/${p}`, { name: "Моё" })).status).toBe(403);
    // B may also make an own copy of the whole project.
    const copied = await b.d.post(`/api/notes/shares/${proj.body.token}/accept`, { copy: true });
    const mine = await b.d.get(`/api/notes/projects/${copied.body.projectId}`);
    expect(mine.body.project).toMatchObject({ role: "owner", name: "VOIDEX", documents: 2 });
    expect(mine.body.project.cover).not.toBe(img);
  });
});

describe("Step 2.5 data is converted without loss", () => {
  it("projects → spaces become projects → documents on first open; images, order and names kept; the old JSON stays", async () => {
    const a = await user("Пётр");
    const img = (await upload(a, PNG)).body.url as string;
    const space = (id: string, name: string, mode: "notes" | "presentation", text: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      cover: "lavender",
      mode,
      format: "both",
      flow: "vertical",
      paged: false,
      updated: 1,
      slides: [{ id: uid(), background: "white", transition: "fade", speaker: "", blocks: [{ id: uid(), kind: "text", text, size: 12, align: "left" }, { id: uid(), kind: "image", text: "", src: img, size: 6, align: "left" }] }],
      ...extra,
    });
    const legacy = {
      version: 1,
      projects: [
        { id: "p-1", name: "Работа", cover: img, updated: 1, spaces: [space("s-1", "Идеи", "notes", "первая"), space("s-2", "Идеи", "notes", "вторая"), space("s-3", "Питч", "presentation", "слайд")] },
        { id: "p-2", name: "Дом", cover: "milk", updated: 1, spaces: [space("s-4", "Покупки", "notes", "молоко")] },
      ],
    };
    await env.app.ctx.db.insert(notesWorkspaces).values({ userId: a.id, data: legacy, revision: 7 });
    const list = await a.d.get("/api/notes/projects");
    const names = list.body.projects.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Работа", "Дом"]));
    const work = list.body.projects.find((p: { name: string }) => p.name === "Работа");
    expect(work).toMatchObject({ documents: 3, cover: img, role: "owner" });
    const detail = await a.d.get(`/api/notes/projects/${work.id}`);
    expect(detail.body.documents.map((d: { name: string; kind: string }) => [d.name, d.kind])).toEqual([
      ["Идеи", "note"],
      ["Идеи (2)", "note"],
      ["Питч", "presentation"],
    ]);
    const first = await a.d.get(`/api/notes/documents/${detail.body.documents[0].id}`);
    expect(JSON.stringify(first.body.data)).toContain("первая");
    expect(JSON.stringify(first.body.data)).toContain(img);
    // Idempotent: a second open (another device) doesn't duplicate anything; the old JSON is kept.
    const again = await a.d.get("/api/notes/projects");
    expect(again.body.projects.filter((p: { name: string }) => p.name === "Работа")).toHaveLength(1);
    const [row] = await env.app.ctx.db.select().from(notesWorkspaces).where(eq(notesWorkspaces.userId, a.id));
    expect(row!.migratedAt).not.toBeNull();
    expect(row!.data).toEqual(legacy);
  });
});

describe("Notes share cards in Vibex and VoidOps", () => {
  it("a Vibex message carries a .txt card; the recipient sees title and type, opening still checks access", async () => {
    const a = await user("Рита");
    const b = await user("Семён");
    const p = await project(a, "Совет");
    const n = await doc(a, p, "note", "Идеи продукта");
    const share = await a.d.post("/api/notes/shares", { resourceType: "document", resourceId: n.id, mode: "copy" });
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body;
    const sent = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { notesToken: share.body.token });
    expect(sent.status).toBe(201);
    expect(sent.body.notesCard).toMatchObject({ token: share.body.token, title: "Идеи продукта", ext: ".txt", kind: "note" });
    const seen = await b.d.get(`/api/vibex/chats/${chat.id}/messages`);
    expect(seen.body.items[0].notesCard).toMatchObject({ title: "Идеи продукта", ext: ".txt" });
    expect((await b.d.get(`/api/notes/documents/${n.id}`)).status).toBe(404);
  });

  it("a VoidOps letter carries .txt / .prsn cards to the recipient", async () => {
    const a = await user("Тимур");
    const b = await user("Ульяна");
    const p = await project(a, "Доклад");
    const deck = await doc(a, p, "presentation", "VOIDEX Pitch");
    const share = await a.d.post("/api/notes/shares", { resourceType: "document", resourceId: deck.id, mode: "access", role: "viewer" });
    const me = (await b.d.get("/api/me")).body;
    const draft = await a.d.post("/api/mail/drafts", { to: [me.mailAddress], subject: "Презентация", body: "Смотри", notesTokens: [share.body.token] });
    expect(draft.status).toBe(201);
    expect(draft.body.notesCards).toEqual([expect.objectContaining({ title: "VOIDEX Pitch", ext: ".prsn", kind: "presentation" })]);
    expect((await a.d.post(`/api/mail/drafts/${draft.body.id}/send`, {})).status).toBe(200);
    const inbox = await b.d.get("/api/mail/threads?view=inbox");
    const thread = await b.d.get(`/api/mail/threads/${inbox.body.items[0].id}`);
    expect(thread.body.messages.at(-1).notesCards[0]).toMatchObject({ ext: ".prsn", title: "VOIDEX Pitch" });
    // The card opens it: access link → B becomes a viewer.
    expect((await b.d.post(`/api/notes/shares/${share.body.token}/accept`, {})).body.documentId).toBe(deck.id);
    expect((await b.d.get(`/api/notes/documents/${deck.id}`)).body.role).toBe("viewer");
  });

  it("list preferences are per person", async () => {
    const a = await user("Фёдор");
    expect((await a.d.get("/api/notes/prefs")).body).toMatchObject({ projectsView: "grid" });
    expect((await a.d.put("/api/notes/prefs", { projectsView: "list", docsSort: "name" })).body).toMatchObject({ projectsView: "list", docsSort: "name" });
    expect((await a.d.get("/api/notes/prefs")).body).toMatchObject({ projectsView: "list", docsSort: "name" });
    expect((await a.d.put("/api/notes/prefs", { projectsView: "table" })).status).toBe(400);
  });
});
