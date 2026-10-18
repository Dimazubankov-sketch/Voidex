import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexPostDto } from "@voidex/shared";
import { sql } from "drizzle-orm";
import { Device, STRONG_PASSWORD, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Лентова" });
  const act = await d.post("/api/vibex/activate", { email: r.address, password: STRONG_PASSWORD });
  if (act.status !== 200) throw new Error(`activate failed: ${JSON.stringify(act.body)}`);
  return { d, id: r.user.id as string };
}
const texts = (body: { items: VibexPostDto[] }) => body.items.map((p) => p.text);

describe("Step 2.15: Vibex Главная", () => {
  it("«Подписки» has only the posts of the people I follow; «Рекомендации» has everyone's", async () => {
    const me = await user("Мира");
    const followed = await user("Фёдор");
    const stranger = await user("Савва");
    expect((await followed.d.post("/api/vibex/posts", { text: "от подписки" })).status).toBe(201);
    expect((await stranger.d.post("/api/vibex/posts", { text: "от незнакомца" })).status).toBe(201);
    expect((await me.d.post("/api/vibex/posts", { text: "мой пост" })).status).toBe(201);

    // Nobody followed yet: «Подписки» is empty.
    const empty = await me.d.get("/api/vibex/feed?mode=following");
    expect(empty.status).toBe(200);
    expect(texts(empty.body)).not.toContain("от подписки");
    expect(texts(empty.body)).not.toContain("от незнакомца");

    expect((await me.d.post(`/api/vibex/people/${followed.id}/follow`)).status).toBe(200);
    const following = texts((await me.d.get("/api/vibex/feed?mode=following")).body);
    expect(following).toContain("от подписки");
    expect(following).not.toContain("от незнакомца");
    expect(following).not.toContain("мой пост");

    const recommended = texts((await me.d.get("/api/vibex/feed?mode=recommended")).body);
    expect(recommended).toEqual(expect.arrayContaining(["от подписки", "от незнакомца"]));
    // Without a mode: «Рекомендации» (older clients keep working).
    expect(texts((await me.d.get("/api/vibex/feed")).body)).toEqual(recommended);
    expect((await me.d.get("/api/vibex/feed?mode=publications")).status).toBe(400);
  });

  it("the tab is kept in the Vibex settings; older stored values read as «Рекомендации»", async () => {
    const a = await user("Вика");
    expect((await a.d.get("/api/vibex/me")).body.settings.feed).toEqual({ mode: "recommended" });
    expect((await a.d.patch("/api/vibex/settings", { feed: { mode: "following" } })).status).toBe(200);
    expect((await a.d.get("/api/vibex/me")).body.settings.feed).toEqual({ mode: "following" });
    expect((await a.d.patch("/api/vibex/settings", { feed: { mode: "recommended" } })).status).toBe(200);
    // A Step 2.13 value stored before the update.
    await env.app.ctx.db.execute(sql`UPDATE vibex_profiles SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{feed}', '{"mode":"publications"}'::jsonb) WHERE user_id = ${a.id}`);
    expect((await a.d.get("/api/vibex/me")).body.settings.feed).toEqual({ mode: "recommended" });
  });
});
