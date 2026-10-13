import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InstalledAppDto, StoreReviewsDto, VibexChatDto, VibexMessageDto, VibexPage, VibexStoryDto, VibexStoryGroupDto, VibexStoryViewerDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

async function user(first: string, last = "Одиннадцатый") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, username: r.username as string, address: r.address as string };
}
type U = Awaited<ReturnType<typeof user>>;

async function story(u: U) {
  const f = await u.d.post("/api/vibex/files?purpose=story", PNG, { headers: { "content-type": "application/octet-stream", "x-file-name": "s.png" } });
  expect(f.status).toBe(201);
  const r = await u.d.post("/api/vibex/stories", { fileId: f.body.id });
  expect(r.status).toBe(201);
  return r.body as VibexStoryDto;
}
const chats = async (u: U) => (await u.d.get("/api/vibex/chats")).body as VibexChatDto[];
const messages = async (u: U, chat: string) => ((await u.d.get(`/api/vibex/chats/${chat}/messages`)).body as VibexPage<VibexMessageDto>).items;
const viewers = async (u: U, id: string) => (await u.d.get(`/api/vibex/stories/${id}/viewers`)).body as VibexStoryViewerDto[];

describe("Step 2.11: story reactions", () => {
  it("one reaction per person, replaceable and removable; the author sees it with the views", async () => {
    const [a, b, c] = [await user("Алла"), await user("Богдан"), await user("Варя")];
    await b.d.post(`/api/vibex/people/${a.id}/follow`);
    await c.d.post(`/api/vibex/people/${a.id}/follow`);
    const s = await story(a);
    expect((await b.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: "❤️" })).status).toBe(200);
    expect((await b.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: "🔥" })).status).toBe(200);
    await c.d.post(`/api/vibex/stories/${s.id}/view`);
    // Only the known quick reactions.
    expect((await b.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: "<b>" })).status).toBe(400);
    // Not on my own story.
    expect((await a.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: "❤️" })).status).toBe(404);

    const list = await viewers(a, s.id);
    expect(list).toHaveLength(2);
    expect(list.find((v) => v.person.id === b.id)!.reaction).toBe("🔥");
    expect(list.find((v) => v.person.id === c.id)!.reaction).toBeNull();
    const mine = ((await a.d.get("/api/vibex/stories")).body as VibexStoryGroupDto[])[0]!.stories[0]!;
    expect(mine).toMatchObject({ views: 2, reactions: 1 });
    const theirs = ((await b.d.get("/api/vibex/stories")).body as VibexStoryGroupDto[]).find((g) => g.person.id === a.id)!.stories[0]!;
    expect(theirs).toMatchObject({ myReaction: "🔥", seen: true, views: 0, reactions: 0 });

    expect((await b.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: null })).status).toBe(200);
    expect((await viewers(a, s.id)).find((v) => v.person.id === b.id)!.reaction).toBeNull();
    // Others never see the viewers.
    expect((await b.d.get(`/api/vibex/stories/${s.id}/viewers`)).status).toBe(404);
  });

  it("a stranger who can't see the story can't react or reply", async () => {
    const [a, stranger] = [await user("Гера"), await user("Дан")];
    expect((await a.d.patch("/api/vibex/settings", { privacy: { posts: "followers" } })).status).toBe(200);
    const s = await story(a);
    expect((await stranger.d.post(`/api/vibex/stories/${s.id}/react`, { reaction: "❤️" })).status).toBe(404);
    expect((await stranger.d.post(`/api/vibex/stories/${s.id}/reply`, { text: "Привет" })).status).toBe(404);
    expect(await viewers(a, s.id)).toEqual([]);
  });
});

describe("Step 2.11: story replies", () => {
  it("a reply is a direct message with the story; the chat is created when there is none", async () => {
    const [a, b] = [await user("Ева"), await user("Жора")];
    await b.d.post(`/api/vibex/people/${a.id}/follow`);
    const s = await story(a);
    expect((await chats(b)).length).toBe(0);
    const r = await b.d.post(`/api/vibex/stories/${s.id}/reply`, { text: "Красиво!" });
    expect(r.status).toBe(200);
    const chatId = r.body.chatId as string;
    expect((await chats(b)).map((c) => c.id)).toEqual([chatId]);
    const [m] = await messages(a, chatId);
    expect(m).toMatchObject({ text: "Красиво!", senderId: b.id, story: { id: s.id, ownerId: a.id, kind: "photo" } });
    expect(m!.story!.file).not.toBeNull();
    // A second reply goes to the same chat.
    const again = await b.d.post(`/api/vibex/stories/${s.id}/reply`, { text: "Ещё" });
    expect(again.body.chatId).toBe(chatId);
    expect((await b.d.post(`/api/vibex/stories/${s.id}/reply`, { text: "   " })).status).toBe(400);
    // Replying counts as a view.
    expect((await viewers(a, s.id)).map((v) => v.person.id)).toEqual([b.id]);
    // Once the story is deleted, the reply stays, without the picture.
    expect((await a.d.delete(`/api/vibex/stories/${s.id}`)).status).toBe(200);
    const after = (await messages(b, chatId)).find((x) => x.text === "Красиво!")!;
    expect(after.story).toMatchObject({ id: s.id, file: null });
    expect((await b.d.post(`/api/vibex/stories/${s.id}/reply`, { text: "Где?" })).status).toBe(404);
  });
});

describe("Step 2.11: Appex Store reviews", () => {
  it("one review per person and app: write, edit, delete; author from the account", async () => {
    const [a, b] = [await user("Зоя", "Петрова"), await user("Иван", "Сидоров")];
    const put = await a.d.put("/api/store/apps/vibex/review", { rating: 5, title: "Отлично", text: "Всё работает" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ rating: 5, title: "Отлично", mine: true, editedAt: null, author: { id: a.id, name: "Петрова Зоя" } });
    expect(put.body.author.address).toMatch(/@voidops$/);
    const edit = await a.d.put("/api/store/apps/vibex/review", { rating: 4, text: "Почти всё работает" });
    expect(edit.body.id).toBe(put.body.id);
    expect(edit.body.editedAt).not.toBeNull();
    await b.d.put("/api/store/apps/vibex/review", { rating: 2 });

    const list = (await b.d.get("/api/store/apps/vibex/reviews")).body as StoreReviewsDto;
    expect(list.items.filter((r) => r.author.id === a.id || r.author.id === b.id)).toHaveLength(2);
    expect(list.mine).toMatchObject({ rating: 2, author: { id: b.id } });
    expect(list.stats.total).toBeGreaterThanOrEqual(2);

    // Not for the Store itself, Settings or unknown apps; rating is required and 1..5.
    expect((await a.d.put("/api/store/apps/store/review", { rating: 5 })).status).toBe(404);
    expect((await a.d.put("/api/store/apps/settings/review", { rating: 5 })).status).toBe(404);
    expect((await a.d.put("/api/store/apps/nope/review", { rating: 5 })).status).toBe(404);
    expect((await a.d.put("/api/store/apps/notes/review", { rating: 6 })).status).toBe(400);
    expect((await a.d.put("/api/store/apps/notes/review", {})).status).toBe(400);

    expect((await b.d.delete("/api/store/apps/vibex/review")).status).toBe(200);
    expect((await b.d.delete("/api/store/apps/vibex/review")).status).toBe(404);
    expect(((await b.d.get("/api/store/apps/vibex/reviews")).body as StoreReviewsDto).mine).toBeNull();
  });

  it("likes and dislikes: one vote per person, switching and taking back; not on my own review", async () => {
    const [a, b, c] = [await user("Кира"), await user("Лев"), await user("Мила")];
    const r = (await a.d.put("/api/store/apps/calculator/review", { rating: 5, text: "Удобно" })).body as { id: string };
    const vote = (u: U, v: number) => u.d.post(`/api/store/apps/calculator/reviews/${r.id}/vote`, { vote: v });
    expect((await vote(b, 1)).body).toEqual({ vote: 1, likes: 1, dislikes: 0 });
    expect((await vote(b, 1)).body).toEqual({ vote: 1, likes: 1, dislikes: 0 });
    expect((await vote(c, -1)).body).toEqual({ vote: -1, likes: 1, dislikes: 1 });
    expect((await vote(b, -1)).body).toEqual({ vote: -1, likes: 0, dislikes: 2 });
    expect((await vote(b, 0)).body).toEqual({ vote: 0, likes: 0, dislikes: 1 });
    expect((await vote(a, 1)).status).toBe(400);
    expect((await vote(b, 2)).status).toBe(400);
    const seen = ((await c.d.get("/api/store/apps/calculator/reviews?sort=helpful")).body as StoreReviewsDto).items.find((x) => x.id === r.id)!;
    expect(seen).toMatchObject({ myVote: -1, likes: 0, dislikes: 1 });
  });

  it("reports: a reason and a description, once per person, never on my own review", async () => {
    const [a, b] = [await user("Нина"), await user("Олег")];
    const r = (await a.d.put("/api/store/apps/files/review", { rating: 1, text: "Плохо" })).body as { id: string };
    const report = (u: U, body: unknown) => u.d.post(`/api/store/apps/files/reviews/${r.id}/report`, body);
    expect((await report(b, { reason: "spam" })).status).toBe(400);
    expect((await report(b, { reason: "nope", description: "x" })).status).toBe(400);
    expect((await report(b, { reason: "spam", description: "Реклама" })).status).toBe(200);
    expect((await report(b, { reason: "abuse", description: "Повтор" })).status).toBe(200);
    expect((await report(a, { reason: "other", description: "Сам" })).status).toBe(400);
    const seen = ((await b.d.get("/api/store/apps/files/reviews")).body as StoreReviewsDto).items.find((x) => x.id === r.id)!;
    expect(seen.reported).toBe(true);
  });

  it("stats: counts per star and the average", async () => {
    const [a, b] = [await user("Пол"), await user("Рита")];
    await a.d.put("/api/store/apps/media/review", { rating: 5 });
    await b.d.put("/api/store/apps/media/review", { rating: 3 });
    const all = (await a.d.get("/api/store/stats")).body as Record<string, { counts: number[]; total: number; average: number }>;
    expect(all.media!.total).toBeGreaterThanOrEqual(2);
    expect(all.media!.counts[4]).toBeGreaterThanOrEqual(1);
    expect(all.media!.counts[2]).toBeGreaterThanOrEqual(1);
  });

  it("requires a VOIDEX session", async () => {
    const d = new Device(env.app);
    expect((await d.get("/api/store/apps/vibex/reviews")).status).toBe(401);
  });
});

describe("Step 2.11: install / update", () => {
  it("records the registry version; the Store is installed for everyone; unknown apps are refused", async () => {
    const a = await user("Сева");
    const apps = (await a.d.get("/api/apps")).body as InstalledAppDto[];
    expect(apps.map((x) => x.id)).toContain("store");
    expect(apps.find((x) => x.id === "vibex")!.version).toBe(apps.find((x) => x.id === "vibex")!.manifest.version);
    const r = await a.d.post("/api/store/apps/notes/install");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "notes", version: r.body.manifest.version });
    expect((await a.d.post("/api/store/apps/nope/install")).status).toBe(404);
    expect((await a.d.post("/api/store/apps/settings/install")).status).toBe(404);
  });
});

describe("Step 2.11: search shows who I follow", () => {
  it("lists the people found that I follow", async () => {
    const [me, x, y] = [await user("Тимур"), await user("Ульяна", "Поисковая"), await user("Фёдор", "Поисковый")];
    await me.d.post(`/api/vibex/people/${x.id}/follow`);
    const r = (await me.d.get(`/api/vibex/search?q=${encodeURIComponent("Поисков")}`)).body as { people: { id: string }[]; following: string[] };
    expect(r.people.map((p) => p.id)).toEqual(expect.arrayContaining([x.id, y.id]));
    expect(r.following).toContain(x.id);
    expect(r.following).not.toContain(y.id);
  });
});
