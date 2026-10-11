import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexChatSearchDto, VibexMessageDto, VibexPage, VibexPostDto, VibexStoryDto, VibexStoryGroupDto } from "@voidex/shared";
import { eq } from "drizzle-orm";
import { vibexStories } from "../src/db/schema.js";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const HOUR = 60 * 60 * 1000;

async function user(first: string, last = "Девятый") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, username: r.username, address: r.address, legacy: r.legacyAddress };
}
type U = Awaited<ReturnType<typeof user>>;

function upload(u: U, name: string, data: Buffer, purpose: string) {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}
function download(u: U, id: string) {
  return env.app.inject({ method: "GET", url: `/api/vibex/files/${id}`, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}
const direct = async (a: U, b: U) => (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
const say = async (u: U, chat: string, text: string) => (await u.d.post(`/api/vibex/chats/${chat}/messages`, { text })).body as VibexMessageDto;
const chats = async (u: U) => (await u.d.get("/api/vibex/chats")).body as VibexChatDto[];
const messages = async (u: U, chat: string) => ((await u.d.get(`/api/vibex/chats/${chat}/messages`)).body as VibexPage<VibexMessageDto>).items;
const notifications = async (u: U) => (await u.d.get("/api/notifications")).body as { items: { type: string; read: boolean; target: Record<string, string> }[]; unread: number };

async function story(u: U, name = "story.png") {
  const f = await upload(u, name, PNG, "story");
  expect(f.status).toBe(201);
  const r = await u.d.post("/api/vibex/stories", { fileId: f.body.id });
  expect(r.status).toBe(201);
  return r.body as VibexStoryDto;
}

describe("Step 2.9: stories", () => {
  it("live for 24 hours for followers and chat partners, then only in the author's archive", async () => {
    const [a, follower, partner, stranger] = [await user("Аврора"), await user("Фил"), await user("Пётр"), await user("Чужак")];
    await follower.d.post(`/api/vibex/people/${a.id}/follow`);
    const chat = await direct(partner, a);
    await say(partner, chat.id, "привет");

    const s = await story(a);
    expect(s.kind).toBe("photo");
    expect(s.archived).toBe(false);
    expect(new Date(s.expiresAt).getTime() - new Date(s.createdAt).getTime()).toBe(24 * HOUR);

    const feedOf = async (u: U) => (await u.d.get("/api/vibex/stories")).body as VibexStoryGroupDto[];
    // My own group comes first in my header.
    expect((await feedOf(a))[0]).toMatchObject({ mine: true, person: { id: a.id } });
    for (const u of [follower, partner]) {
      const g = (await feedOf(u)).find((x) => x.person.id === a.id);
      expect(g?.stories.map((x) => x.id)).toEqual([s.id]);
      expect(g?.seen).toBe(false);
      expect((await download(u, s.file.id)).statusCode).toBe(200);
    }
    // Someone who neither follows nor chats does not get it in the header.
    expect((await feedOf(stranger)).some((x) => x.person.id === a.id)).toBe(false);

    // Views: once per person, the author's own not counted; only the author sees the number and who.
    expect((await follower.d.post(`/api/vibex/stories/${s.id}/view`)).status).toBe(200);
    expect((await follower.d.post(`/api/vibex/stories/${s.id}/view`)).status).toBe(200);
    await a.d.post(`/api/vibex/stories/${s.id}/view`);
    expect((await feedOf(follower)).find((x) => x.person.id === a.id)?.seen).toBe(true);
    expect((await feedOf(a))[0]!.stories[0]!.views).toBe(1);
    expect((await feedOf(partner)).find((x) => x.person.id === a.id)!.stories[0]!.views).toBe(0);
    const viewers = (await a.d.get(`/api/vibex/stories/${s.id}/viewers`)).body as { person: { id: string } }[];
    expect(viewers.map((v) => v.person.id)).toEqual([follower.id]);
    expect((await follower.d.get(`/api/vibex/stories/${s.id}/viewers`)).status).toBe(404);

    // 24 hours later (the story is moved back in time): gone from every header,
    // kept (with its picture) in the author's archive only.
    await env.app.ctx.db
      .update(vibexStories)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR), expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(vibexStories.id, s.id));
    expect((await feedOf(follower)).some((x) => x.person.id === a.id)).toBe(false);
    expect((await feedOf(a)).some((x) => x.mine)).toBe(false);
    const archive = (await a.d.get("/api/vibex/stories/archive")).body as VibexStoryDto[];
    expect(archive.map((x) => x.id)).toContain(s.id);
    expect(archive.find((x) => x.id === s.id)?.archived).toBe(true);
    expect((await download(a, s.file.id)).statusCode).toBe(200);
    expect((await download(follower, s.file.id)).statusCode).toBe(404);
    expect((await follower.d.post(`/api/vibex/stories/${s.id}/view`)).status).toBe(404);
    expect(((await follower.d.get("/api/vibex/stories/archive")).body as VibexStoryDto[]).some((x) => x.id === s.id)).toBe(false);
  });

  it("only my own unsent story upload becomes a story; the author can delete it", async () => {
    const [a, b] = [await user("Белла"), await user("Вадим")];
    const bFile = await upload(b, "b.png", PNG, "story");
    expect((await a.d.post("/api/vibex/stories", { fileId: bFile.body.id })).status).toBe(404);
    const msgFile = await upload(a, "m.png", PNG, "message");
    expect((await a.d.post("/api/vibex/stories", { fileId: msgFile.body.id })).status).toBe(404);
    expect((await upload(a, "notes.txt", Buffer.from("hi"), "story")).status).toBe(415);
    const s = await story(a);
    expect((await b.d.delete(`/api/vibex/stories/${s.id}`)).status).toBe(404);
    expect((await a.d.delete(`/api/vibex/stories/${s.id}`)).status).toBe(200);
    expect(((await a.d.get("/api/vibex/stories")).body as VibexStoryGroupDto[]).some((g) => g.mine)).toBe(false);
  });
});

describe("Step 2.9: chat preview never marks anything read", () => {
  it("B previews A's messages: unread, A's read receipt and B's notifications stay as they were", async () => {
    const [a, b] = [await user("Анна"), await user("Борис")];
    const chat = await direct(a, b);
    await say(a, chat.id, "первое");
    await say(a, chat.id, "второе");
    const before = (await chats(b)).find((c) => c.id === chat.id)!;
    expect(before.unread).toBe(2);
    const nBefore = await notifications(b);
    expect(nBefore.items.filter((n) => n.target.chatId === chat.id && !n.read).length).toBeGreaterThan(0);

    // The preview: the same history request the chat uses, without POST /read.
    const preview = await messages(b, chat.id);
    expect(preview.map((m) => m.text)).toEqual(["второе", "первое"]);
    await messages(b, chat.id);

    const after = (await chats(b)).find((c) => c.id === chat.id)!;
    expect(after.unread).toBe(2);
    expect((await chats(a)).find((c) => c.id === chat.id)!.peerReadAt).toBeNull();
    const nAfter = await notifications(b);
    expect(nAfter.unread).toBe(nBefore.unread);

    // Opening the chat for real (read) is what clears it.
    await b.d.post(`/api/vibex/chats/${chat.id}/read`);
    expect((await chats(b)).find((c) => c.id === chat.id)!.unread).toBe(0);
    expect((await chats(a)).find((c) => c.id === chat.id)!.peerReadAt).not.toBeNull();
  });
});

describe("Step 2.9: chat notifications, delete for me / for everyone, list order", () => {
  it("notifications off for one chat: no notification, the chat still updates", async () => {
    const [a, b] = [await user("Ира"), await user("Ким")];
    const chat = await direct(a, b);
    const muted = await b.d.patch(`/api/vibex/chats/${chat.id}`, { muted: true });
    expect(muted.status).toBe(200);
    expect((muted.body as VibexChatDto).muted).toBe(true);
    await say(a, chat.id, "тихо");
    expect((await notifications(b)).items.some((n) => n.target.chatId === chat.id)).toBe(false);
    expect((await chats(b)).find((c) => c.id === chat.id)!.unread).toBe(1);
    // Mute is mine only.
    expect((await chats(a)).find((c) => c.id === chat.id)!.muted).toBe(false);
    await b.d.patch(`/api/vibex/chats/${chat.id}`, { muted: false });
    await say(a, chat.id, "громко");
    expect((await notifications(b)).items.some((n) => n.target.chatId === chat.id)).toBe(true);
  });

  it("delete for me: gone from my list and history only; a new message brings the chat back from there", async () => {
    const [a, b] = [await user("Дина"), await user("Ефим")];
    const chat = await direct(a, b);
    await say(a, chat.id, "старое");
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/delete`, { scope: "me" })).status).toBe(200);
    expect((await chats(b)).some((c) => c.id === chat.id)).toBe(false);
    expect((await messages(b, chat.id)).length).toBe(0);
    // A keeps everything.
    expect((await messages(a, chat.id)).map((m) => m.text)).toEqual(["старое"]);
    await say(a, chat.id, "новое");
    const back = (await chats(b)).find((c) => c.id === chat.id)!;
    expect(back.lastMessage?.text).toBe("новое");
    expect(back.unread).toBe(1);
    expect((await messages(b, chat.id)).map((m) => m.text)).toEqual(["новое"]);
    // Search sees only what I still have.
    const found = (await b.d.get(`/api/vibex/chats/search?q=${encodeURIComponent("старое")}`)).body as VibexChatSearchDto;
    expect(found.messages).toHaveLength(0);
  });

  it("delete for everyone: either person of a direct chat; only the owner of a group; files go too", async () => {
    const [a, b, c] = [await user("Жанна"), await user("Захар"), await user("Илья")];
    const chat = await direct(a, b);
    const f = await upload(a, "plan.txt", Buffer.from("план"), "message");
    await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [f.body.id] });
    expect((await chats(a)).find((x) => x.id === chat.id)!.canDeleteForAll).toBe(true);
    expect((await c.d.post(`/api/vibex/chats/${chat.id}/delete`, { scope: "all" })).status).toBe(404);
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/delete`, { scope: "all" })).status).toBe(200);
    for (const u of [a, b]) expect((await chats(u)).some((x) => x.id === chat.id)).toBe(false);
    expect((await a.d.get(`/api/vibex/chats/${chat.id}/messages`)).status).toBe(404);
    expect((await download(a, f.body.id)).statusCode).toBe(404);

    const group = (await a.d.post("/api/vibex/groups", { title: "Команда", memberIds: [b.id, c.id] })).body as VibexChatDto;
    expect((await chats(b)).find((x) => x.id === group.id)!.canDeleteForAll).toBe(false);
    const denied = await b.d.post(`/api/vibex/chats/${group.id}/delete`, { scope: "all" });
    expect(denied.status).toBe(403);
    // A member may still delete it for themselves.
    expect((await c.d.post(`/api/vibex/chats/${group.id}/delete`, { scope: "me" })).status).toBe(200);
    expect((await a.d.post(`/api/vibex/chats/${group.id}/delete`, { scope: "all" })).status).toBe(200);
    expect((await chats(b)).some((x) => x.id === group.id)).toBe(false);
  });

  it("the chat list order (chats / groups first, mixed) is saved with the account", async () => {
    const a = await user("Кира");
    const s = (await a.d.get("/api/vibex/settings")).body;
    expect(s.chats.order).toBe("chats-first");
    const r = await a.d.patch("/api/vibex/settings", { chats: { order: "groups-first" } });
    expect(r.body.chats.order).toBe("groups-first");
    expect((await a.d.get("/api/vibex/settings")).body.chats.order).toBe("groups-first");
    expect((await a.d.patch("/api/vibex/settings", { chats: { order: "random" } })).status).toBe(400);
  });
});

describe("Step 2.9: chat search", () => {
  it("finds people by name and both address spellings, groups by title and messages by text", async () => {
    const [a, b, c] = [await user("Лев", "Поисков"), await user("Мира", "Искомая"), await user("Нил", "Посторонний")];
    const chat = await direct(a, b);
    await say(b, chat.id, "встречаемся у фонтана");
    const group = (await a.d.post("/api/vibex/groups", { title: "Путешествия", memberIds: [b.id] })).body as VibexChatDto;
    const search = async (q: string) => (await a.d.get(`/api/vibex/chats/search?q=${encodeURIComponent(q)}`)).body as VibexChatSearchDto;
    expect((await search("Мира")).chats.map((x) => x.id)).toContain(chat.id);
    expect((await search(b.address)).chats.map((x) => x.id)).toContain(chat.id);
    expect((await search(b.legacy)).chats.map((x) => x.id)).toContain(chat.id);
    expect((await search("путеш")).chats.map((x) => x.id)).toEqual([group.id]);
    const byText = await search("фонтан");
    expect(byText.messages.map((m) => m.message.text)).toEqual(["встречаемся у фонтана"]);
    expect(byText.messages[0]!.chat.id).toBe(chat.id);
    // Someone I have no chat with is not a chat result (people search is separate).
    expect((await search("Посторонний")).chats).toHaveLength(0);
    void c;
  });
});

describe("Step 2.9: posts with Files attachments, Publications", () => {
  it("a post carries my own Files uploads after its pictures; another person's file id is refused", async () => {
    const [a, b] = [await user("Ольга"), await user("Павел")];
    const pic = await upload(a, "p.png", PNG, "post");
    const doc = await upload(a, "Отчёт.pdf", Buffer.from("%PDF-1.4\n%%EOF"), "postfile");
    expect(doc.status).toBe(201);
    const foreign = await upload(b, "чужое.txt", Buffer.from("x"), "postfile");
    expect((await a.d.post("/api/vibex/posts", { text: "", mediaIds: [], fileIds: [foreign.body.id] })).status).toBe(404);
    // A "post" picture can't be passed as a file and the other way round (purposes are checked).
    expect((await a.d.post("/api/vibex/posts", { text: "x", mediaIds: [doc.body.id] })).status).toBe(404);
    const post = (await a.d.post("/api/vibex/posts", { text: "С файлом", mediaIds: [pic.body.id], fileIds: [doc.body.id] })).body as VibexPostDto;
    expect(post.media.map((m) => m.kind)).toEqual(["image", "file"]);
    expect(post.media[1]!.filename).toBe("Отчёт.pdf");
    expect((await download(b, doc.body.id)).statusCode).toBe(200);
    // A post with only a file is fine too.
    const doc2 = await upload(a, "readme.txt", Buffer.from("hello"), "postfile");
    expect((await a.d.post("/api/vibex/posts", { text: "", fileIds: [doc2.body.id] })).status).toBe(201);
  });

  it("Publications: only posts with a photo / video, the same posts (no copies)", async () => {
    const a = await user("Рита");
    const pic = await upload(a, "p.png", PNG, "post");
    const withMedia = (await a.d.post("/api/vibex/posts", { text: "Подпись", mediaIds: [pic.body.id] })).body as VibexPostDto;
    await a.d.post("/api/vibex/posts", { text: "Просто текст" });
    const pubs = (await a.d.get(`/api/vibex/people/${a.id}/publications`)).body as VibexPage<VibexPostDto>;
    expect(pubs.items.map((p) => p.id)).toEqual([withMedia.id]);
    expect(pubs.items[0]!.text).toBe("Подпись");
    const posts = (await a.d.get(`/api/vibex/people/${a.id}/posts`)).body as VibexPage<VibexPostDto>;
    expect(posts.items.map((p) => p.id)).toContain(withMedia.id);
    expect(posts.items).toHaveLength(2);
  });
});
