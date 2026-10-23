import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VibexChatDto, VibexMessageDto, VibexPage, VibexPostDto } from "@voidex/shared";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

/** Update 3: «Медиа» never holds video circles (data level); a profile's sections come apart on the server. */
let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
// A tiny MP4 header ("ftyp" box): enough for the type check.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12)]);

async function user(first: string, last = "Третий") {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: last });
  return { d, id: r.user.id as string };
}
type U = Awaited<ReturnType<typeof user>>;
function upload(u: U, name: string, data: Buffer, purpose: "message" | "post" | "circle" = "message") {
  return u.d.post(`/api/vibex/files?purpose=${purpose}`, data, { headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
}

describe("E1: «Медиа» is photos and video files; video circles are in «Голосовые и видео»", () => {
  it("a circle (a video file of its own) never shows in the media tab; an ordinary video file does", async () => {
    const [a, b] = [await user("Медиа"), await user("Кружок")];
    const chat = (await a.d.post("/api/vibex/chats/direct", { userId: b.id })).body as VibexChatDto;
    const photo = (await upload(a, "photo.png", PNG)).body;
    const p = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [photo.id] });
    expect(p.status).toBe(201);
    const video = await upload(a, "clip.mp4", MP4);
    let videoMsg: VibexMessageDto | null = null;
    if (video.status === 201) videoMsg = (await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { text: "", fileIds: [video.body.id] })).body as VibexMessageDto;
    const circleFile = (await upload(a, "circle.webm", WEBM, "circle")).body;
    const circle = await a.d.post(`/api/vibex/chats/${chat.id}/messages`, { kind: "circle", fileIds: [circleFile.id], durationMs: 4000 });
    expect(circle.status).toBe(201);
    const tab = async (kind: string) => ((await b.d.get(`/api/vibex/chats/${chat.id}/media?kind=${kind}`)).body as VibexPage<VibexMessageDto>).items.map((m) => m.id);
    const media = await tab("media");
    expect(media).toContain(p.body.id);
    if (videoMsg) expect(media).toContain(videoMsg.id);
    expect(media).not.toContain(circle.body.id);
    expect(await tab("voice")).toEqual([circle.body.id]);
    expect(await tab("gifs")).toEqual([]);
  });
});

describe("G1: a profile's «Посты», «Репосты» and «Видео» come apart on the server", () => {
  it("own posts, shares of other people's posts and own videos are separate lists; nothing is lost", async () => {
    const [a, b] = [await user("Автор"), await user("Друг")];
    const own = (await a.d.post("/api/vibex/posts", { text: "мой пост" })).body as VibexPostDto;
    const theirs = (await b.d.post("/api/vibex/posts", { text: "чужой пост" })).body as VibexPostDto;
    expect((await a.d.post(`/api/vibex/posts/${theirs.id}/repost`, {})).status).toBeLessThan(300);
    const v = await upload(a, "clip.mp4", MP4, "post");
    const list = async (kind?: string) => ((await b.d.get(`/api/vibex/people/${a.id}/posts${kind ? `?kind=${kind}` : ""}`)).body as VibexPage<VibexPostDto>).items;
    let withVideo: VibexPostDto | null = null;
    if (v.status === 201) withVideo = (await a.d.post("/api/vibex/posts", { text: "видео", mediaIds: [v.body.id] })).body as VibexPostDto;
    const all = await list();
    const posts = await list("post");
    const reposts = await list("repost");
    expect(posts.every((p) => p.kind === "post")).toBe(true);
    expect(posts.map((p) => p.id)).toContain(own.id);
    expect(reposts.map((p) => p.kind)).toEqual(["repost"]);
    expect(reposts[0]!.repostOf?.id).toBe(theirs.id);
    expect(all.length).toBe(posts.length + reposts.length);
    const videos = await list("video");
    if (withVideo) expect(videos.map((p) => p.id)).toEqual([withVideo.id]);
    else expect(videos).toEqual([]);
    // «Фото»: own posts with a photo.
    const pic = (await upload(a, "p.png", PNG, "post")).body;
    const withPhoto = (await a.d.post("/api/vibex/posts", { text: "фото", mediaIds: [pic.id] })).body as VibexPostDto;
    expect((await list("photo")).map((p) => p.id)).toEqual([withPhoto.id]);
    expect((await b.d.get(`/api/vibex/people/${a.id}/posts?kind=everything`)).status).toBe(400);
  });
});
