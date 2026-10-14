import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { APP_REGISTRY, defaultLayout, type InstalledAppDto, type NotificationListDto, type Preferences, type StoreReviewDto } from "@voidex/shared";
import { installedApps } from "../src/db/schema.js";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Двенадцатый" });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;

const apps = async (u: U) => (await u.d.get("/api/apps")).body as InstalledAppDto[];
const app = async (u: U, id: string) => (await apps(u)).find((a) => a.id === id)!;
const storeNotes = async (u: U) => ((await u.d.get("/api/notifications")).body as NotificationListDto).items.filter((n) => n.app === "store");
/** As after a VOIDEX release that brought a newer version: the account still has an older one recorded. */
async function older(u: U, id: string, version = "0.9.0") {
  await apps(u); // the rows exist
  await env.app.ctx.db.update(installedApps).set({ version }).where(and(eq(installedApps.userId, u.id), eq(installedApps.appId, id)));
}
const prefs = async (u: U, store: Partial<Preferences["store"]>) => {
  const r = await u.d.patch("/api/preferences", { store });
  expect(r.status).toBe(200);
  return r.body as Preferences;
};

describe("Step 2.12: Store preferences", () => {
  it("auto-update and update notifications are on by default and persist", async () => {
    const a = await user("Алиса");
    const me = (await a.d.get("/api/me")).body as { preferences: Preferences };
    expect(me.preferences.store).toEqual({ autoUpdate: true, updateNotifications: true });
    expect((await prefs(a, { autoUpdate: false })).store).toEqual({ autoUpdate: false, updateNotifications: true });
    expect((await prefs(a, { updateNotifications: false })).store).toEqual({ autoUpdate: false, updateNotifications: false });
    expect(((await a.d.get("/api/me")).body as { preferences: Preferences }).preferences.store).toEqual({ autoUpdate: false, updateNotifications: false });
  });
});

describe("Step 2.12: updates", () => {
  it("nothing to update when the installed version is the registry's: no notification, no update date", async () => {
    const a = await user("Борис");
    for (const x of await apps(a)) {
      expect(x.version).toBe(x.manifest.version);
      expect(x.updatedAt).toBeNull();
      expect(x.autoUpdate).toBeNull();
    }
    expect(await storeNotes(a)).toHaveLength(0);
  });

  it("auto-update on (default): an older version is updated by itself, with one notification", async () => {
    const a = await user("Вера");
    await older(a, "notes");
    const notes = await app(a, "notes");
    expect(notes.version).toBe(APP_REGISTRY.notes.version);
    expect(notes.updatedAt).not.toBeNull();
    await apps(a);
    const n = await storeNotes(a);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: "store.update", target: { appId: "notes", version: APP_REGISTRY.notes.version, kind: "updated" } });
  });

  it("auto-update off: the update waits (one 'available' notification); Install records the new version and the update date", async () => {
    const a = await user("Глеб");
    await prefs(a, { autoUpdate: false });
    await older(a, "notes");
    expect((await app(a, "notes")).version).toBe("0.9.0");
    expect((await app(a, "notes")).version).toBe("0.9.0");
    const n = await storeNotes(a);
    expect(n).toHaveLength(1);
    expect(n[0]!.target).toMatchObject({ appId: "notes", kind: "available" });
    const r = await a.d.post("/api/store/apps/notes/install");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: APP_REGISTRY.notes.version });
    expect((r.body as InstalledAppDto).updatedAt).not.toBeNull();
    // A reinstall of the same version is not an update.
    const again = (await a.d.post("/api/store/apps/notes/install")).body as InstalledAppDto;
    expect(again.updatedAt).toBe((r.body as InstalledAppDto).updatedAt);
  });

  it("update notifications off: no notification, the update still shows", async () => {
    const a = await user("Дина");
    await prefs(a, { autoUpdate: false, updateNotifications: false });
    await older(a, "mail");
    expect((await app(a, "mail")).version).toBe("0.9.0");
    expect(await storeNotes(a)).toHaveLength(0);
  });

  it("an app's own choice wins over the global one, and null follows it again", async () => {
    const a = await user("Егор");
    await prefs(a, { updateNotifications: false });
    const off = await a.d.put("/api/store/apps/vibex/auto-update", { autoUpdate: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ id: "vibex", autoUpdate: false });
    await older(a, "vibex");
    expect((await app(a, "vibex")).version).toBe("0.9.0");
    expect((await a.d.put("/api/store/apps/vibex/auto-update", { autoUpdate: null })).body).toMatchObject({ autoUpdate: null });
    expect((await app(a, "vibex")).version).toBe(APP_REGISTRY.vibex.version);
    expect((await a.d.put("/api/store/apps/settings/auto-update", { autoUpdate: false })).status).toBe(404);
    expect((await a.d.put("/api/store/apps/vibex/auto-update", { autoUpdate: "yes" })).status).toBe(400);
  });

  it("an app taken off the desktop is left alone", async () => {
    const a = await user("Жанна");
    const layout = { ...defaultLayout((await apps(a)).map((x) => x.id)), hidden: ["calculator"] };
    expect((await a.d.patch("/api/preferences", { workspace: { layout } })).status).toBe(200);
    await older(a, "calculator");
    expect((await app(a, "calculator")).version).toBe("0.9.0");
  });
});

describe("Step 2.12: my reviews", () => {
  it("lists only my reviews, newest first; empty for someone with none", async () => {
    const [a, b] = [await user("Зоя"), await user("Игорь")];
    expect((await a.d.get("/api/store/me/reviews")).body).toEqual([]);
    await a.d.put("/api/store/apps/notes/review", { rating: 4, title: "Удобно", text: "Пишу каждый день" });
    env.clock.advance(1000);
    await a.d.put("/api/store/apps/mail/review", { rating: 5, title: "", text: "" });
    await b.d.put("/api/store/apps/notes/review", { rating: 2, title: "", text: "" });
    const mine = (await a.d.get("/api/store/me/reviews")).body as StoreReviewDto[];
    expect(mine.map((r) => r.appId)).toEqual(["mail", "notes"]);
    expect(mine.every((r) => r.mine)).toBe(true);
    expect(mine[1]).toMatchObject({ rating: 4, title: "Удобно", text: "Пишу каждый день" });
    expect((await new Device(env.app).get("/api/store/me/reviews")).status).toBe(401);
  });
});
