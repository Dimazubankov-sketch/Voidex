import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { blobs } from "../src/db/schema.js";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function user(first = "Anna") {
  const d = new Device(env.app);
  return { d, ...(await signUp(d, { firstName: first, lastName: "Files" })) };
}

function upload(d: Device, draftId: string, name: string, data: Buffer) {
  return d.post(`/api/mail/drafts/${draftId}/attachments`, data, {
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) },
  });
}

async function draft(d: Device, to: string[]) {
  const r = await d.post("/api/mail/drafts", { to, subject: "Files", body: "See attached" });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function download(d: Device, id: string) {
  const res = await env.app.inject({
    method: "GET",
    url: `/api/mail/attachments/${id}`,
    headers: { "x-voidex-client": "web", "x-test-client": d.testClientId, authorization: `Bearer ${d.accessToken}` },
  });
  return res;
}

describe("mail attachments", () => {
  it("attach image + file, remove one, send; recipient sees and downloads it", async () => {
    const a = await user("Alice");
    const b = await user("Bob");
    const id = await draft(a.d, [b.address]);

    const img = await upload(a.d, id, "фото отпуска.png", PNG);
    expect(img.status).toBe(201);
    expect(img.body).toMatchObject({ filename: "фото отпуска.png", mimeType: "image/png", size: PNG.length });
    const doc = await upload(a.d, id, "report.pdf", PDF);
    expect(doc.status).toBe(201);
    const extra = await upload(a.d, id, "notes.txt", Buffer.from("remove me"));
    expect(extra.status).toBe(201);

    // Removing before sending also removes the stored bytes.
    const blobKeysBefore = await env.app.ctx.db.select({ k: blobs.key }).from(blobs).where(eq(blobs.ownerUserId, a.user.id));
    expect((await a.d.delete(`/api/mail/drafts/${id}/attachments/${extra.body.id}`)).status).toBe(200);
    const blobKeysAfter = await env.app.ctx.db.select({ k: blobs.key }).from(blobs).where(eq(blobs.ownerUserId, a.user.id));
    expect(blobKeysAfter.length).toBe(blobKeysBefore.length - 1);

    const d = await a.d.get(`/api/mail/drafts/${id}`);
    expect(d.body.attachments.map((x: { filename: string }) => x.filename)).toEqual(["фото отпуска.png", "report.pdf"]);

    expect((await a.d.post(`/api/mail/drafts/${id}/send`)).status).toBe(200);

    const inbox = await b.d.get("/api/mail/threads?view=inbox");
    expect(inbox.body.items[0].hasAttachments).toBe(true);
    const thread = await b.d.get(`/api/mail/threads/${inbox.body.items[0].id}`);
    const files = thread.body.messages[0].attachments;
    expect(files).toHaveLength(2);

    const got = await download(b.d, files[0].id);
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toContain("image/png");
    expect(got.headers["content-disposition"]).toContain("attachment;");
    expect(got.headers["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent("фото отпуска.png")}`);
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-security-policy"]).toContain("sandbox");
    expect(got.rawPayload.equals(PNG)).toBe(true);

    // Sender keeps access via Sent.
    expect((await download(a.d, files[1].id)).statusCode).toBe(200);
  });

  it("a third user can't download someone else's attachment", async () => {
    const a = await user();
    const b = await user();
    const c = await user("Eve");
    const id = await draft(a.d, [b.address]);
    const f = await upload(a.d, id, "secret.pdf", PDF);
    await a.d.post(`/api/mail/drafts/${id}/send`);
    expect((await download(c.d, f.body.id)).statusCode).toBe(404);
    // …nor add files to or remove files from someone else's draft.
    const other = await draft(a.d, [b.address]);
    expect((await upload(c.d, other, "x.txt", Buffer.from("x"))).status).toBe(404);
  });

  it("validates type, content, size, count; drafts only", async () => {
    const a = await user();
    const b = await user();
    const id = await draft(a.d, [b.address]);

    expect((await upload(a.d, id, "run.exe", Buffer.from("MZ"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a.d, id, "page.html", Buffer.from("<script>"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a.d, id, "logo.svg", Buffer.from("<svg/>"))).body.error.code).toBe("attachment_type_not_allowed");
    // A renamed file whose bytes don't match the image type is refused.
    expect((await upload(a.d, id, "fake.png", Buffer.from("not an image"))).body.error.code).toBe("attachment_type_not_allowed");
    expect((await upload(a.d, id, "empty.txt", Buffer.alloc(0))).status).toBe(400);

    const big = await upload(a.d, id, "big.txt", Buffer.alloc(10 * 1024 * 1024 + 1, 97));
    expect(big.status).toBe(413);

    for (let i = 0; i < 10; i++) expect((await upload(a.d, id, `f${i}.txt`, Buffer.from(`file ${i}`))).status).toBe(201);
    const eleventh = await upload(a.d, id, "f10.txt", Buffer.from("x"));
    expect(eleventh.body.error.code).toBe("attachment_limit");

    // Sent messages are immutable.
    const id2 = await draft(a.d, [b.address]);
    await a.d.post(`/api/mail/drafts/${id2}/send`);
    expect((await upload(a.d, id2, "late.txt", Buffer.from("x"))).body.error.code).toBe("draft_already_sent");
  });

  it("file names are sanitised", async () => {
    const a = await user();
    const id = await draft(a.d, [a.address]);
    const r = await upload(a.d, id, "../../etc/pa\"ss<wd>.txt", Buffer.from("x"));
    expect(r.status).toBe(201);
    expect(r.body.filename).toBe("passwd.txt"); // path and unsafe characters stripped
  });

  it("deleting a draft deletes its files; forwarding copies them", async () => {
    const a = await user();
    const b = await user();
    const id = await draft(a.d, [b.address]);
    const f = await upload(a.d, id, "keep.pdf", PDF);
    await a.d.post(`/api/mail/drafts/${id}/send`);

    const thread = await b.d.get(`/api/mail/threads/${(await b.d.get("/api/mail/threads?view=inbox")).body.items[0].id}`);
    const msgId = thread.body.messages[0].id;
    const fwd = await b.d.post("/api/mail/drafts", { to: [a.address], subject: "Fwd: Files", body: "", forwardOfMessageId: msgId });
    expect(fwd.status).toBe(201);
    expect(fwd.body.attachments).toHaveLength(1);
    expect(fwd.body.attachments[0].id).not.toBe(f.body.id);
    const copy = await download(b.d, fwd.body.attachments[0].id);
    expect(copy.rawPayload.equals(PDF)).toBe(true);

    const before = (await env.app.ctx.db.select({ k: blobs.key }).from(blobs).where(eq(blobs.ownerUserId, b.user.id))).length;
    expect((await b.d.delete(`/api/mail/drafts/${fwd.body.id}`)).status).toBe(200);
    const after = (await env.app.ctx.db.select({ k: blobs.key }).from(blobs).where(eq(blobs.ownerUserId, b.user.id))).length;
    expect(after).toBe(before - 1);
    // The original stays downloadable for the recipient.
    expect((await download(b.d, f.body.id)).statusCode).toBe(200);
  });
});
