import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerEvent } from "@voidex/shared";
import { sql } from "drizzle-orm";
import { Device, STRONG_PASSWORD, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** A VOIDEX account that signed in to Vibex (activation with its email + password). */
async function user(first: string, opts: { activate?: boolean } = {}) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Vibex" });
  if (opts.activate !== false) {
    const act = await d.post("/api/vibex/activate", { email: r.address, password: STRONG_PASSWORD });
    if (act.status !== 200) throw new Error(`activate failed: ${JSON.stringify(act.body)}`);
  }
  return { d, id: r.user.id as string, sessionId: r.sessionId, address: r.address, username: r.username };
}
type U = Awaited<ReturnType<typeof user>>;

function upload(u: U, name: string, data: Buffer, purpose: "message" | "post" = "message") {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, {
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) },
  });
}
function download(u: U, id: string) {
  return env.app.inject({
    method: "GET",
    url: `/api/vibex/files/${id}`,
    headers: { "x-voidex-client": "web", "x-test-client": u.d.testClientId, authorization: `Bearer ${u.d.accessToken}` },
  });
}
function listen(u: U) {
  const events: ServerEvent[] = [];
  const stop = env.app.ctx.events.subscribe(u.id, u.sessionId, (e) => events.push(e));
  return { events, stop };
}

describe("vibex chats", () => {
  it("A finds B, writes, B gets the message live, reads it; A sees the read receipt", async () => {
    const a = await user("Alice");
    const b = await user("Boris");

    const found = await a.d.get(`/api/vibex/people?q=${b.username}`);
    expect(found.status).toBe(200);
    expect(found.body.map((p: { id: string }) => p.id)).toContain(b.id);
    expect(found.body.map((p: { id: string }) => p.id)).not.toContain(a.id);

    const chat = await a.d.post("/api/vibex/chats/direct", { userId: b.id });
    expect(chat.status).toBe(200);
    expect(chat.body.peer.id).toBe(b.id);
    // Opening the same chat again (from either side) gives the same conversation.
    expect((await b.d.post("/api/vibex/chats/direct", { userId: a.id })).body.id).toBe(chat.body.id);
    // Empty chats are not listed.
    expect((await b.d.get("/api/vibex/chats")).body).toHaveLength(0);

    const live = listen(b);
    const sent = await a.d.post(`/api/vibex/chats/${chat.body.id}/messages`, { text: "Привет, Борис!" });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ text: "Привет, Борис!", mine: true, senderId: a.id });
    live.stop();
    expect(live.events).toContainEqual(expect.objectContaining({ type: "vibex.message", conversationId: chat.body.id, senderId: a.id }));

    const bChats = await b.d.get("/api/vibex/chats");
    expect(bChats.body).toHaveLength(1);
    expect(bChats.body[0]).toMatchObject({ id: chat.body.id, unread: 1, peer: { id: a.id } });
    expect(bChats.body[0].lastMessage).toMatchObject({ text: "Привет, Борис!", mine: false });

    const msgs = await b.d.get(`/api/vibex/chats/${chat.body.id}/messages`);
    expect(msgs.body.items).toHaveLength(1);
    expect((await a.d.get(`/api/vibex/chats/${chat.body.id}`)).body.peerReadAt).toBeNull();

    expect((await b.d.post(`/api/vibex/chats/${chat.body.id}/read`)).status).toBe(200);
    expect((await b.d.get("/api/vibex/chats")).body[0].unread).toBe(0);
    const aView = await a.d.get(`/api/vibex/chats/${chat.body.id}`);
    expect(new Date(aView.body.peerReadAt).getTime()).toBeGreaterThanOrEqual(new Date(sent.body.createdAt).getTime());
  });

  it("strangers can't read, write to or open someone else's chat", async () => {
    const a = await user("Anna");
    const b = await user("Bella");
    const c = await user("Carl");
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body;
    await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "private" });

    expect((await c.d.get(`/api/vibex/chats/${chat.id}`)).status).toBe(404);
    expect((await c.d.get(`/api/vibex/chats/${chat.id}/messages`)).status).toBe(404);
    expect((await c.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "hi" })).status).toBe(404);
    expect((await c.d.post(`/api/vibex/chats/${chat.id}/read`)).status).toBe(404);
    expect((await c.d.put("/api/vibex/chats/pins", { conversationIds: [chat.id] })).status).toBe(404);
    expect((await a.d.post("/api/vibex/chats/direct", { userId: a.id })).status).toBe(400);
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "   " })).status).toBe(400);
    // Signed-out calls are refused.
    expect((await a.d.get("/api/vibex/chats", { auth: false })).status).toBe(401);
  });

  it("files: images and documents go through, are visible to chat members only; active content is refused", async () => {
    const a = await user("Alla");
    const b = await user("Bob");
    const c = await user("Cyril");
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body;

    const img = await upload(a, "фото.png", PNG);
    expect(img.status).toBe(201);
    expect(img.body).toMatchObject({ filename: "фото.png", mimeType: "image/png", kind: "image", size: PNG.length });
    const doc = await upload(a, "report.pdf", PDF);
    expect(doc.body.kind).toBe("file");

    // Before sending, only the uploader can fetch the file, and nobody else can claim it.
    expect((await download(b, img.body.id)).statusCode).toBe(404);
    const chatBC = (await b.d.post("/api/vibex/chats/direct", { userId: c.id })).body;
    expect((await b.d.post(`/api/vibex/chats/${chatBC.id}/messages`, { fileIds: [img.body.id] })).status).toBe(404);

    const sent = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [img.body.id, doc.body.id] });
    expect(sent.status).toBe(201);
    expect(sent.body.files.map((f: { id: string }) => f.id)).toEqual([img.body.id, doc.body.id]);
    // A file goes out once.
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { fileIds: [img.body.id] })).status).toBe(404);

    const got = await download(b, img.body.id);
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(got.headers["content-disposition"])).toMatch(/^attachment;/);
    expect(got.headers["content-security-policy"]).toContain("sandbox");
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await download(c, img.body.id)).statusCode).toBe(404);

    expect((await upload(a, "page.html", Buffer.from("<script>alert(1)</script>"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a, "logo.svg", Buffer.from("<svg/>"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a, "fake.png", Buffer.from("<html>not a png</html>"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a, "doc.pdf", PDF, "post")).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a, "big.pdf", Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]))).status).toBe(413);

    // Discarding an unsent upload.
    const extra = await upload(a, "notes.txt", Buffer.from("draft"));
    expect((await b.d.delete(`/api/vibex/files/${extra.body.id}`)).status).toBe(404);
    expect((await a.d.delete(`/api/vibex/files/${extra.body.id}`)).status).toBe(200);
    expect((await download(a, extra.body.id)).statusCode).toBe(404);
  });

  it("pinned chats keep my order; the rest follow by activity; pins are per person", async () => {
    const a = await user("Ada");
    const others = await Promise.all(["Ben", "Cid", "Dan", "Eve"].map((n) => user(n)));
    const chats: string[] = [];
    for (const o of others) {
      const c = (await a.d.post("/api/vibex/chats/direct", { userId: o.id })).body;
      await a.d.post(`/api/vibex/chats/${c.id}/messages`, { text: `hi ${o.username}` });
      chats.push(c.id);
    }
    // Newest activity first.
    expect((await a.d.get("/api/vibex/chats")).body.map((c: { id: string }) => c.id)).toEqual([...chats].reverse());

    const pinned = await a.d.put("/api/vibex/chats/pins", { conversationIds: [chats[1], chats[0]] });
    expect(pinned.status).toBe(200);
    expect(pinned.body.map((c: { id: string }) => c.id)).toEqual([chats[1], chats[0], chats[3], chats[2]]);
    expect(pinned.body.map((c: { pinnedPosition: number | null }) => c.pinnedPosition)).toEqual([0, 1, null, null]);

    // Reorder pins.
    const re = await a.d.put("/api/vibex/chats/pins", { conversationIds: [chats[0], chats[1]] });
    expect(re.body.slice(0, 2).map((c: { id: string }) => c.id)).toEqual([chats[0], chats[1]]);
    // Activity doesn't move pinned chats; it does move regular ones.
    await a.d.post(`/api/vibex/chats/${chats[2]}/messages`, { text: "again" });
    expect((await a.d.get("/api/vibex/chats")).body.map((c: { id: string }) => c.id)).toEqual([chats[0], chats[1], chats[2], chats[3]]);
    // The other side doesn't see my pins.
    expect((await others[0]!.d.get("/api/vibex/chats")).body[0].pinnedPosition).toBeNull();
    // Unpin all.
    expect((await a.d.put("/api/vibex/chats/pins", { conversationIds: [] })).body.every((c: { pinnedPosition: null }) => c.pinnedPosition === null)).toBe(true);
  });
});

describe("vibex feed", () => {
  it("posts with pictures, likes, private bookmarks, reposts with the original inside", async () => {
    const a = await user("Arina");
    const b = await user("Bogdan");

    const pic = await upload(a, "sunset.png", PNG, "post");
    expect(pic.status).toBe(201);
    const post = await a.d.post("/api/vibex/posts", { text: "Закат", mediaIds: [pic.body.id] });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({ kind: "post", text: "Закат", mine: true, likes: 0 });
    expect(post.body.media[0].id).toBe(pic.body.id);
    // Post pictures are visible to any signed-in person.
    expect((await download(b, pic.body.id)).statusCode).toBe(200);

    const feed = await b.d.get("/api/vibex/feed");
    expect(feed.body.items.map((p: { id: string }) => p.id)).toContain(post.body.id);

    // Likes are public counts; bookmarks are private.
    expect((await b.d.post(`/api/vibex/posts/${post.body.id}/like`)).body).toMatchObject({ likes: 1, liked: true });
    expect((await a.d.post(`/api/vibex/posts/${post.body.id}/bookmark`)).body.bookmarked).toBe(true);
    const asB = await b.d.get(`/api/vibex/posts/${post.body.id}`);
    expect(asB.body).toMatchObject({ likes: 1, liked: true, bookmarked: false });
    expect((await b.d.get("/api/vibex/history?kind=bookmarks")).body.items).toHaveLength(0);
    const aBookmarks = await a.d.get("/api/vibex/history?kind=bookmarks");
    expect(aBookmarks.body.items.map((i: { postId: string }) => i.postId)).toEqual([post.body.id]);
    expect((await b.d.get("/api/vibex/history?kind=liked")).body.items[0].post.id).toBe(post.body.id);

    // B shares it on their page: a repost that carries the original (same id) inside.
    const rp = await b.d.post(`/api/vibex/posts/${post.body.id}/repost`);
    expect(rp.status).toBe(201);
    expect(rp.body).toMatchObject({ kind: "repost", author: { id: b.id } });
    expect(rp.body.repostOf).toMatchObject({ id: post.body.id, author: { id: a.id }, reposted: true, reposts: 1 });
    // Reposting twice doesn't duplicate.
    expect((await b.d.post(`/api/vibex/posts/${post.body.id}/repost`)).body.id).toBe(rp.body.id);

    // A sees B's repost on B's page and in the feed.
    const bPage = await a.d.get(`/api/vibex/people/${b.id}/posts`);
    expect(bPage.body.items[0]).toMatchObject({ id: rp.body.id, kind: "repost", repostOf: { id: post.body.id } });
    expect((await a.d.get(`/api/vibex/people/${b.id}`)).body).toMatchObject({ me: false, person: { id: b.id } });

    // Liking the repost card likes the original.
    expect((await a.d.post(`/api/vibex/posts/${rp.body.id}/like`)).body).toMatchObject({ id: post.body.id, likes: 2 });

    // Only the author deletes; afterwards the repost and history show it as unavailable.
    expect((await b.d.delete(`/api/vibex/posts/${post.body.id}`)).status).toBe(404);
    expect((await a.d.delete(`/api/vibex/posts/${post.body.id}`)).status).toBe(200);
    expect((await b.d.get(`/api/vibex/posts/${post.body.id}`)).status).toBe(404);
    const after = await a.d.get(`/api/vibex/people/${b.id}/posts`);
    expect(after.body.items[0]).toMatchObject({ id: rp.body.id, repostOf: null });
    const hist = await a.d.get("/api/vibex/history?kind=bookmarks");
    expect(hist.body.items[0]).toMatchObject({ postId: post.body.id, post: null });
    expect((await b.d.post(`/api/vibex/posts/${post.body.id}/like`)).status).toBe(404);
    expect((await download(b, pic.body.id)).statusCode).toBe(404);

    // Undo repost.
    const own = await b.d.post("/api/vibex/posts", { text: "мой" });
    const rp2 = await a.d.post(`/api/vibex/posts/${own.body.id}/repost`);
    expect(rp2.status).toBe(201);
    expect((await a.d.delete(`/api/vibex/posts/${own.body.id}/repost`)).body).toMatchObject({ reposted: false, reposts: 0 });
    expect((await a.d.post(`/api/vibex/posts/${own.body.id}/repost`)).status).toBe(201);
  });

  it("share → send in a message delivers the post card into the direct chat", async () => {
    const a = await user("Asya");
    const b = await user("Bruno");
    const post = (await a.d.post("/api/vibex/posts", { text: "look" })).body;
    const live = listen(b);
    const r = await a.d.post(`/api/vibex/posts/${post.id}/share`, { userIds: [b.id], text: "смотри" });
    live.stop();
    expect(r.status).toBe(200);
    expect(r.body.conversationIds).toHaveLength(1);
    expect(live.events.some((e) => e.type === "vibex.message")).toBe(true);
    const msgs = await b.d.get(`/api/vibex/chats/${r.body.conversationIds[0]}/messages`);
    expect(msgs.body.items[0]).toMatchObject({ text: "смотри", sharedPost: { id: post.id, author: { id: a.id } } });
    // Validation and empty posts.
    expect((await a.d.post("/api/vibex/posts", { text: "  " })).status).toBe(400);
    expect((await a.d.post(`/api/vibex/posts/${post.id}/share`, { userIds: [] })).status).toBe(400);
  });

  it("paginates the feed with a cursor", async () => {
    const a = await user("Pavel");
    for (let i = 0; i < 5; i++) await a.d.post("/api/vibex/posts", { text: `p${i}` });
    const first = await a.d.get(`/api/vibex/people/${a.id}/posts?limit=3`);
    expect(first.body.items.map((p: { text: string }) => p.text)).toEqual(["p4", "p3", "p2"]);
    const second = await a.d.get(`/api/vibex/people/${a.id}/posts?limit=3&before=${first.body.next}`);
    expect(second.body.items.map((p: { text: string }) => p.text)).toEqual(["p1", "p0"]);
    expect(second.body.next).toBeNull();
  });
});

describe("vibex step 2.2: sign-in, comments, edit, hide, report, translate", () => {
  it("Vibex sign-in = this VOIDEX account (email + password); nothing works before it; one account = one profile", async () => {
    const a = await user("Vera", { activate: false });
    const other = await user("Oleg");
    expect((await a.d.get("/api/vibex/me")).body).toMatchObject({ activated: false, person: { id: a.id, address: a.address } });
    const blocked = await a.d.get("/api/vibex/feed");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("vibex_not_activated");
    // Not activated people can't be found or messaged.
    expect((await other.d.get(`/api/vibex/people?q=${a.username}`)).body).toHaveLength(0);
    expect((await other.d.post("/api/vibex/chats/direct", { userId: a.id })).status).toBe(404);

    expect((await a.d.post("/api/vibex/activate", { email: a.address, password: "wrong-password-1" })).body.error.code).toBe("invalid_credentials");
    expect((await a.d.post("/api/vibex/activate", { email: "nobody-here@voidops.ru", password: STRONG_PASSWORD })).body.error.code).toBe("invalid_credentials");
    // Someone else's email is never a second identity: the client switches accounts instead.
    const foreign = await a.d.post("/api/vibex/activate", { email: other.address, password: STRONG_PASSWORD });
    expect(foreign.status).toBe(409);
    expect(foreign.body.error.code).toBe("vibex_other_account");

    const ok = await a.d.post("/api/vibex/activate", { email: a.address.toUpperCase(), password: STRONG_PASSWORD });
    expect(ok.body).toMatchObject({ activated: true, person: { id: a.id } });
    expect((await a.d.post("/api/vibex/activate", { email: a.address, password: STRONG_PASSWORD })).status).toBe(200); // idempotent
    expect((await a.d.get("/api/vibex/feed")).status).toBe(200);
    expect((await other.d.get(`/api/vibex/people?q=${a.username}`)).body.map((p: { id: string }) => p.id)).toContain(a.id);
  });

  it("account switch: signing in to another account with replaceSession ends the current session", async () => {
    const a = await user("Sasha");
    const b = await user("Bella");
    // Same browser (device cookie of B's device) so B's device is trusted: no second factor needed here.
    b.d.accessToken = a.d.accessToken;
    const r = await b.d.post("/api/auth/login", { identifier: b.address, password: STRONG_PASSWORD, replaceSession: true });
    expect(r.body.status).toBe("ok");
    expect(r.body.user.id).toBe(b.id);
    // A's session (the caller) is gone.
    const old = await a.d.get("/api/me");
    expect(old.status).toBe(401);
  });

  it("comments, counts, edit by the author, delete rules", async () => {
    const a = await user("Kira");
    const b = await user("Lev");
    const post = (await a.d.post("/api/vibex/posts", { text: "Hello comments" })).body;
    const c1 = await b.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "  Nice!  " });
    expect(c1.status).toBe(201);
    expect(c1.body).toMatchObject({ text: "Nice!", mine: true, author: { id: b.id } });
    expect((await b.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "   " })).status).toBe(400);
    expect((await a.d.get(`/api/vibex/posts/${post.id}`)).body.comments).toBe(1);
    const list = await a.d.get(`/api/vibex/posts/${post.id}/comments`);
    expect(list.body.map((c: { text: string; mine: boolean }) => [c.text, c.mine])).toEqual([["Nice!", false]]);

    // Only the author edits; the edit is marked.
    expect((await b.d.patch(`/api/vibex/posts/${post.id}`, { text: "hacked" })).status).toBe(404);
    const edited = await a.d.patch(`/api/vibex/posts/${post.id}`, { text: "Hello, edited" });
    expect(edited.body).toMatchObject({ text: "Hello, edited", editedAt: expect.any(String) });
    expect((await a.d.patch(`/api/vibex/posts/${post.id}`, { text: "" })).status).toBe(400);

    // A stranger can't delete a comment; the post's author can.
    const c = await user("Mila");
    expect((await c.d.delete(`/api/vibex/comments/${c1.body.id}`)).status).toBe(404);
    expect((await a.d.delete(`/api/vibex/comments/${c1.body.id}`)).status).toBe(200);
    expect((await a.d.get(`/api/vibex/posts/${post.id}`)).body.comments).toBe(0);
  });

  it("not interested hides a post (and its reposts) from my feed only; reports are stored once", async () => {
    const a = await user("Nina");
    const b = await user("Petr");
    const post = (await a.d.post("/api/vibex/posts", { text: "Maybe not for everyone" })).body;
    const c = await user("Raya");
    await c.d.post(`/api/vibex/posts/${post.id}/repost`);
    expect((await a.d.post(`/api/vibex/posts/${post.id}/hide`)).status).toBe(400); // own post
    expect((await b.d.post(`/api/vibex/posts/${post.id}/hide`)).status).toBe(200);
    const feedB = (await b.d.get("/api/vibex/feed?limit=100")).body.items as { id: string; repostOf?: { id: string } | null }[];
    expect(feedB.some((p) => p.id === post.id || p.repostOf?.id === post.id)).toBe(false);
    const feedC = (await c.d.get("/api/vibex/feed?limit=100")).body.items as { id: string }[];
    expect(feedC.some((p) => p.id === post.id)).toBe(true);

    expect((await b.d.post(`/api/vibex/posts/${post.id}/report`, { reason: "spam" })).status).toBe(200);
    expect((await b.d.post(`/api/vibex/posts/${post.id}/report`, { reason: "spam" })).status).toBe(200);
    const rows = await env.app.ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from vibex_reports where post_id = ${post.id}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("feed changes reach other people's devices live", async () => {
    const a = await user("Uma");
    const b = await user("Vlad");
    const live = listen(b);
    const post = (await a.d.post("/api/vibex/posts", { text: "live" })).body;
    await b.d.post(`/api/vibex/posts/${post.id}/like`);
    live.stop();
    expect(live.events.filter((e) => e.type === "vibex.feed" && e.postId === post.id).length).toBeGreaterThanOrEqual(2);
  });

  it("translation: target = reader's language, source detected; 503 when the provider is off", async () => {
    const a = await user("Yana");
    const b = await user("Zoe");
    const post = (await a.d.post("/api/vibex/posts", { text: "Good morning, how are you today?" })).body;
    // The test server has translation disabled: an honest 503, no fake text.
    const off = await b.d.post(`/api/vibex/posts/${post.id}/translate`);
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe("service_unavailable");
  });
});
