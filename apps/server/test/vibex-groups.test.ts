import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Группа" });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;

function upload(u: U, name: string, data: Buffer, purpose: string) {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}
function download(u: U, id: string) {
  return env.app.inject({ method: "GET", url: `/api/vibex/files/${id}`, headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` } });
}
const chatsOf = async (u: U) => (await u.d.get("/api/vibex/chats")).body as VibexChatDto[];

describe("vibex group chats (Step 2.4)", () => {
  it("create with a name and picture; members, roles, unread, notifications; direct chats unchanged", async () => {
    const [a, b, c, outsider] = [await user("Анна"), await user("Борис"), await user("Вера"), await user("Гость")];
    // A picture of the "group" purpose (images only).
    expect((await upload(a, "notes.txt", Buffer.from("hi"), "group")).status).toBe(415);
    const pic = await upload(a, "team.png", PNG, "group");
    expect(pic.status).toBe(201);

    expect((await a.d.post("/api/vibex/groups", { title: "  ", memberIds: [b.id] })).status).toBe(400);
    expect((await a.d.post("/api/vibex/groups", { title: "Пусто", memberIds: [a.id] })).status).toBe(400); // only me
    const created = await a.d.post("/api/vibex/groups", { title: "Команда", memberIds: [b.id, c.id, b.id], avatarFileId: pic.body.id });
    expect(created.status).toBe(201);
    const g = created.body as VibexChatDto;
    expect(g).toMatchObject({ kind: "group", peer: null, unread: 0, group: { title: "Команда", avatarFileId: pic.body.id, role: "owner" } });
    expect(g.group!.members.map((m) => m.id)).toEqual([a.id, b.id, c.id]);

    // Everyone sees it right away (even before the first message); B is a member.
    const bChats = await chatsOf(b);
    expect(bChats.find((x) => x.id === g.id)).toMatchObject({ kind: "group", group: { role: "member", title: "Команда" } });
    // B was notified about being added.
    const bn = (await b.d.get("/api/notifications")).body;
    expect(JSON.stringify(bn)).toContain("vibex.group");

    // The picture: members only.
    expect((await download(c, pic.body.id)).statusCode).toBe(200);
    expect((await download(outsider, pic.body.id)).statusCode).toBe(404);

    // B writes: A and C have it unread; C's notification names the group and the sender.
    expect((await b.d.post(`/api/vibex/chats/${g.id}/messages`, { text: "Всем привет!" })).status).toBe(201);
    expect((await chatsOf(a)).find((x) => x.id === g.id)!.unread).toBe(1);
    expect((await chatsOf(c)).find((x) => x.id === g.id)).toMatchObject({ unread: 1, lastMessage: { text: "Всем привет!", senderId: b.id } });
    const cn = (await c.d.get("/api/notifications")).body.items as { type: string; title: string; body: string }[];
    expect(cn.find((n) => n.type === "vibex.message")).toMatchObject({ title: "Команда", body: "Борис: Всем привет!" });
    // Outsiders can't read or write.
    expect((await outsider.d.get(`/api/vibex/chats/${g.id}/messages`)).status).toBe(404);
    expect((await outsider.d.post(`/api/vibex/chats/${g.id}/messages`, { text: "?" })).status).toBe(404);

    // Only the creator renames.
    expect((await b.d.patch(`/api/vibex/groups/${g.id}`, { title: "Моя" })).status).toBe(403);
    expect((await a.d.patch(`/api/vibex/groups/${g.id}`, { title: "Команда VOIDEX" })).body.group.title).toBe("Команда VOIDEX");

    // Direct chats keep working as before.
    const direct = await a.d.post("/api/vibex/chats/direct", { userId: b.id });
    expect(direct.body).toMatchObject({ kind: "direct", group: null, peer: { id: b.id } });
  });

  it("privacy: people who don't accept messages from me can't be added", async () => {
    const [a, b] = [await user("Ада"), await user("Бен")];
    await b.d.patch("/api/vibex/settings", { privacy: { messages: "nobody" } });
    const r = await a.d.post("/api/vibex/groups", { title: "Закрыто", memberIds: [b.id] });
    expect(r.status).toBe(403);
    expect(r.body.error.details.userId).toBe(b.id);
  });

  it("leaving: the creator's role passes on; the last one out removes the group", async () => {
    const [a, b, c] = [await user("Ася"), await user("Боб"), await user("Вова")];
    const g = (await a.d.post("/api/vibex/groups", { title: "Ненадолго", memberIds: [b.id, c.id] })).body as VibexChatDto;
    expect((await a.d.post(`/api/vibex/groups/${g.id}/leave`, {})).status).toBe(200);
    expect((await chatsOf(a)).some((x) => x.id === g.id)).toBe(false);
    const bView = (await chatsOf(b)).find((x) => x.id === g.id)!;
    expect(bView.group!.role).toBe("owner");
    expect(bView.group!.members.map((m) => m.id)).toEqual([b.id, c.id]);
    await b.d.post(`/api/vibex/groups/${g.id}/leave`, {});
    await c.d.post(`/api/vibex/groups/${g.id}/leave`, {});
    expect((await c.d.get(`/api/vibex/chats/${g.id}`)).status).toBe(404);
  });
});
