import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexActivityPageDto, VibexChatDto, VibexMessageDto, VibexPage, VibexPostDto, VibexSearchDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

async function user(first: string, last = "Десятый") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, username: r.username as string, address: r.address as string };
}
type U = Awaited<ReturnType<typeof user>>;

const direct = async (a: U, b: U) => (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
const say = async (u: U, chat: string, text: string) => (await u.d.post(`/api/vibex/chats/${chat}/messages`, { text })).body as VibexMessageDto;
const chats = async (u: U) => (await u.d.get("/api/vibex/chats")).body as VibexChatDto[];
const page = async (u: U, chat: string, before?: string) =>
  // The same request the chat and its preview make (50 a page).
  (await u.d.get(`/api/vibex/chats/${chat}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`)).body as VibexPage<VibexMessageDto>;
const history = async (u: U, chat: string) => (await page(u, chat)).items;
const activity = async (u: U) => (await u.d.get("/api/vibex/activity")).body as VibexActivityPageDto;
function upload(u: U, name: string, data: Buffer, purpose: string) {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}

describe("Step 2.10: the preview reads nothing, however far it scrolls", () => {
  it("B pages through A's whole history (older pages too): unread, read receipt and order stay", async () => {
    const [a, b] = [await user("Анна"), await user("Борис")];
    const chat = await direct(a, b);
    for (let i = 1; i <= 60; i++) await say(a, chat.id, `сообщение ${i}`);
    const first = await page(b, chat.id);
    expect(first.items).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const older = await page(b, chat.id, first.next!);
    expect(older.items.at(-1)!.text).toBe("сообщение 1");
    const mine = (await chats(b)).find((c) => c.id === chat.id)!;
    expect(mine.unread).toBe(60);
    expect((await chats(a)).find((c) => c.id === chat.id)!.peerReadAt).toBeNull();
  });
});

describe("Step 2.10: message actions", () => {
  it("edit: only the sender, only text; everyone sees the new text and when", async () => {
    const [a, b] = [await user("Вера"), await user("Глеб")];
    const chat = await direct(a, b);
    const m = await say(a, chat.id, "превет");
    expect((await b.d.patch(`/api/vibex/messages/${m.id}`, { text: "взлом" })).status).toBe(403);
    const r = await a.d.patch(`/api/vibex/messages/${m.id}`, { text: "привет" });
    expect(r.status).toBe(200);
    expect((r.body as VibexMessageDto).editedAt).not.toBeNull();
    const seen = (await history(b, chat.id))[0]!;
    expect(seen).toMatchObject({ text: "привет" });
    expect(seen.editedAt).toBeTruthy();
    expect((await a.d.patch(`/api/vibex/messages/${m.id}`, { text: "  " })).status).toBe(400);
  });

  it("delete for me: gone from my history and my unread only; for everyone: own messages only (checked per message)", async () => {
    const [a, b] = [await user("Дина"), await user("Егор")];
    const chat = await direct(a, b);
    const theirs = await say(a, chat.id, "от Дины");
    const mine = await say(b, chat.id, "от Егора");
    // B can't delete A's message for everyone, even in a batch with his own.
    expect((await b.d.post("/api/vibex/messages/delete", { ids: [theirs.id, mine.id], scope: "all" })).status).toBe(403);
    expect((await history(a, chat.id)).map((m) => m.id)).toEqual([mine.id, theirs.id]);
    // For me: both leave B's history; A keeps everything.
    expect((await b.d.post("/api/vibex/messages/delete", { ids: [theirs.id, mine.id], scope: "me" })).status).toBe(200);
    expect(await history(b, chat.id)).toEqual([]);
    expect((await chats(b)).find((c) => c.id === chat.id)?.lastMessage ?? null).toBeNull();
    expect((await history(a, chat.id)).length).toBe(2);
    // For everyone (own): gone for both.
    const again = await say(b, chat.id, "ещё раз");
    expect((await b.d.post("/api/vibex/messages/delete", { ids: [again.id], scope: "all" })).status).toBe(200);
    expect((await history(a, chat.id)).some((m) => m.id === again.id)).toBe(false);
    // Someone outside the chat can't touch it.
    const c = await user("Чужой");
    expect((await c.d.post("/api/vibex/messages/delete", { ids: [theirs.id], scope: "me" })).status).toBe(404);
  });

  it("forward: copies (text and files) into other chats, with the original author; the copy survives the original", async () => {
    const [a, b, c] = [await user("Жанна"), await user("Захар"), await user("Ира")];
    const ab = await direct(a, b);
    const bc = await direct(b, c);
    const f = await upload(a, "фото.png", PNG, "message");
    expect(f.status).toBe(201);
    const withFile = (await a.d.post(`/api/vibex/chats/${ab.id}/messages`, { text: "смотри", fileIds: [f.body.id] })).body as VibexMessageDto;
    const plain = await say(a, ab.id, "и ещё");
    const r = await b.d.post("/api/vibex/messages/forward", { messageIds: [plain.id, withFile.id], conversationIds: [bc.id] });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(2);
    const got = await history(c, bc.id);
    // Oldest first, so the newest copy is "и ещё".
    expect(got.map((m) => m.text)).toEqual(["и ещё", "смотри"]);
    expect(got[1]!.forwardedFrom).toMatchObject({ id: a.id, name: "Жанна Десятый" });
    expect(got[1]!.files).toHaveLength(1);
    expect(got[1]!.files[0]!.id).not.toBe(withFile.files[0]!.id);
    // The original is deleted: the copy and its file stay.
    await a.d.delete(`/api/vibex/messages/${withFile.id}`);
    const file = await env.app.inject({ method: "GET", url: `/api/vibex/files/${got[1]!.files[0]!.id}`, headers: { "x-voidex-client": "web", "x-test-client": c.d.testClientId, authorization: `Bearer ${c.d.accessToken}` } });
    expect(file.statusCode).toBe(200);
    // Forwarded copies can't be edited; a chat I'm not in can't receive them.
    expect((await b.d.patch(`/api/vibex/messages/${got[1]!.id}`, { text: "x" })).status).toBe(400);
    const ac = await direct(a, c);
    expect((await b.d.post("/api/vibex/messages/forward", { messageIds: [plain.id], conversationIds: [ac.id] })).status).toBe(404);
  });

  it("pin: one message on top for everyone; groups: the owner only; deleting it unpins", async () => {
    const [a, b, c] = [await user("Кира"), await user("Лев"), await user("Мила")];
    const chat = await direct(a, b);
    await say(b, chat.id, "привет");
    const m = await say(a, chat.id, "важное");
    const r = await b.d.put(`/api/vibex/chats/${chat.id}/pin`, { messageId: m.id });
    expect(r.status).toBe(200);
    expect((r.body as VibexChatDto).pinnedMessage).toMatchObject({ id: m.id, text: "важное" });
    expect((await chats(a)).find((x) => x.id === chat.id)!.pinnedMessage?.id).toBe(m.id);
    await a.d.delete(`/api/vibex/messages/${m.id}`);
    expect((await chats(a)).find((x) => x.id === chat.id)!.pinnedMessage ?? null).toBeNull();

    const group = (await a.d.post("/api/vibex/groups", { title: "Клуб", memberIds: [b.id, c.id] })).body as VibexChatDto;
    const g = await say(b, group.id, "в группе");
    expect((await b.d.put(`/api/vibex/chats/${group.id}/pin`, { messageId: g.id })).status).toBe(403);
    expect((await a.d.put(`/api/vibex/chats/${group.id}/pin`, { messageId: g.id })).status).toBe(200);
    expect((await chats(c)).find((x) => x.id === group.id)!.pinnedMessage?.id).toBe(g.id);
    expect((await a.d.put(`/api/vibex/chats/${group.id}/pin`, { messageId: null })).status).toBe(200);
    expect((await chats(c)).find((x) => x.id === group.id)!.pinnedMessage ?? null).toBeNull();
  });
});

describe("Step 2.10: the activity tab", () => {
  it("follows, likes, reposts, comments, groups, new posts and stories; read on the server; undo removes", async () => {
    const [a, b, c] = [await user("Нина"), await user("Олег"), await user("Петя")];
    // C follows A: A gets "follow".
    await c.d.post(`/api/vibex/people/${a.id}/follow`);
    let act = await activity(a);
    expect(act.items[0]).toMatchObject({ type: "follow", actor: { id: c.id }, read: false, following: false });
    expect(act.unread).toBe(1);
    // A posts with a picture: C (a follower) gets "post" with the thumbnail.
    const media = await upload(a, "кадр.png", PNG, "post");
    const post = (await a.d.post("/api/vibex/posts", { text: "мой кадр", mediaIds: [media.body.id] })).body as VibexPostDto;
    const cAct = await activity(c);
    expect(cAct.items[0]).toMatchObject({ type: "post", actor: { id: a.id }, postId: post.id, postMedia: { kind: "image" }, following: true });
    // B likes, reposts and comments on A's post.
    await b.d.post(`/api/vibex/posts/${post.id}/like`);
    await b.d.post(`/api/vibex/posts/${post.id}/repost`);
    await b.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "класс" });
    act = await activity(a);
    expect(act.items.slice(0, 3).map((x) => x.type)).toEqual(["comment", "repost", "like"]);
    expect(act.unread).toBe(4);
    // Unlike: the like leaves the activity.
    await b.d.delete(`/api/vibex/posts/${post.id}/like`);
    expect((await activity(a)).items.some((x) => x.type === "like")).toBe(false);
    // Added to a group.
    const group = (await b.d.post("/api/vibex/groups", { title: "Кружок", memberIds: [a.id] })).body as VibexChatDto;
    expect((await activity(a)).items[0]).toMatchObject({ type: "group", chatId: group.id, chatTitle: "Кружок" });
    // A story by someone A follows.
    await a.d.post(`/api/vibex/people/${b.id}/follow`);
    const sf = await upload(b, "история.png", PNG, "story");
    const story = (await b.d.post("/api/vibex/stories", { fileId: sf.body.id })).body as { id: string };
    expect((await activity(a)).items[0]).toMatchObject({ type: "story", storyId: story.id, following: true });
    // Read on the server: every device sees 0.
    expect((await a.d.get("/api/vibex/activity/count")).body.unread).toBeGreaterThan(0);
    expect((await a.d.post("/api/vibex/activity/read")).status).toBe(200);
    expect((await a.d.get("/api/vibex/activity/count")).body.unread).toBe(0);
    expect((await activity(a)).items.every((x) => x.read)).toBe(true);
    // Nothing about myself.
    await a.d.post(`/api/vibex/posts/${post.id}/like`);
    expect((await activity(a)).items.some((x) => x.type === "like" && x.actor.id === a.id)).toBe(false);
  });
});

describe("Step 2.10: the Search tab", () => {
  it("people: the exact @username first, then names; posts by text and #tag; the grid has others' media posts only", async () => {
    const tag = `тег${Date.now() % 100000}`;
    const target = await user("Роман", "Искомый");
    const other = await user(target.username.slice(0, 4).toUpperCase(), "Похожий");
    const me = await user("Сева");
    const res = (await me.d.get(`/api/vibex/search?q=${encodeURIComponent("@" + target.username)}`)).body as VibexSearchDto;
    expect(res.people[0]!.id).toBe(target.id);
    const byName = (await me.d.get(`/api/vibex/search?q=${encodeURIComponent("Роман")}`)).body as VibexSearchDto;
    expect(byName.people.some((p) => p.id === target.id)).toBe(true);
    void other;
    const m = await upload(target, "a.png", PNG, "post");
    const p = (await target.d.post("/api/vibex/posts", { text: `закат #${tag}`, mediaIds: [m.body.id] })).body as VibexPostDto;
    const byTag = (await me.d.get(`/api/vibex/search?q=${encodeURIComponent("#" + tag)}`)).body as VibexSearchDto;
    expect(byTag.people).toEqual([]);
    expect(byTag.posts.map((x) => x.id)).toContain(p.id);
    const grid = (await me.d.get("/api/vibex/explore")).body as VibexPage<VibexPostDto>;
    expect(grid.items.some((x) => x.id === p.id)).toBe(true);
    const own = (await target.d.get("/api/vibex/explore")).body as VibexPage<VibexPostDto>;
    expect(own.items.some((x) => x.id === p.id)).toBe(false);
  });
});
