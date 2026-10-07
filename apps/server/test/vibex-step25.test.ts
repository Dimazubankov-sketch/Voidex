import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexMessageDto, VibexPostDto } from "@voidex/shared";
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
const messages = async (u: U, chat: string) => (await u.d.get(`/api/vibex/chats/${chat}/messages`)).body.items as VibexMessageDto[];
function upload(u: U, name: string, data: Buffer, purpose: string) {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}
function download(u: U, id: string) {
  return env.app.inject({ method: "GET", url: `/api/vibex/files/${id}`, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}

describe("vibex: deleting own messages (Step 2.5)", () => {
  it("only the sender deletes; the message disappears completely (Step 2.8); replies keep working; files are gone", async () => {
    const [a, b, c] = [await user("Ася"), await user("Бэн"), await user("Чужой")];
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
    const file = await upload(a, "plan.txt", Buffer.from("секрет"), "message");
    const m1 = (await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "Удали меня", fileIds: [file.body.id] })).body as VibexMessageDto;
    const reply = (await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "Ответ", replyToId: m1.id })).body as VibexMessageDto;
    expect(reply.replyTo).toMatchObject({ id: m1.id, text: "Удали меня" });
    expect((await download(b, file.body.id)).statusCode).toBe(200);

    // Not the sender / not a member / unknown.
    expect((await b.d.delete(`/api/vibex/messages/${m1.id}`)).status).toBe(403);
    expect((await c.d.delete(`/api/vibex/messages/${m1.id}`)).status).toBe(404);
    expect((await a.d.delete(`/api/vibex/messages/${crypto.randomUUID()}`)).status).toBe(404);

    expect((await a.d.delete(`/api/vibex/messages/${m1.id}`)).status).toBe(200);
    // Idempotent.
    expect((await a.d.delete(`/api/vibex/messages/${m1.id}`)).status).toBe(200);

    for (const u of [a, b]) {
      const list = await messages(u, chat.id);
      // Step 2.8: nothing is left in its place, and the reply keeps no quote of it.
      expect(list.find((m) => m.id === m1.id)).toBeUndefined();
      const r = list.find((m) => m.id === reply.id)!;
      expect(r.replyTo).toBeNull();
      expect(JSON.stringify(list)).not.toContain('"deleted"');
    }
    expect(JSON.stringify(await messages(b, chat.id))).not.toContain("Удали меня");
    expect((await download(b, file.body.id)).statusCode).toBe(404);
    expect((await download(a, file.body.id)).statusCode).toBe(404);
    // Its notification is gone from B's center.
    expect(JSON.stringify((await b.d.get("/api/notifications")).body)).not.toContain("Удали меня");
    // Replying to a deleted message is refused.
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "ещё", replyToId: m1.id })).status).toBe(404);
    // A deleted message doesn't count as unread.
    const m2 = (await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "Скоро удалю" })).body as VibexMessageDto;
    expect((await a.d.get("/api/vibex/chats")).body.find((x: VibexChatDto) => x.id === chat.id).unread).toBe(2);
    await b.d.delete(`/api/vibex/messages/${m2.id}`);
    expect((await a.d.get("/api/vibex/chats")).body.find((x: VibexChatDto) => x.id === chat.id).unread).toBe(1);
  });

  it("voice messages can be deleted too", async () => {
    const [a, b] = [await user("Голос"), await user("Слух")];
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const v = await upload(a, "voice.webm", webm, "voice");
    expect(v.status).toBe(201);
    const msg = (await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", kind: "voice", durationMs: 1500, fileIds: [v.body.id] })).body as VibexMessageDto;
    expect((await a.d.delete(`/api/vibex/messages/${msg.id}`)).status).toBe(200);
    expect((await messages(b, chat.id)).some((m) => m.id === msg.id)).toBe(false);
    // The chat's preview never shows a deleted message.
    const listed = (await b.d.get("/api/vibex/chats")).body as VibexChatDto[];
    expect(listed.find((x) => x.id === chat.id)?.lastMessage?.id).not.toBe(msg.id);
  });
});

describe("vibex: views and shares (Step 2.5)", () => {
  it("unique signed-in viewers, never the author; shares = reposts + sends", async () => {
    const [author, v1, v2] = [await user("Автор"), await user("Зритель"), await user("Второй")];
    const post = (await author.d.post("/api/vibex/posts", { text: "Пост для просмотров" })).body as VibexPostDto;
    expect(post).toMatchObject({ views: 0, shares: 0, likes: 0, comments: 0 });
    await author.d.post("/api/vibex/views", { postIds: [post.id] });
    await v1.d.post("/api/vibex/views", { postIds: [post.id] });
    await v1.d.post("/api/vibex/views", { postIds: [post.id, post.id] });
    expect((await v2.d.get(`/api/vibex/posts/${post.id}`)).body.views).toBe(1);
    await v2.d.post("/api/vibex/views", { postIds: [post.id] });
    expect((await author.d.get(`/api/vibex/posts/${post.id}`)).body.views).toBe(2);
    // Validation and sign-in.
    expect((await v1.d.post("/api/vibex/views", { postIds: [] })).status).toBe(400);
    expect((await v1.d.post("/api/vibex/views", { postIds: ["x"] })).status).toBe(400);
    expect((await new Device(env.app).post("/api/vibex/views", { postIds: [post.id] })).status).toBe(401);

    await v1.d.post(`/api/vibex/posts/${post.id}/repost`);
    await v2.d.post(`/api/vibex/posts/${post.id}/share`, { userIds: [v1.id, author.id] });
    expect((await author.d.get(`/api/vibex/posts/${post.id}`)).body).toMatchObject({ reposts: 1, shares: 3 });
  });
});
