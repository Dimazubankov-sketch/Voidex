import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function user(first: string, last = "Тестов") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string, address: r.address };
}
const contacts = async (d: Device, q: string) => ((await d.get(`/api/mail/contacts?q=${encodeURIComponent(q)}`)).body as { address: string; name: string | null }[]);

describe("Step 2.8: VoidOps Mail recipient search", () => {
  it("finds everyone with a Vibex chat (any length), not strangers or empty chats", async () => {
    const a = await user("Алиса");
    const friend = await user("Родион", "Чатов");
    const silent = await user("Тихон", "Молчун");
    const stranger = await user("Родион", "Чужой");
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: friend.id })).body as VibexChatDto;
    await friend.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "Привет" });
    // A chat opened but never written in is not "a conversation".
    await a.d.post("/api/vibex/chats/direct", { userId: silent.id });

    const found = await contacts(a.d, "Род");
    expect(found.map((c) => c.address)).toContain(friend.address);
    expect(found.find((c) => c.address === friend.address)?.name).toBe("Родион Чатов");
    expect(found.map((c) => c.address)).not.toContain(stranger.address);
    // By last name, and with an empty query (the recent people).
    expect((await contacts(a.d, "чат")).map((c) => c.address)).toContain(friend.address);
    const recent = (await contacts(a.d, "")).map((c) => c.address);
    expect(recent).toContain(friend.address);
    expect(recent).not.toContain(silent.address);
    expect(recent).not.toContain(a.address);
    // Works both ways: the friend finds Alice.
    expect((await contacts(friend.d, "Али")).map((c) => c.address)).toContain(a.address);
  });
});

describe("Step 2.8: ViCloud and per-app preferences", () => {
  it("defaults, partial updates merged per app, invalid input refused", async () => {
    const a = await user("Настя");
    const me = (await a.d.get("/api/me")).body;
    expect(me.preferences.vicloud).toEqual({ syncFiles: true, syncMedia: true, backup: true, backupMedia: true, backupCellular: false });
    expect(me.preferences.apps).toEqual({});

    let r = await a.d.patch("/api/preferences", { vicloud: { backupCellular: true }, apps: { vibex: { notifications: false } } });
    expect(r.status).toBe(200);
    r = await a.d.patch("/api/preferences", { apps: { vibex: { lock: true }, notes: { lock: true } } });
    expect(r.body.vicloud.backupCellular).toBe(true);
    expect(r.body.vicloud.syncFiles).toBe(true);
    expect(r.body.apps.vibex).toEqual({ notifications: false, lock: true });
    expect(r.body.apps.notes).toEqual({ lock: true });
    // Other preferences stay.
    expect(r.body.notifications.newMailBanner).toBe(true);

    expect((await a.d.patch("/api/preferences", { apps: { nope: { lock: true } } })).status).toBe(400);
    expect((await a.d.patch("/api/preferences", { vicloud: { backup: "yes" } })).status).toBe(400);
  });
});
