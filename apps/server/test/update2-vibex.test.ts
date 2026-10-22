import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexMessageDto, VibexPage, VibexPersonDto, VibexProfileDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

/** Update 2 · stage C: several pins, clearing, search in a chat, info tabs, presence and its privacy, profile links. */
let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

async function user(first: string, last = "Второй") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, username: r.username as string, address: r.address as string };
}
type U = Awaited<ReturnType<typeof user>>;
const direct = async (a: U, b: U) => (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
const say = async (u: U, chat: string, text: string, fileIds?: string[]) => (await u.d.post(`/api/vibex/chats/${chat}/messages`, { text, fileIds })).body as VibexMessageDto;
const chatOf = async (u: U, chat: string) => (await u.d.get(`/api/vibex/chats/${chat}`)).body as VibexChatDto;
const history = async (u: U, chat: string) => ((await u.d.get(`/api/vibex/chats/${chat}/messages`)).body as VibexPage<VibexMessageDto>).items;
function upload(u: U, name: string, data: Buffer) {
  return u.d.post(`/api/vibex/files?purpose=message`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}
/** A connected device (the live events stream) — what makes someone "online". */
const connect = (u: U) => (env.app as unknown as { ctx: { events: { subscribe: (u: string, s: string, l: () => void) => () => void } } }).ctx.events.subscribe(u.id, crypto.randomUUID(), () => {});

describe("C1: several pinned messages", () => {
  it("pins in message order, both sides see them; unpin one; the newest stays for older apps; groups: the owner only", async () => {
    const [a, b, c] = [await user("Ада"), await user("Бен"), await user("Вик")];
    const chat = await direct(a, b);
    const m1 = await say(a, chat.id, "первое");
    const m2 = await say(b, chat.id, "второе");
    const m3 = await say(a, chat.id, "третье");
    // Pinned out of order: the list is by message time.
    for (const m of [m3, m1, m2]) expect((await b.d.post(`/api/vibex/chats/${chat.id}/pins`, { messageId: m.id })).status).toBe(200);
    // Pinning again changes nothing.
    await a.d.post(`/api/vibex/chats/${chat.id}/pins`, { messageId: m1.id });
    const seen = await chatOf(a, chat.id);
    expect(seen.pins!.map((p) => p.text)).toEqual(["первое", "второе", "третье"]);
    expect(seen.pinnedMessage!.id).toBe(m2.id); // the most recently pinned
    // Unpin one.
    expect((await a.d.delete(`/api/vibex/chats/${chat.id}/pins/${m2.id}`)).status).toBe(200);
    expect((await chatOf(b, chat.id)).pins!.map((p) => p.id)).toEqual([m1.id, m3.id]);
    // A deleted message leaves the pins.
    await a.d.delete(`/api/vibex/messages/${m3.id}`);
    expect((await chatOf(b, chat.id)).pins!.map((p) => p.id)).toEqual([m1.id]);
    // Older apps: null unpins everything.
    await a.d.put(`/api/vibex/chats/${chat.id}/pin`, { messageId: null });
    expect((await chatOf(b, chat.id)).pins).toEqual([]);
    // A stranger can't pin; a message of another chat can't be pinned here.
    expect((await c.d.post(`/api/vibex/chats/${chat.id}/pins`, { messageId: m1.id })).status).toBe(404);
    const other = await direct(a, c);
    const x = await say(c, other.id, "чужое");
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/pins`, { messageId: x.id })).status).toBe(404);
    // Groups: the owner only.
    const group = (await a.d.post("/api/vibex/groups", { title: "Клуб", memberIds: [b.id, c.id] })).body as VibexChatDto;
    const g = await say(b, group.id, "в группе");
    expect((await b.d.post(`/api/vibex/chats/${group.id}/pins`, { messageId: g.id })).status).toBe(403);
    expect((await a.d.post(`/api/vibex/chats/${group.id}/pins`, { messageId: g.id })).status).toBe(200);
    expect((await b.d.delete(`/api/vibex/chats/${group.id}/pins/${g.id}`)).status).toBe(403);
  });
});

describe("C4: clear the history, search in a chat", () => {
  it("«for me» hides it for me only (the chat stays); «for everyone» deletes the messages for both; a group: the owner only", async () => {
    const [a, b, c] = [await user("Гера"), await user("Дина"), await user("Ефим")];
    const chat = await direct(a, b);
    await say(a, chat.id, "раз");
    await say(b, chat.id, "два");
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/clear`, { scope: "me" })).status).toBe(200);
    expect(await history(a, chat.id)).toHaveLength(0);
    expect(await history(b, chat.id)).toHaveLength(2);
    expect(((await a.d.get("/api/vibex/chats")).body as VibexChatDto[]).some((x) => x.id === chat.id)).toBe(true);
    await say(a, chat.id, "три");
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/clear`, { scope: "all" })).status).toBe(200);
    expect(await history(a, chat.id)).toHaveLength(0);
    expect(await history(b, chat.id)).toHaveLength(0);
    const group = (await a.d.post("/api/vibex/groups", { title: "Г", memberIds: [b.id, c.id] })).body as VibexChatDto;
    await say(b, group.id, "в группе");
    expect((await b.d.post(`/api/vibex/chats/${group.id}/clear`, { scope: "all" })).status).toBe(403);
    expect((await c.d.post(`/api/vibex/chats/${chat.id}/clear`, { scope: "me" })).status).toBe(404);
  });

  it("search finds this chat's messages only (what I can still see), newest first, paged", async () => {
    const [a, b, c] = [await user("Жора"), await user("Зоя"), await user("Иван")];
    const chat = await direct(a, b);
    for (let i = 1; i <= 35; i++) await say(a, chat.id, `отчёт ${i}`);
    await say(b, chat.id, "что-то другое");
    const other = await direct(a, c);
    await say(a, other.id, "отчёт в другом чате");
    const p1 = (await b.d.get(`/api/vibex/chats/${chat.id}/search?q=${encodeURIComponent("отчёт")}`)).body as VibexPage<VibexMessageDto>;
    expect(p1.items).toHaveLength(30);
    expect(p1.items[0]!.text).toBe("отчёт 35");
    const p2 = (await b.d.get(`/api/vibex/chats/${chat.id}/search?q=${encodeURIComponent("отчёт")}&cursor=${encodeURIComponent(p1.next!)}`)).body as VibexPage<VibexMessageDto>;
    expect(p2.items).toHaveLength(5);
    expect(p2.next).toBeNull();
    // % and _ are text, not wildcards.
    expect(((await b.d.get(`/api/vibex/chats/${chat.id}/search?q=${encodeURIComponent("%")}`)).body as VibexPage<VibexMessageDto>).items).toHaveLength(0);
    // Not a member: not found.
    expect((await c.d.get(`/api/vibex/chats/${chat.id}/search?q=x`)).status).toBe(404);
  });
});

describe("C5: the chat info tabs", () => {
  it("media / files / links / voice come from this chat, newest first", async () => {
    const [a, b] = [await user("Кая"), await user("Лука")];
    const chat = await direct(a, b);
    const img = (await upload(a, "фото.png", PNG)).body as { id: string };
    await say(a, chat.id, "", [img.id]);
    const doc = (await upload(a, "договор.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"))).body as { id: string };
    await say(a, chat.id, "документ", [doc.id]);
    await say(b, chat.id, "смотри https://voidex.su/docs и всё");
    await say(b, chat.id, "без ссылки");
    const tab = async (kind: string) => ((await b.d.get(`/api/vibex/chats/${chat.id}/media?kind=${kind}`)).body as VibexPage<VibexMessageDto>).items;
    expect((await tab("media")).map((m) => m.files[0]?.filename)).toEqual(["фото.png"]);
    expect((await tab("files")).map((m) => m.files[0]?.filename)).toEqual(["договор.pdf"]);
    expect((await tab("links")).map((m) => m.text)).toEqual(["смотри https://voidex.su/docs и всё"]);
    expect(await tab("voice")).toEqual([]);
    expect(await tab("gifs")).toEqual([]);
    expect((await b.d.get(`/api/vibex/chats/${chat.id}/media?kind=everything`)).status).toBe(400);
  });
});

describe("C3: presence, as its owner allows", () => {
  it("online while a device is connected, «last seen» after; hidden: the server sends nothing more than «hidden»", async () => {
    const [a, b] = [await user("Мира"), await user("Нил")];
    const chat = await direct(a, b);
    await say(a, chat.id, "привет");
    const peerOf = async (u: U) => ((await u.d.get(`/api/vibex/chats/${chat.id}`)).body as VibexChatDto).peer!;
    expect((await peerOf(b)).presence).toEqual({ state: "offline", lastSeenAt: null });
    const off = connect(a);
    expect((await peerOf(b)).presence).toEqual({ state: "online" });
    off();
    const p = (await peerOf(b)).presence!;
    expect(p.state).toBe("offline");
    expect(p.state === "offline" && p.lastSeenAt).toBeTruthy();
    // A hides it: B sees «hidden», in the chat, the list and the profile; A still sees B's.
    await a.d.patch("/api/vibex/settings", { privacy: { presence: "nobody" } });
    const off2 = connect(a);
    expect((await peerOf(b)).presence).toEqual({ state: "hidden" });
    expect(((await b.d.get("/api/vibex/chats")).body as VibexChatDto[]).find((c) => c.id === chat.id)!.peer!.presence).toEqual({ state: "hidden" });
    expect(((await b.d.get(`/api/vibex/people/${a.id}`)).body as VibexProfileDto).person.presence).toEqual({ state: "hidden" });
    expect(JSON.stringify((await b.d.get(`/api/vibex/chats/${chat.id}`)).body)).not.toContain("lastSeenAt");
    off2();
    // Their own presence is always real to them.
    const offB = connect(b);
    expect((await peerOf(a)).presence).toEqual({ state: "online" });
    offB();
    // A "always online" switch does not exist: an unknown value is refused.
    expect((await a.d.patch("/api/vibex/settings", { privacy: { presence: "always" } })).status).toBe(400);
  });

  it("presence changes reach only people allowed to see them", async () => {
    const [a, b] = [await user("Оля"), await user("Паша")];
    const chat = await direct(a, b);
    await say(a, chat.id, "привет");
    const got: string[] = [];
    const events = (env.app as unknown as { ctx: { events: { subscribe: (u: string, s: string, l: (e: { type: string; userId?: string }) => void) => () => void } } }).ctx.events;
    const unsub = events.subscribe(b.id, crypto.randomUUID(), (e) => e.type === "vibex.presence" && got.push(e.userId!));
    const off = connect(a);
    off();
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toContain(a.id);
    got.length = 0;
    await a.d.patch("/api/vibex/settings", { privacy: { presence: "nobody" } });
    const off2 = connect(a);
    off2();
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
    unsub();
  });
});

describe("C6: profile links by @handle", () => {
  it("finds the person by handle (no private data in the link); blocked viewers and unknown handles get 404", async () => {
    const [a, b] = [await user("Рита"), await user("Сева")];
    const handle = a.address.split("@")[0]!;
    const r = await b.d.get(`/api/vibex/people/by-handle/${encodeURIComponent(handle)}`);
    expect(r.status).toBe(200);
    expect((r.body as VibexPersonDto).id).toBe(a.id);
    expect((await b.d.get(`/api/vibex/people/by-handle/@${encodeURIComponent(handle.toUpperCase())}`)).status).toBe(200);
    expect((await b.d.get(`/api/vibex/people/by-handle/nobody-here-${Date.now()}`)).status).toBe(404);
    expect((await b.d.get(`/api/vibex/people/by-handle/${encodeURIComponent("a b")}`)).status).toBe(400);
    await a.d.patch("/api/vibex/settings", { privacy: { blocked: [b.id] } });
    expect((await b.d.get(`/api/vibex/people/by-handle/${encodeURIComponent(handle)}`)).status).toBe(404);
    // Signed out: the API needs a session.
    expect((await new Device(env.app).get(`/api/vibex/people/by-handle/${encodeURIComponent(handle)}`, { auth: false })).status).toBe(401);
  });
});
