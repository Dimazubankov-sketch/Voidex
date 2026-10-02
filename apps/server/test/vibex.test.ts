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
  it("one VOIDEX account = one Vibex profile: no Vibex sign-in, the session is the identity", async () => {
    // Never "activated": Vibex works right away with the VOIDEX session.
    const a = await user("Vera", { activate: false });
    const other = await user("Oleg", { activate: false });
    expect((await a.d.get("/api/vibex/me")).body).toMatchObject({ activated: true, person: { id: a.id, address: a.address }, settings: { privacy: { messages: "everyone" } } });
    expect((await a.d.get("/api/vibex/feed")).status).toBe(200);
    // Found and messaged without any activation.
    expect((await other.d.get(`/api/vibex/people?q=${a.username}`)).body.map((p: { id: string }) => p.id)).toContain(a.id);
    expect((await other.d.post("/api/vibex/chats/direct", { userId: a.id })).status).toBe(200);
    // The retired activation endpoint never takes credentials or another identity: it answers like /me.
    const legacy = await a.d.post("/api/vibex/activate", { email: other.address, password: "whatever-1" });
    expect(legacy.status).toBe(200);
    expect(legacy.body.person.id).toBe(a.id);
    // One profile row per account.
    const rows = await env.app.ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM vibex_profiles WHERE user_id = ${a.id}::uuid`);
    expect(rows.rows[0]!.n).toBe(1);
    // Without a session: 401.
    const anon = await env.app.inject({ method: "GET", url: "/api/vibex/feed", headers: { "x-voidex-client": "web" } });
    expect(anon.statusCode).toBe(401);
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

describe("vibex step 2.3: follows, profile, privacy, threads, media, voice, notifications", () => {
  it("A follows B: counters, B gets a follow notification live; unfollow", async () => {
    const a = await user("Anna");
    const b = await user("Boris");
    const live = listen(b);
    const f = await a.d.post(`/api/vibex/people/${b.id}/follow`);
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ followed: true, followers: 1 });
    live.stop();
    expect(live.events).toContainEqual(expect.objectContaining({ type: "notification.new", notification: expect.objectContaining({ app: "vibex", type: "vibex.follow", target: { userId: a.id } }) }));
    const seenByB = (await b.d.get(`/api/vibex/people/${b.id}`)).body;
    expect(seenByB).toMatchObject({ followers: 1, following: 0, me: true });
    expect((await b.d.get(`/api/vibex/people/${a.id}`)).body).toMatchObject({ followsMe: true, followed: false, following: 1 });
    expect((await b.d.get(`/api/vibex/people/${b.id}/followers`)).body.map((p: { id: string }) => p.id)).toEqual([a.id]);
    // Following twice notifies once.
    await a.d.post(`/api/vibex/people/${b.id}/follow`);
    const notes = (await b.d.get("/api/notifications")).body;
    expect(notes.items.filter((n: { type: string }) => n.type === "vibex.follow")).toHaveLength(1);
    expect(notes.unread).toBeGreaterThanOrEqual(1);
    const un = await a.d.delete(`/api/vibex/people/${b.id}/follow`);
    expect(un.body).toMatchObject({ followed: false, followers: 0 });
    expect((await a.d.post(`/api/vibex/people/${a.id}/follow`)).status).toBe(400);
  });

  it("profile editor: names on the VOIDEX account, bio / site / city on the profile; a cover only for its owner", async () => {
    const a = await user("Ira");
    const b = await user("Gleb");
    const r = await a.d.patch("/api/vibex/profile", { firstName: "Irina", lastName: "Petrova", bio: " Hello ", website: "void-code.ru", city: "Moscow" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bio: "Hello", website: "void-code.ru", city: "Moscow", person: { firstName: "Irina", lastName: "Petrova" } });
    expect((await a.d.get("/api/me")).body.firstName).toBe("Irina");
    expect((await a.d.patch("/api/vibex/profile", { website: "not a site" })).status).toBe(400);
    expect((await a.d.patch("/api/vibex/profile", { bio: "x".repeat(241) })).status).toBe(400);
    // Cover: images only, by content.
    expect((await a.d.request("PUT", "/api/vibex/profile/cover", PDF, { headers: { "content-type": "application/octet-stream" } })).status).toBe(400);
    const cov = await a.d.request("PUT", "/api/vibex/profile/cover", PNG, { headers: { "content-type": "application/octet-stream" } });
    expect(cov.body.coverVersion).toBe(1);
    const seen = await env.app.inject({ method: "GET", url: `/api/vibex/people/${a.id}/cover`, headers: { "x-voidex-client": "web", "x-test-client": b.d.testClientId, authorization: `Bearer ${b.d.accessToken}` } });
    expect(seen.statusCode).toBe(200);
    expect(seen.headers["content-type"]).toContain("image/png");
    // There is no way to edit someone else's profile: the route only ever acts on the caller.
    await b.d.patch("/api/vibex/profile", { bio: "B's own" });
    expect((await b.d.get(`/api/vibex/people/${a.id}`)).body.bio).toBe("Hello");
    expect((await a.d.delete("/api/vibex/profile/cover")).body.coverVersion).toBe(0);
  });

  it("privacy: followers-only posts / profile, who can write, blocked people, read receipts", async () => {
    const a = await user("Polina");
    const b = await user("Roman");
    await a.d.post("/api/vibex/posts", { text: "for followers" });
    await a.d.patch("/api/vibex/profile", { bio: "secret bio" });
    await a.d.patch("/api/vibex/settings", { privacy: { posts: "followers", profile: "followers", messages: "followers" } });
    expect((await b.d.get(`/api/vibex/people/${a.id}/posts`)).body.items).toHaveLength(0);
    expect((await b.d.get(`/api/vibex/people/${a.id}`)).body).toMatchObject({ bio: "", visible: false, canMessage: false, posts: 0 });
    const chat = (await b.d.post("/api/vibex/chats/direct", { userId: a.id })).body;
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "hi" })).status).toBe(403);
    await b.d.post(`/api/vibex/people/${a.id}/follow`);
    expect((await b.d.get(`/api/vibex/people/${a.id}/posts`)).body.items).toHaveLength(1);
    expect((await b.d.get(`/api/vibex/people/${a.id}`)).body).toMatchObject({ bio: "secret bio", visible: true, canMessage: true });
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "hi" })).status).toBe(201);
    // Blocked: no messages, no follow.
    await a.d.patch("/api/vibex/settings", { privacy: { blocked: [b.id] } });
    expect((await b.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "again" })).status).toBe(403);
    // Read receipts off: nobody sees them.
    await a.d.patch("/api/vibex/settings", { privacy: { blocked: [], readReceipts: false } });
    await a.d.post(`/api/vibex/chats/${chat.id}/read`);
    expect((await b.d.get(`/api/vibex/chats/${chat.id}`)).body.peerReadAt).toBeNull();
    // Only my own settings change.
    expect((await b.d.get("/api/vibex/settings")).body.privacy.readReceipts).toBe(true);
  });

  it("comment threads: root, reply, reply to a reply — one level, @name, counts, notifications", async () => {
    const a = await user("Alla");
    const b = await user("Bogdan");
    const c = await user("Vika");
    const post = (await a.d.post("/api/vibex/posts", { text: "Thread me" })).body;
    const liveA = listen(a);
    const root = (await b.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "root" })).body;
    liveA.stop();
    expect(liveA.events).toContainEqual(expect.objectContaining({ type: "notification.new", notification: expect.objectContaining({ type: "vibex.comment", target: expect.objectContaining({ postId: post.id }) }) }));
    const liveB = listen(b);
    const r1 = (await c.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "reply 1", replyToId: root.id })).body;
    liveB.stop();
    expect(liveB.events).toContainEqual(expect.objectContaining({ type: "notification.new", notification: expect.objectContaining({ type: "vibex.reply" }) }));
    const r2 = (await b.d.post(`/api/vibex/posts/${post.id}/comments`, { text: "reply to reply", replyToId: r1.id })).body;
    expect(r1).toMatchObject({ rootId: root.id, replyTo: { commentId: root.id, person: { id: b.id } } });
    expect(r2).toMatchObject({ rootId: root.id, replyTo: { commentId: r1.id, person: { id: c.id } } });
    const list = (await a.d.get(`/api/vibex/posts/${post.id}/comments`)).body;
    expect(list.find((x: { id: string }) => x.id === root.id).replies).toBe(2);
    // A reply to a comment of another post is refused.
    const other = (await a.d.post("/api/vibex/posts", { text: "Other" })).body;
    expect((await c.d.post(`/api/vibex/posts/${other.id}/comments`, { text: "x", replyToId: root.id })).status).toBe(404);
    // Removing the root takes its thread with it.
    await b.d.delete(`/api/vibex/comments/${root.id}`);
    expect((await a.d.get(`/api/vibex/posts/${post.id}/comments`)).body).toHaveLength(0);
  });

  it("profile media: post photos and videos appear automatically; others' media follow privacy", async () => {
    const a = await user("Maya");
    const b = await user("Nikita");
    const img = (await upload(a, "pic.png", PNG, "post")).body;
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const vid = await upload(a, "clip.webm", webm, "post");
    expect(vid.status).toBe(201);
    expect(vid.body.kind).toBe("video");
    await a.d.post("/api/vibex/posts", { text: "media", mediaIds: [img.id, vid.body.id] });
    const photos = (await b.d.get(`/api/vibex/people/${a.id}/media?kind=photo`)).body;
    expect(photos.items.map((i: { file: { id: string } }) => i.file.id)).toEqual([img.id]);
    const videos = (await b.d.get(`/api/vibex/people/${a.id}/media?kind=video`)).body;
    expect(videos.items.map((i: { file: { id: string } }) => i.file.id)).toEqual([vid.body.id]);
    expect((await download(b, img.id)).statusCode).toBe(200);
    await a.d.patch("/api/vibex/settings", { privacy: { posts: "followers" } });
    expect((await b.d.get(`/api/vibex/people/${a.id}/media?kind=photo`)).body.items).toHaveLength(0);
    expect((await download(b, img.id)).statusCode).toBe(404);
    // A PDF is never a post medium.
    expect((await upload(a, "doc.pdf", PDF, "post")).status).toBe(415);
  });

  it("voice messages and video circles: one recorded file of the right type; replies; notification collapses per chat", async () => {
    const a = await user("Olya");
    const b = await user("Petr");
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body;
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const voice = (await upload(a, "voice.weba", webm, "voice" as "message")).body;
    expect(voice.kind).toBe("audio");
    // A voice message has exactly one file and no text.
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "voice", fileIds: [voice.id], text: "x", durationMs: 3000 })).status).toBe(400);
    const sent = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "voice", fileIds: [voice.id], durationMs: 3200 });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ kind: "voice", durationMs: 3200, files: [{ kind: "audio" }] });
    // A chat file can't be sent as a circle (purpose is checked).
    const doc = (await upload(a, "doc.pdf", PDF)).body;
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "circle", fileIds: [doc.id], durationMs: 1000 })).status).toBe(404);
    const circle = (await upload(a, "circle.webm", webm, "circle" as "message")).body;
    expect((await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "circle", fileIds: [circle.id], durationMs: 61_000 })).status).toBe(400);
    const c = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "circle", fileIds: [circle.id], durationMs: 5000, replyToId: sent.body.id });
    expect(c.body).toMatchObject({ kind: "circle", replyTo: { id: sent.body.id, kind: "voice" } });
    // B: one (collapsed) unread notification for this chat; opening the chat reads it.
    const notes = (await b.d.get("/api/notifications")).body;
    const forChat = notes.items.filter((n: { target: { chatId?: string } }) => n.target.chatId === chat.id);
    expect(forChat).toHaveLength(1);
    expect(forChat[0]).toMatchObject({ app: "vibex", type: "vibex.message", read: false });
    await b.d.post(`/api/vibex/chats/${chat.id}/read`);
    expect((await b.d.get("/api/notifications")).body.items.find((n: { id: string }) => n.id === forChat[0].id).read).toBe(true);
  });
});

describe("notification center", () => {
  it("mail → notification for the recipient; read, read all, remove, clear; nobody touches another's", async () => {
    const a = await user("Mark");
    const b = await user("Nina");
    const draft = await a.d.post("/api/mail/drafts", { to: [b.address], subject: "Hello Nina", body: "Text" });
    const sent = await a.d.post(`/api/mail/drafts/${draft.body.id}/send`);
    expect(sent.status).toBeLessThan(300);
    const list = (await b.d.get("/api/notifications")).body;
    const mail = list.items.find((n: { app: string }) => n.app === "mail");
    expect(mail).toMatchObject({ type: "mail.new", body: "Hello Nina", read: false, target: { threadId: sent.body.threadId }, actor: { id: a.id } });
    // A can't read or remove B's notifications.
    expect((await a.d.post(`/api/notifications/${mail.id}/read`)).status).toBe(404);
    expect((await a.d.delete(`/api/notifications/${mail.id}`)).status).toBe(404);
    expect((await b.d.post(`/api/notifications/${mail.id}/read`)).status).toBe(200);
    expect((await b.d.get("/api/notifications")).body.unread).toBe(0);
    await b.d.post("/api/notifications/dev/system-update", { title: "VOIDEX 2.3", body: "New features", version: "2.3" });
    const sys = (await b.d.get("/api/notifications")).body.items.find((n: { app: string }) => n.app === "system");
    expect(sys).toMatchObject({ type: "system.update", title: "VOIDEX 2.3", target: { version: "2.3" } });
    await b.d.post("/api/notifications/read-all");
    expect((await b.d.get("/api/notifications")).body.unread).toBe(0);
    expect((await b.d.delete(`/api/notifications/${sys.id}`)).status).toBe(200);
    await b.d.delete("/api/notifications");
    expect((await b.d.get("/api/notifications")).body.items).toHaveLength(0);
    const anon = await env.app.inject({ method: "GET", url: "/api/notifications", headers: { "x-voidex-client": "web" } });
    expect(anon.statusCode).toBe(401);
  });
});
