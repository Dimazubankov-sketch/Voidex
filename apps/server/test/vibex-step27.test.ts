import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexMessageDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Тест" });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;
function upload(u: U, name: string, data: Buffer) {
  return u.d.post(`/api/vibex/files?purpose=message`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}
function download(u: U, id: string) {
  return env.app.inject({ method: "GET", url: `/api/vibex/files/${id}`, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}

const prsn = (title: string) =>
  Buffer.from(JSON.stringify({ format: "voidex.prsn", version: 1, space: { id: "s", name: title, mode: "presentation", slides: [] } }));

describe("Step 2.7 attachments: documents, pictures, audio, video and .prsn", () => {
  it("a .prsn is accepted only when it really is a VOIDEX presentation", async () => {
    const a = await user("Файлы");
    const ok = await upload(a, "Доклад.prsn", prsn("Доклад"));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ filename: "Доклад.prsn", mimeType: "application/vnd.voidex.prsn+json" });
    expect((await upload(a, "fake.prsn", Buffer.from("<html><script>alert(1)</script>"))).status).toBe(415);
    expect((await upload(a, "other.prsn", Buffer.from(JSON.stringify({ format: "other", version: 1, space: {} })))).status).toBe(415);
  });

  it("files reach the other person and only the chat's members can download them", async () => {
    const [a, b, c] = [await user("Отправитель"), await user("Получатель"), await user("Посторонний")];
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const files = [
      await upload(a, "заметка.txt", Buffer.from("Привет из Файлов")),
      await upload(a, "Доклад.prsn", prsn("Доклад")),
      await upload(a, "фото.png", png),
      await upload(a, "голос.mp3", Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0])),
      await upload(a, "клип.mp4", Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(16)])),
    ];
    for (const f of files) expect(f.status).toBe(201);
    // Someone else cannot attach these uploads (ownership).
    expect((await c.d.post(`/api/vibex/chats/direct`, { userId: a.id })).status).toBeLessThan(300);
    const stolen = await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [files[0]!.body.id] });
    expect(stolen.status).toBeGreaterThanOrEqual(400);

    const m = (await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "Из Файлов и Медиатеки", fileIds: files.map((f) => f.body.id) })).body as VibexMessageDto;
    expect(m.files.map((f) => f.mimeType)).toEqual(["text/plain", "application/vnd.voidex.prsn+json", "image/png", "audio/mpeg", "video/mp4"]);
    const got = await download(b, files[1]!.body.id);
    expect(got.statusCode).toBe(200);
    expect(JSON.parse(got.body).format).toBe("voidex.prsn");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect((await download(c, files[0]!.body.id)).statusCode).toBe(404);
  });

  it("refuses types outside the allow-list and files over the limit", async () => {
    const a = await user("Лимит");
    expect((await upload(a, "run.exe", Buffer.from("MZ"))).status).toBe(415);
    expect((await upload(a, "big.txt", Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))).status).toBe(413);
  });
});
