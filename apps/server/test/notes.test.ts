import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const GIF = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Заметки" });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;

const uid = () => crypto.randomUUID();
function space(name: string, opts: { src?: string; speaker?: string } = {}) {
  return {
    id: uid(),
    name,
    cover: "lavender",
    mode: "notes",
    format: "both",
    flow: "vertical",
    paged: false,
    updated: Date.now(),
    slides: [
      {
        id: uid(),
        background: "white",
        transition: "fade",
        speaker: opts.speaker ?? "",
        blocks: [
          { id: uid(), kind: "heading", text: name, size: 12, align: "left" },
          ...(opts.src ? [{ id: uid(), kind: "image", text: "", src: opts.src, size: 6, align: "left" }] : []),
        ],
      },
    ],
  };
}
const workspace = (...spaces: ReturnType<typeof space>[]) => ({ version: 1, projects: [{ id: uid(), name: "Проект", cover: "lavender", updated: Date.now(), spaces }] });

function upload(u: U, data: Buffer, type = "image/png") {
  return u.d.post("/api/notes/media", data, { headers: { "content-type": type } });
}
function media(u: U, url: string) {
  return env.app.inject({ method: "GET", url, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}

describe("Voidex Notes storage (Step 2.5)", () => {
  it("requires sign-in", async () => {
    const d = new Device(env.app);
    expect((await d.get("/api/notes")).status).toBe(401);
    expect((await d.put("/api/notes", { data: workspace(), revision: 0 })).status).toBe(401);
    expect((await d.post("/api/notes/shares", { data: space("x") })).status).toBe(401);
  });

  it("load / save with revisions: a stale save is refused, never overwrites", async () => {
    const a = await user("Анна");
    expect((await a.d.get("/api/notes")).body).toEqual({ data: { version: 1, projects: [] }, revision: 0 });
    const first = await a.d.put("/api/notes", { data: workspace(space("Один")), revision: 0 });
    expect(first.status).toBe(200);
    expect(first.body.revision).toBe(1);
    // Device 2 (same revision 0) can't create over it.
    const stale = await a.d.put("/api/notes", { data: workspace(space("Чужой")), revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "notes_conflict", details: { revision: 1 } });
    const second = await a.d.put("/api/notes", { data: workspace(space("Два")), revision: 1 });
    expect(second.body.revision).toBe(2);
    expect((await a.d.put("/api/notes", { data: workspace(space("Старое")), revision: 1 })).status).toBe(409);
    const loaded = await a.d.get("/api/notes");
    expect(loaded.body.revision).toBe(2);
    expect(JSON.stringify(loaded.body.data)).toContain("Два");
    expect(JSON.stringify(loaded.body.data)).not.toContain("Старое");
  });

  it("rejects malformed documents and pictures from elsewhere", async () => {
    const a = await user("Борис");
    expect((await a.d.put("/api/notes", { data: { version: 2, projects: [] }, revision: 0 })).status).toBe(400);
    expect((await a.d.put("/api/notes", { data: "x", revision: 0 })).status).toBe(400);
    const external = workspace(space("x", { src: "https://evil.example/a.png" }));
    expect((await a.d.put("/api/notes", { data: external, revision: 0 })).status).toBe(400);
    const dataUrl = workspace(space("x", { src: "data:image/svg+xml;base64,PHN2Zz4=" }));
    expect((await a.d.put("/api/notes", { data: dataUrl, revision: 0 })).status).toBe(400);
    expect((await a.d.put("/api/notes", { data: workspace(), revision: -1 })).status).toBe(400);
  });

  it("images: JPEG/PNG/WebP/GIF only (by content), never SVG", async () => {
    const a = await user("Вера");
    expect((await upload(a, SVG, "image/png")).status).toBe(415);
    expect((await upload(a, Buffer.from("not an image"), "application/octet-stream")).status).toBe(415);
    const png = await upload(a, PNG);
    expect(png.status).toBe(201);
    expect(png.body.url).toMatch(/^\/api\/notes\/media\?id=[0-9a-f-]{36}$/);
    const gif = await upload(a, GIF, "image/gif");
    expect(gif.status).toBe(201);
    const res = await media(a, png.body.url);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("isolation: B can't read, overwrite or see A's notes, images or shares", async () => {
    const a = await user("Алиса");
    const b = await user("Боб");
    const img = (await upload(a, PNG)).body.url as string;
    const secret = space("Секрет Алисы", { src: img, speaker: "только для меня" });
    await a.d.put("/api/notes", { data: workspace(secret), revision: 0 });

    // B's own document is separate; saving it never touches A's.
    expect((await b.d.get("/api/notes")).body.revision).toBe(0);
    await b.d.put("/api/notes", { data: workspace(space("Боб")), revision: 0 });
    expect(JSON.stringify((await a.d.get("/api/notes")).body.data)).toContain("Секрет Алисы");
    expect(JSON.stringify((await b.d.get("/api/notes")).body.data)).not.toContain("Секрет");
    // A client-sent user id is ignored.
    const spoof = await b.d.put("/api/notes?userId=" + a.id, { data: workspace(space("Подмена")), revision: 1, userId: a.id });
    expect(spoof.status).toBe(200);
    expect(JSON.stringify((await a.d.get("/api/notes")).body.data)).not.toContain("Подмена");

    // A's image is not B's.
    expect((await media(b, img)).statusCode).toBe(404);
    // B referencing A's image in B's own notes doesn't give access either.
    await b.d.put("/api/notes", { data: workspace(space("Кража", { src: img })), revision: 2 });
    expect((await media(b, img)).statusCode).toBe(404);
    // …nor does B sharing it.
    const bShare = await b.d.post("/api/notes/shares", { data: space("Кража", { src: img }) });
    expect(bShare.status).toBe(201);
    expect((await media(b, img)).statusCode).toBe(404);

    // A shares: speaker notes are removed, the image becomes readable through the share.
    const share = await a.d.post("/api/notes/shares", { data: secret });
    expect(share.status).toBe(201);
    const token = share.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const read = await b.d.get(`/api/notes/shares/${token}`);
    expect(read.status).toBe(200);
    expect(read.body.name).toBe("Секрет Алисы");
    expect(JSON.stringify(read.body)).not.toContain("только для меня");
    expect((await media(b, img)).statusCode).toBe(200);

    // Shares list: own only. B can't revoke A's share.
    expect((await b.d.get("/api/notes/shares")).body.map((s: { token: string }) => s.token)).not.toContain(token);
    expect((await a.d.get("/api/notes/shares")).body[0]).toMatchObject({ token, name: "Секрет Алисы" });
    expect((await b.d.delete(`/api/notes/shares/${token}`)).status).toBe(404);
    expect((await b.d.get(`/api/notes/shares/${token}`)).status).toBe(200);
    // A revokes: the link and the image access end.
    expect((await a.d.delete(`/api/notes/shares/${token}`)).status).toBe(200);
    expect((await b.d.get(`/api/notes/shares/${token}`)).status).toBe(404);
    expect((await media(b, img)).statusCode).toBe(404);
    expect((await media(a, img)).statusCode).toBe(200);
    // Unknown / malformed tokens.
    expect((await b.d.get(`/api/notes/shares/${"A".repeat(32)}`)).status).toBe(404);
    expect((await b.d.get(`/api/notes/shares/..%2F..`)).status).toBe(400);
  });

  it("shares are snapshots: later edits don't leak", async () => {
    const a = await user("Даша");
    const b = await user("Гена");
    const s = space("Версия 1");
    await a.d.put("/api/notes", { data: workspace(s), revision: 0 });
    const token = (await a.d.post("/api/notes/shares", { data: s })).body.token;
    await a.d.put("/api/notes", { data: workspace({ ...s, name: "Версия 2" }), revision: 1 });
    expect((await b.d.get(`/api/notes/shares/${token}`)).body.name).toBe("Версия 1");
    // Only a space or a project can be shared.
    expect((await a.d.post("/api/notes/shares", { data: { version: 1, projects: [] } })).status).toBe(400);
  });
});
