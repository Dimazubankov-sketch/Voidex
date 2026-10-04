import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexCommentDto, VibexMessageDto, VibexPostDto } from "@voidex/shared";
import { loadConfig } from "../src/config.js";
import { LONG_POST, seedVibexDemo } from "../src/db/demo-seed.js";
import { TEST_DATABASE_URL } from "./global-setup.js";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const testConfig = () => loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL, MAIL_DOMAIN: "voidops.ru", SMS_PROVIDER: "console" } as NodeJS.ProcessEnv);

describe("Vibex demo seed (development / test only)", () => {
  it("refuses a production configuration", async () => {
    const prod = { ...testConfig(), production: true };
    await expect(seedVibexDemo(prod)).rejects.toThrow(/production/i);
  });

  it("fills the feed, comment threads and chats in every state — once", async () => {
    const d = new Device(env.app);
    const me = await signUp(d, { firstName: "Тест", lastName: "Демо" });

    const first = await seedVibexDemo(testConfig(), { target: me.address });
    expect(first.createdAccounts).toBe(7);
    expect(first.addedContent).toBe(true);
    expect(first.seededTarget).toBe(true);

    // Feed: short, long and picture posts; one with several comments and a reply thread.
    const feed = await d.get("/api/vibex/feed");
    expect(feed.status).toBe(200);
    const posts = feed.body.items as VibexPostDto[];
    expect(posts.some((p) => p.text === LONG_POST)).toBe(true);
    expect(posts.some((p) => p.text.length < 40 && p.kind === "post")).toBe(true);
    expect(posts.some((p) => p.media.length > 0)).toBe(true);
    const discussed = posts.find((p) => p.comments >= 6)!;
    expect(discussed).toBeTruthy();
    const comments = (await d.get(`/api/vibex/posts/${discussed.id}/comments`)).body as VibexCommentDto[];
    expect(comments.filter((c) => c.rootId).length).toBeGreaterThanOrEqual(2);

    // Chats: pinned, read, unread (several messages), a picture and a file.
    const chats = (await d.get("/api/vibex/chats")).body as VibexChatDto[];
    expect(chats.length).toBeGreaterThanOrEqual(5);
    expect(chats.filter((c) => c.pinnedPosition !== null)).toHaveLength(1);
    expect(chats.some((c) => c.unread === 0 && c.lastMessage)).toBe(true);
    expect(chats.some((c) => c.unread >= 3)).toBe(true);
    const sofia = chats.find((c) => c.peer.firstName === "Sofia")!;
    const msgs = (await d.get(`/api/vibex/chats/${sofia.id}/messages`)).body.items as VibexMessageDto[];
    expect(msgs.some((m) => m.files.some((f) => f.mimeType.startsWith("image/")))).toBe(true);
    expect(msgs.some((m) => m.files.some((f) => !f.mimeType.startsWith("image/")))).toBe(true);

    // Idempotent: a second run adds nothing.
    const again = await seedVibexDemo(testConfig(), { target: me.address });
    expect(again).toEqual({ createdAccounts: 0, addedContent: false, seededTarget: false, targetMissing: false });
    // An unknown address is reported, not seeded.
    expect((await seedVibexDemo(testConfig(), { target: "nobody-here@voidops.ru" })).targetMissing).toBe(true);
    expect(((await d.get("/api/vibex/chats")).body as VibexChatDto[]).length).toBe(chats.length);
  });
});
