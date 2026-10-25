import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

/** Update 4 · D2: my own wallpapers are a library apart from the built-in ones; only mine, deletable. */
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
  await signUp(d, { firstName: first, lastName: "Обои" });
  return d;
}
const upload = (d: Device, data = PNG) => d.post("/api/account/wallpapers", data, { headers: { "content-type": "application/octet-stream" } });

describe("Update 4 · D2: own wallpapers", () => {
  it("upload, list, apply to a slot, read; delete removes only that picture; other people can't see or delete it", async () => {
    const [a, b] = [await user("Анна"), await user("Борис")];
    const one = await upload(a);
    expect(one.status).toBe(201);
    const two = await upload(a);
    const list = (await a.get("/api/account/wallpapers")).body.wallpapers as { id: string }[];
    expect(list.map((w) => w.id).sort()).toEqual([one.body.id, two.body.id].sort());
    // Applying copies it into the slot: the slot reads as before, the version names the picture.
    const applied = await a.post(`/api/account/wallpapers/${encodeURIComponent(one.body.id)}/apply?slot=lock`, {});
    expect(applied.status).toBe(200);
    expect(applied.body.version).toMatch(/^lib-/);
    expect(applied.body.version).toContain(one.body.id.slice(-16));
    expect((await a.get("/api/account/wallpaper?slot=lock")).status).toBe(200);
    // Not mine: not found.
    expect((await b.get(`/api/account/wallpapers/${encodeURIComponent(one.body.id)}`)).status).toBe(404);
    expect((await b.delete(`/api/account/wallpapers/${encodeURIComponent(one.body.id)}`)).status).toBe(404);
    expect((await b.get("/api/account/wallpapers")).body.wallpapers).toEqual([]);
    // Delete one: only that one goes.
    expect((await a.delete(`/api/account/wallpapers/${encodeURIComponent(two.body.id)}`)).status).toBe(200);
    expect(((await a.get("/api/account/wallpapers")).body.wallpapers as { id: string }[]).map((w) => w.id)).toEqual([one.body.id]);
    // Not an image: refused.
    expect((await upload(a, Buffer.from("<svg/>"))).status).toBe(400);
  });
});
