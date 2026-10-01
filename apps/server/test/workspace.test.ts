import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { defaultLayout, dropOnto, normalizeLayout, type WorkspaceLayout } from "@voidex/shared";
import { blobs } from "../src/db/schema.js";
import { Device, STRONG_PASSWORD, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");

describe("workspace layout (server-side, per account)", () => {
  it("is saved with the account and restored on another device after sign-in", async () => {
    const phone = new Device(env.app);
    const u = await signUp(phone);
    let layout = normalizeLayout(null, ["mail", "settings"]);
    layout = dropOnto(layout, "settings", { kind: "app", id: "mail" }, "Работа", "f_work01");
    layout.mobile.columns = 4;
    layout.appearance = { ...layout.appearance, wallpaper: { kind: "preset", id: "wave-milk-violet" }, glass: "medium" };

    const r = await phone.patch("/api/preferences", { workspace: { layout } });
    expect(r.status).toBe(200);
    expect(r.body.workspace.layout.folders).toEqual([{ id: "f_work01", name: "Работа", apps: ["mail", "settings"] }]);

    // A second device (new sign-in) gets the same desktop from the server.
    const pc = new Device(env.app, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/130.0 Safari/537.36");
    const login = await pc.post("/api/auth/login", { identifier: u.address, password: STRONG_PASSWORD });
    expect(login.body.status).toBe("challenge"); // new device: approve from the phone
    const { id, secret } = login.body.challenge;
    await pc.post(`/api/auth/challenges/${id}/device`, { secret });
    const approvals = await phone.get("/api/security/approvals");
    await phone.post(`/api/security/approvals/${approvals.body[0].id}`, { decision: "approve" });
    const done = await pc.post(`/api/auth/challenges/${id}/complete`, { secret });
    expect(done.status).toBe(200);
    const me = await pc.get("/api/me");
    const saved: WorkspaceLayout = me.body.preferences.workspace.layout;
    expect(saved.mobile.columns).toBe(4);
    // Apps the client didn't know about (Vibex) are appended by the server.
    expect(saved.mobile.pages).toEqual([[{ kind: "folder", id: "f_work01" }, { kind: "app", id: "vibex" }]]);
    expect(saved.appearance.wallpaper).toEqual({ kind: "preset", id: "wave-milk-violet" });
    expect(saved.appearance.glass).toBe("medium");
  });

  it("the server normalizes what clients send (duplicates, missing apps)", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const bad = defaultLayout(["mail", "settings"]);
    bad.mobile.pages = [[{ kind: "app", id: "mail" }, { kind: "app", id: "mail" }]];
    const r = await d.patch("/api/preferences", { workspace: { layout: bad } });
    expect(r.body.workspace.layout.mobile.pages).toEqual([[{ kind: "app", id: "mail" }, { kind: "app", id: "settings" }, { kind: "app", id: "vibex" }]]);
  });

  it("layouts saved before Step 2.1 still load: retired wallpapers are mapped, glass defaults to on", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const l = defaultLayout(["mail", "settings"]);
    const { glass: _glass, ...oldAppearance } = l.appearance;
    const r = await d.patch("/api/preferences", { workspace: { layout: { ...l, appearance: { ...oldAppearance, wallpaper: { kind: "gradient", id: "night" } } } } });
    expect(r.status).toBe(200);
    expect(r.body.workspace.layout.appearance.wallpaper).toEqual({ kind: "preset", id: "wave-light" });
    expect(r.body.workspace.layout.appearance.glass).toBe("on");
  });

  it("rejects malformed layouts", async () => {
    const d = new Device(env.app);
    await signUp(d);
    const bad = { ...defaultLayout(["mail", "settings"]), appearance: { wallpaper: { kind: "color", color: "url(javascript:x)" }, labelColor: "auto", labelSize: "m", captions: true } };
    expect((await d.patch("/api/preferences", { workspace: { layout: bad } })).status).toBe(400);
  });
});

describe("wallpaper", () => {
  it("upload replaces the previous one, only the owner can read it, delete removes it", async () => {
    const a = new Device(env.app);
    const ua = await signUp(a);
    const put = (d: Device, data: Buffer) => d.request("PUT", "/api/account/wallpaper", data, { headers: { "content-type": "application/octet-stream" } });

    expect((await put(a, Buffer.from("not an image"))).status).toBe(400);
    const first = await put(a, PNG);
    expect(first.status).toBe(200);
    const second = await put(a, PNG);
    expect(second.body.version).not.toBe(first.body.version);
    const rows = await env.app.ctx.db.select().from(blobs).where(eq(blobs.ownerUserId, ua.user.id));
    expect(rows.filter((r) => r.purpose === "wallpaper")).toHaveLength(1);

    const got = await a.get("/api/account/wallpaper");
    expect(got.status).toBe(200);
    expect(got.raw.headers["content-type"]).toContain("image/png");

    // Another user only ever gets their own (none).
    const b = new Device(env.app);
    await signUp(b);
    expect((await b.get("/api/account/wallpaper")).status).toBe(404);

    expect((await a.delete("/api/account/wallpaper")).status).toBe(200);
    expect((await a.get("/api/account/wallpaper")).status).toBe(404);
  });
});
