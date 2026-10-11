import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MeDto, VibexChatDto, VibexPersonDto } from "@voidex/shared";
import { Device, STRONG_PASSWORD, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string, last = "Адресов") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, username: r.username, address: r.address, legacy: r.legacyAddress };
}

async function send(from: Device, to: string[], subject = "Привет") {
  const created = await from.post("/api/mail/drafts", { to, subject, body: "Текст" });
  expect(created.status).toBe(201);
  return from.post(`/api/mail/drafts/${created.body.id}/send`);
}

describe("Step 2.9: VoidOps addresses are username@voidops, @voidops.ru stays an alias", () => {
  it("a new account is shown as x@voidops; storage keeps the canonical x@voidops.ru", async () => {
    const a = await user("Алан");
    const me = (await a.d.get("/api/me")).body as MeDto;
    expect(me.mailAddress).toBe(`${a.username}@voidops`);
    const stored = await env.app.ctx.db.query.mailAccounts.findFirst({ where: (m, { eq }) => eq(m.userId, a.id) });
    expect(stored?.address).toBe(`${a.username}@voidops.ru`);
    expect(stored?.domain).toBe("voidops.ru");
    const info = (await a.d.get("/api/system/info")).body;
    expect(info.mailDomain).toBe("voidops.ru");
    expect(info.publicMailDomain).toBe("voidops");
  });

  it("signs in with either spelling (any case), and an existing account keeps working", async () => {
    const a = await user("Вера");
    for (const identifier of [a.address, a.legacy, a.address.toUpperCase(), `${a.username}@VoidOps.RU`]) {
      const r = await a.d.post("/api/auth/login", { identifier, password: STRONG_PASSWORD });
      expect(r.status, identifier).toBe(200);
      expect(r.body.user.id).toBe(a.id);
    }
    // Recovery resolves both spellings to the same account too (it answers the same way for unknown ones).
    expect((await new Device(env.app).post("/api/auth/recovery/start", { identifier: a.address })).status).toBeLessThan(500);
  });

  it("one identity: no second account because the spellings differ", async () => {
    const a = await user("Глеб");
    const check = await new Device(env.app).get(`/api/auth/username/check?username=${encodeURIComponent(a.username)}`);
    expect(check.status).toBe(200);
    expect(check.body.available).toBe(false);
    expect(check.body.address).toBe(`${a.username}@voidops`);
    // Registering the same name again is refused.
    await expect(signUp(new Device(env.app), { username: a.username })).rejects.toThrow(/register failed/);
    const rows = await env.app.ctx.db.query.mailAccounts.findMany({ where: (m, { eq }) => eq(m.localPart, a.username) });
    expect(rows).toHaveLength(1);
  });

  it("mail is delivered to x@voidops and to x@voidops.ru alike, and shown as x@voidops", async () => {
    const a = await user("Аня");
    const b = await user("Борис");
    expect((await send(a.d, [b.address], "Новый адрес")).status).toBe(200);
    expect((await send(a.d, [b.legacy], "Старый адрес")).status).toBe(200);
    const inbox = (await b.d.get("/api/mail/threads?view=inbox")).body;
    const threads = (inbox.items ?? inbox) as { subject: string; participants: { address: string }[] }[];
    expect(threads.map((t) => t.subject)).toEqual(expect.arrayContaining(["Новый адрес", "Старый адрес"]));
    for (const t of threads) for (const p of t.participants) expect(p.address).not.toMatch(/@voidops\.ru$/);
    // Resolving a typed address: both spellings are the same person.
    for (const q of [b.address, b.legacy]) {
      const r = (await a.d.get(`/api/mail/resolve?address=${encodeURIComponent(q)}`)).body;
      expect(r.exists).toBe(true);
      expect(r.address).toBe(b.address);
    }
    // Recipient search by either spelling.
    for (const q of [b.address, b.legacy]) {
      const found = (await a.d.get(`/api/mail/contacts?q=${encodeURIComponent(q)}`)).body as { address: string }[];
      expect(found.map((c) => c.address)).toContain(b.address);
    }
  });

  it("Vibex: people search by both spellings; people and chats carry x@voidops", async () => {
    const a = await user("Ира");
    const b = await user("Семён");
    for (const q of [b.address, b.legacy, `@${b.username}`]) {
      const found = (await a.d.get(`/api/vibex/people?q=${encodeURIComponent(q)}`)).body as VibexPersonDto[];
      expect(found.map((p) => p.id), q).toContain(b.id);
      expect(found.find((p) => p.id === b.id)?.address).toBe(b.address);
    }
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
    expect(chat.peer?.address).toBe(b.address);
  });

  it("sharing (Notes access list) shows x@voidops", async () => {
    const a = await user("Нина");
    const b = await user("Олег");
    const project = (await a.d.post("/api/notes/projects", { name: "Общий" })).body;
    const share = await a.d.post("/api/notes/shares", { resourceType: "project", resourceId: project.id, mode: "access", role: "editor" });
    expect(share.status).toBe(201);
    expect((await b.d.post(`/api/notes/shares/${share.body.token}/accept`, {})).status).toBe(200);
    const access = (await a.d.get(`/api/notes/access/project/${project.id}`)).body;
    const all = JSON.stringify(access);
    expect(all).toContain(`${b.username}@voidops"`);
    expect(all).not.toContain("@voidops.ru");
  });

  it("events (SSE payloads) and unknown addresses: only exact VoidOps addresses change", async () => {
    const { addressPresenter } = await import("../src/lib/addresses.js");
    const p = addressPresenter("voidops.ru");
    expect(p.present({ a: "x@voidops.ru", b: ["Y@VOIDOPS.RU"], c: "write to x@voidops.ru today", d: "bob@example.com", e: 1, f: null })).toEqual({
      a: "x@voidops",
      b: ["Y@voidops"],
      c: "write to x@voidops.ru today",
      d: "bob@example.com",
      e: 1,
      f: null,
    });
  });
});
