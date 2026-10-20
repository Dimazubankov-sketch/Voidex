import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexPersonDto } from "@voidex/shared";
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
  const r = await signUp(d, { firstName: first, lastName: "Советов" });
  const act = await d.post("/api/vibex/activate", { email: r.address, password: STRONG_PASSWORD });
  if (act.status !== 200) throw new Error(`activate failed: ${JSON.stringify(act.body)}`);
  return { d, id: r.user.id as string };
}
const ids = (body: VibexPersonDto[]) => body.map((p) => p.id);

describe("Step 2.16: people to follow for an empty «Подписки»", () => {
  it("suggests others (people who post first), never me, and never someone I already follow", async () => {
    const me = await user("Ия");
    const writer = await user("Пишущий");
    const quiet = await user("Тихий");
    expect((await writer.d.post("/api/vibex/posts", { text: "свежий пост" })).status).toBe(201);
    const first = await me.d.get("/api/vibex/people/suggested");
    expect(first.status).toBe(200);
    const list = ids(first.body);
    expect(list).not.toContain(me.id);
    expect(list).toContain(writer.id);
    // Someone who posts comes before someone who doesn't.
    if (list.includes(quiet.id)) expect(list.indexOf(writer.id)).toBeLessThan(list.indexOf(quiet.id));
    expect((await me.d.post(`/api/vibex/people/${writer.id}/follow`)).status).toBe(200);
    expect(ids((await me.d.get("/api/vibex/people/suggested")).body)).not.toContain(writer.id);
    // Someone else's suggestions are their own.
    expect(ids((await quiet.d.get("/api/vibex/people/suggested")).body)).toContain(writer.id);
    expect((await new Device(env.app).get("/api/vibex/people/suggested")).status).toBe(401);
  });
});
