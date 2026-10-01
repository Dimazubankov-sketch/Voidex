import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first = "Anna") {
  const d = new Device(env.app);
  const u = await signUp(d, { firstName: first, lastName: "Tester" });
  return { d, ...u };
}

async function send(from: Device, draft: Record<string, unknown>) {
  const created = await from.post("/api/mail/drafts", draft);
  expect(created.status).toBe(201);
  const sent = await from.post(`/api/mail/drafts/${created.body.id}/send`);
  return { draftId: created.body.id as string, ...sent };
}

describe("internal mail", () => {
  it("sends and receives between two VOIDEX users", async () => {
    const a = await user("Alice");
    const b = await user("Bob");
    const r = await send(a.d, { to: [b.address], subject: "Hello", body: "First message" });
    expect(r.status).toBe(200);

    const inbox = await b.d.get("/api/mail/threads?view=inbox");
    expect(inbox.body.items).toHaveLength(1);
    const t = inbox.body.items[0];
    expect(t.subject).toBe("Hello");
    expect(t.unread).toBe(true);
    expect(t.participants[0].address).toBe(a.address);

    const summary = await b.d.get("/api/mail/summary");
    expect(summary.body.unread.inbox).toBe(1);

    const sent = await a.d.get("/api/mail/threads?view=sent");
    expect(sent.body.items).toHaveLength(1);
    expect(sent.body.items[0].participants[0].address).toBe(b.address);
    expect((await a.d.get("/api/mail/threads?view=drafts")).body.items).toHaveLength(0);
  });

  it("accepts a bare username as recipient", async () => {
    const a = await user();
    const b = await user();
    const r = await send(a.d, { to: [b.username], subject: "Short", body: "x" });
    expect(r.status).toBe(200);
    expect((await b.d.get("/api/mail/threads?view=inbox")).body.items).toHaveLength(1);
  });

  it("threads replies and keeps messages separate", async () => {
    const a = await user("Alice");
    const b = await user("Bob");
    const first = await send(a.d, { to: [b.address], subject: "Plans", body: "Dinner?" });
    const threadId = first.body.threadId;

    const thread = await b.d.get(`/api/mail/threads/${threadId}`);
    const msgId = thread.body.messages[0].id;
    const defaults = await b.d.get(`/api/mail/messages/${msgId}/compose?mode=reply`);
    expect(defaults.body.to).toEqual([a.address]);
    expect(defaults.body.subject).toBe("Re: Plans");

    const reply = await send(b.d, { ...defaults.body, body: "Yes!" + defaults.body.body });
    expect(reply.body.threadId).toBe(threadId);

    const aThread = await a.d.get(`/api/mail/threads/${threadId}`);
    expect(aThread.body.messages).toHaveLength(2);
    expect(aThread.body.messages[1].body.startsWith("Yes!")).toBe(true);
    expect(aThread.body.messages[1].inReplyToId).toBe(msgId);
    const aInbox = await a.d.get("/api/mail/threads?view=inbox");
    expect(aInbox.body.items[0].id).toBe(threadId);
    expect(aInbox.body.items[0].messageCount).toBe(2);
  });

  it("reply-all includes other recipients but not yourself", async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const first = await send(a.d, { to: [b.address], cc: [c.address], subject: "Team", body: "hi all" });
    const msg = (await b.d.get(`/api/mail/threads/${first.body.threadId}`)).body.messages[0];
    const d = await b.d.get(`/api/mail/messages/${msg.id}/compose?mode=reply_all`);
    expect(d.body.to).toEqual([a.address]);
    expect(d.body.cc).toEqual([c.address]);
  });

  it("reply / forward quote headers follow every interface language", async () => {
    const a = await user();
    const b = await user();
    const first = await send(a.d, { to: [b.address], subject: "Hallo", body: "Text" });
    const msg = (await b.d.get(`/api/mail/threads/${first.body.threadId}`)).body.messages[0];
    const de = await b.d.get(`/api/mail/messages/${msg.id}/compose?mode=reply&lang=de`);
    expect(de.status).toBe(200);
    expect(de.body.body).toContain("schrieb");
    const ja = await b.d.get(`/api/mail/messages/${msg.id}/compose?mode=forward&lang=ja`);
    expect(ja.status).toBe(200);
    expect(ja.body.body).toContain("転送メッセージ");
    expect((await b.d.get(`/api/mail/messages/${msg.id}/compose?mode=reply&lang=xx`)).status).toBe(400);
  });

  it("forwards into a new thread", async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const first = await send(a.d, { to: [b.address], subject: "Doc", body: "content" });
    const msg = (await b.d.get(`/api/mail/threads/${first.body.threadId}`)).body.messages[0];
    const f = await b.d.get(`/api/mail/messages/${msg.id}/compose?mode=forward`);
    expect(f.body.subject).toBe("Fwd: Doc");
    const fw = await send(b.d, { ...f.body, to: [c.address] });
    expect(fw.body.threadId).not.toBe(first.body.threadId);
    const cThread = await c.d.get(`/api/mail/threads/${fw.body.threadId}`);
    expect(cThread.body.messages[0].body).toContain("content");
    expect(cThread.body.messages[0].forwardOfId).toBe(msg.id);
  });

  it("hides bcc recipients from everyone but the sender", async () => {
    const a = await user();
    const b = await user();
    const secret = await user();
    const r = await send(a.d, { to: [b.address], bcc: [secret.address], subject: "Bcc", body: "x" });
    const bView = await b.d.get(`/api/mail/threads/${r.body.threadId}`);
    expect(bView.body.messages[0].recipients.map((x: { address: string }) => x.address)).toEqual([b.address]);
    const sView = await secret.d.get(`/api/mail/threads/${r.body.threadId}`);
    expect(sView.body.messages[0].recipients.some((x: { kind: string }) => x.kind === "bcc")).toBe(false);
    const aView = await a.d.get(`/api/mail/threads/${r.body.threadId}`);
    expect(aView.body.messages[0].recipients).toHaveLength(2);
  });

  it("rejects unknown and external recipients, keeping the draft", async () => {
    const a = await user();
    const r = await send(a.d, { to: ["nobody-exists-here@voidops.ru"], subject: "x", body: "y" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("recipient_not_found");
    const ext = await send(a.d, { to: ["someone@gmail.com"], subject: "x", body: "y" });
    expect(ext.body.error.code).toBe("recipient_external");
    const none = await send(a.d, { to: [], subject: "x", body: "y" });
    expect(none.body.error.code).toBe("no_recipients");
    const drafts = await a.d.get("/api/mail/threads?view=drafts");
    expect(drafts.body.items).toHaveLength(3);
  });

  it("autosaves drafts and cannot send twice", async () => {
    const a = await user();
    const b = await user();
    const d = await a.d.post("/api/mail/drafts", { subject: "Draft" });
    const upd = await a.d.put(`/api/mail/drafts/${d.body.id}`, { to: [b.address], subject: "Draft v2", body: "text" });
    expect(upd.body.subject).toBe("Draft v2");
    expect(upd.body.to).toEqual([b.address]);
    expect((await a.d.get(`/api/mail/drafts/${d.body.id}`)).body.body).toBe("text");
    expect((await a.d.get("/api/mail/summary")).body.totals.drafts).toBe(1);
    expect((await a.d.post(`/api/mail/drafts/${d.body.id}/send`)).status).toBe(200);
    const again = await a.d.post(`/api/mail/drafts/${d.body.id}/send`);
    expect(again.body.error.code).toBe("draft_already_sent");
    expect((await a.d.put(`/api/mail/drafts/${d.body.id}`, { body: "edit after send" })).status).toBe(409);
  });

  it("deletes drafts", async () => {
    const a = await user();
    const d = await a.d.post("/api/mail/drafts", { subject: "Temp" });
    expect((await a.d.delete(`/api/mail/drafts/${d.body.id}`)).status).toBe(200);
    expect((await a.d.get(`/api/mail/drafts/${d.body.id}`)).status).toBe(404);
  });

  it("archives, trashes, restores and deletes forever", async () => {
    const a = await user();
    const b = await user();
    const { body } = await send(a.d, { to: [b.address], subject: "Lifecycle", body: "x" });
    const t = body.threadId;
    const act = (action: string, view = "inbox") => b.d.post("/api/mail/threads/actions", { threadIds: [t], action, view });
    const ids = async (view: string) => (await b.d.get(`/api/mail/threads?view=${view}`)).body.items.map((i: { id: string }) => i.id);

    await act("archive");
    expect(await ids("inbox")).not.toContain(t);
    expect(await ids("archive")).toContain(t);
    await act("inbox", "archive");
    expect(await ids("inbox")).toContain(t);
    await act("trash");
    expect(await ids("inbox")).not.toContain(t);
    expect(await ids("trash")).toContain(t);
    expect((await b.d.get(`/api/mail/threads/${t}?view=inbox`)).status).toBe(404);
    expect((await b.d.get(`/api/mail/threads/${t}?view=trash`)).status).toBe(200);
    await act("restore", "trash");
    expect(await ids("inbox")).toContain(t);
    await act("trash");
    await act("delete_forever", "trash");
    expect(await ids("trash")).not.toContain(t);
    // The sender's copy is unaffected.
    expect((await a.d.get(`/api/mail/threads/${t}`)).status).toBe(200);
  });

  it("marks read/unread and stars", async () => {
    const a = await user();
    const b = await user();
    const { body } = await send(a.d, { to: [b.address], subject: "Flags", body: "x" });
    const t = body.threadId;
    await b.d.post("/api/mail/threads/actions", { threadIds: [t], action: "read", view: "inbox" });
    expect((await b.d.get("/api/mail/summary")).body.unread.inbox).toBe(0);
    await b.d.post("/api/mail/threads/actions", { threadIds: [t], action: "unread", view: "inbox" });
    expect((await b.d.get("/api/mail/summary")).body.unread.inbox).toBe(1);
    await b.d.post("/api/mail/threads/actions", { threadIds: [t], action: "star", view: "inbox" });
    const starred = await b.d.get("/api/mail/threads?view=starred");
    expect(starred.body.items.map((i: { id: string }) => i.id)).toContain(t);
    const msg = (await b.d.get(`/api/mail/threads/${t}`)).body.messages[0];
    await b.d.patch(`/api/mail/messages/${msg.id}`, { starred: false, read: true });
    expect((await b.d.get("/api/mail/threads?view=starred")).body.items).toHaveLength(0);
  });

  it("searches subject, body and sender", async () => {
    const a = await user("Searchable");
    const b = await user();
    await send(a.d, { to: [b.address], subject: "Quarterly report", body: "numbers inside" });
    await send(a.d, { to: [b.address], subject: "Lunch", body: "pizza 100%" });
    const q = async (s: string) => (await b.d.get(`/api/mail/threads?view=inbox&q=${encodeURIComponent(s)}`)).body.items.length;
    expect(await q("quarterly")).toBe(1);
    expect(await q("pizza")).toBe(1);
    expect(await q("100%")).toBe(1);
    expect(await q("%")).toBe(1);
    expect(await q("Searchable")).toBe(2);
    expect(await q("nothing-matches")).toBe(0);
  });

  it("paginates with a cursor", async () => {
    const a = await user();
    const b = await user();
    for (let i = 0; i < 5; i++) await send(a.d, { to: [b.address], subject: `N${i}`, body: "x" });
    const p1 = await b.d.get("/api/mail/threads?view=inbox&limit=2");
    expect(p1.body.items).toHaveLength(2);
    const p2 = await b.d.get(`/api/mail/threads?view=inbox&limit=2&cursor=${p1.body.nextCursor}`);
    const p3 = await b.d.get(`/api/mail/threads?view=inbox&limit=2&cursor=${p2.body.nextCursor}`);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i) => i.subject);
    expect(new Set(all).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
  });

  it("suggests contacts from your own history only", async () => {
    const a = await user();
    const b = await user("Boris");
    const stranger = await user("Stranger");
    await send(a.d, { to: [b.address], subject: "x", body: "y" });
    const c = await a.d.get(`/api/mail/contacts?q=${b.username.slice(0, 4)}`);
    expect(c.body.map((x: { address: string }) => x.address)).toContain(b.address);
    const none = await a.d.get(`/api/mail/contacts?q=${stranger.username.slice(0, 8)}`);
    expect(none.body.map((x: { address: string }) => x.address)).not.toContain(stranger.address);
  });

  it("same mailbox on a second device", async () => {
    const a = await user();
    const b = await user();
    await send(a.d, { to: [b.address], subject: "Sync", body: "x" });
    // Same browser identity re-used: sign in again on the trusted device via refresh on a fresh tab.
    const tab = new Device(env.app);
    tab.cookies = { ...b.d.cookies };
    await tab.post("/api/auth/refresh");
    const items = (await tab.get("/api/mail/threads?view=inbox")).body.items;
    expect(items.map((i: { subject: string }) => i.subject)).toContain("Sync");
  });
});

describe("mail isolation (user A never sees user B's data)", () => {
  it("cannot read, act on, reply to, or edit another user's mail", async () => {
    const a = await user("Alice");
    const b = await user("Bob");
    const eve = await user("Eve");
    const { body } = await send(a.d, { to: [b.address], subject: "Private", body: "secret" });
    const t = body.threadId;
    const msgId = (await b.d.get(`/api/mail/threads/${t}`)).body.messages[0].id;
    const draft = await a.d.post("/api/mail/drafts", { to: [b.address], subject: "draft", body: "private draft" });

    expect((await eve.d.get(`/api/mail/threads/${t}`)).status).toBe(404);
    expect((await eve.d.get(`/api/mail/drafts/${draft.body.id}`)).status).toBe(404);
    expect((await eve.d.put(`/api/mail/drafts/${draft.body.id}`, { body: "hacked" })).status).toBe(404);
    expect((await eve.d.post(`/api/mail/drafts/${draft.body.id}/send`)).status).toBe(404);
    expect((await eve.d.delete(`/api/mail/drafts/${draft.body.id}`)).status).toBe(404);
    expect((await eve.d.patch(`/api/mail/messages/${msgId}`, { read: true })).status).toBe(404);
    expect((await eve.d.get(`/api/mail/messages/${msgId}/compose?mode=forward`)).status).toBe(404);
    const reply = await eve.d.post("/api/mail/drafts", { replyToMessageId: msgId, body: "inject" });
    expect(reply.status).toBe(404);
    const act = await eve.d.post("/api/mail/threads/actions", { threadIds: [t], action: "trash", view: "inbox" });
    expect(act.body.changed).toBe(0);
    expect((await eve.d.get("/api/mail/threads?view=inbox&q=secret")).body.items).toHaveLength(0);

    // Bob still has it untouched; Alice's draft unchanged.
    expect((await b.d.get("/api/mail/threads?view=inbox")).body.items[0].id).toBe(t);
    expect((await a.d.get(`/api/mail/drafts/${draft.body.id}`)).body.body).toBe("private draft");
  });

  it("a recipient added later to a thread does not see earlier messages", async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const first = await send(a.d, { to: [b.address], subject: "Early", body: "only for b" });
    const msg = (await b.d.get(`/api/mail/threads/${first.body.threadId}`)).body.messages[0];
    const d = await b.d.post("/api/mail/drafts", { replyToMessageId: msg.id, to: [a.address, c.address], subject: "Re: Early", body: "adding c" });
    await b.d.post(`/api/mail/drafts/${d.body.id}/send`);
    const cView = await c.d.get(`/api/mail/threads/${first.body.threadId}`);
    expect(cView.body.messages).toHaveLength(1);
    expect(cView.body.messages[0].body).toBe("adding c");
  });
});

describe("realtime", () => {
  it("pushes mail.received to every device of the recipient, and nothing to others", async () => {
    const a = await user();
    const b = await user();
    const eve = await user();
    const got: { user: string; type: string }[] = [];
    const off1 = env.app.ctx.events.subscribe(b.user.id, "b-phone", (e) => got.push({ user: "b", type: e.type }));
    const off2 = env.app.ctx.events.subscribe(b.user.id, "b-mac", (e) => got.push({ user: "b2", type: e.type }));
    const off3 = env.app.ctx.events.subscribe(eve.user.id, "eve", (e) => got.push({ user: "eve", type: e.type }));
    await send(a.d, { to: [b.address], subject: "Ping", body: "x" });
    off1();
    off2();
    off3();
    expect(got.filter((g) => g.type === "mail.received").map((g) => g.user).sort()).toEqual(["b", "b2"]);
    expect(got.some((g) => g.user === "eve")).toBe(false);
  });
});

describe("request bodies", () => {
  it("accepts an empty JSON body on action endpoints and rejects malformed JSON", async () => {
    const a = await user();
    const b = await user();
    const d = await a.d.post("/api/mail/drafts", { to: [b.address], subject: "x", body: "y" });
    const r = await env.app.inject({
      method: "POST",
      url: `/api/mail/drafts/${d.body.id}/send`,
      headers: { "content-type": "application/json", "x-voidex-client": "web", authorization: `Bearer ${a.d.accessToken}`, "x-test-client": a.d.testClientId },
    });
    expect(r.statusCode).toBe(200);
    const bad = await env.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: "{not json",
      headers: { "content-type": "application/json", "x-voidex-client": "web" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
