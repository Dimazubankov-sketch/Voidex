import type { FastifyPluginAsync } from "fastify";
import {
  ErrorCode,
  VibexCreatePostSchema,
  VibexCursorQuerySchema,
  VibexPersonPostsQuerySchema,
  VibexFeedQuerySchema,
  VibexHistoryQuerySchema,
  VibexOpenChatSchema,
  VibexCreateGroupSchema,
  VibexUpdateGroupSchema,
  VibexPeopleQuerySchema,
  VibexPinsSchema,
  VibexSendMessageSchema,
  VibexEditMessageSchema,
  VibexDeleteMessagesSchema,
  VibexForwardSchema,
  VibexPinMessageSchema,
  VibexShareSchema,
  VibexCommentSchema,
  VibexEditPostSchema,
  VibexReportSchema,
  VIBEX_COVER_MAX_BYTES,
  VIBEX_MEDIA_MAX_BYTES,
  VibexMediaQuerySchema,
  VibexProfileUpdateSchema,
  VibexSettingsUpdateSchema,
  VibexUploadPurposeSchema,
  VibexViewsSchema,
  VibexChatSearchQuerySchema,
  VibexChatUpdateSchema,
  VibexCreateStorySchema,
  VibexStoryReactSchema,
  VibexStoryReplySchema,
  VibexDeleteChatSchema,
  VibexAddPinSchema,
  VibexClearChatSchema,
  VibexChatMessageSearchSchema,
  VibexChatMediaQuerySchema,
} from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { fail } from "../lib/errors.js";
import { sniffImage } from "../lib/file-types.js";

const UPLOAD_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const uploadKeyParam = z.object({ key: z.string().regex(UPLOAD_KEY) });
const idParam = z.object({ id: z.string().uuid() });
const pinParam = z.object({ id: z.string().uuid(), messageId: z.string().uuid() });
const handleParam = z.object({ handle: z.string().trim().min(1).max(64).regex(/^@?[A-Za-z0-9._-]+$/) });
const purposeQuery = z.object({ purpose: VibexUploadPurposeSchema.default("message") });

/**
 * Vibex API: chats, files, the feed and profiles. Identity is the VOIDEX
 * session — there is no Vibex sign-in (Step 2.3): one VOIDEX account = one
 * Vibex profile, created on first use. Every call acts as the signed-in user
 * (VibexService enforces ownership and privacy).
 */
export const vibexRoutes: FastifyPluginAsync = async (app) => {
  const { vibex, accounts } = app.services;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });
  // Uploads: raw bytes, file name in the X-File-Name header (URI-encoded).
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: VIBEX_MEDIA_MAX_BYTES }, (_req, body, done) => done(null, body));
  app.addHook("preHandler", app.authenticate);

  // ------------------------------------------------------------- profile
  app.get("/me", async (req) => vibex.me(req.auth!.userId));

  /** Retired Step 2.2 sign-in: Vibex uses the VOIDEX session. Answers like /me for older clients. */
  app.post("/activate", async (req) => vibex.me(req.auth!.userId));

  app.get("/settings", async (req) => vibex.settings(req.auth!.userId));
  app.patch("/settings", limit(60), async (req) => vibex.updateSettings(req.auth!.userId, parse(VibexSettingsUpdateSchema, req.body)));

  /** Profile editor: names go to the VOIDEX account (one identity), the rest to the Vibex profile. */
  app.patch("/profile", limit(30), async (req) => {
    const body = parse(VibexProfileUpdateSchema, req.body);
    if (body.firstName !== undefined || body.lastName !== undefined) {
      await accounts.updateProfile(req.auth!.userId, { firstName: body.firstName, lastName: body.lastName });
    }
    return vibex.updateProfile(req.auth!.userId, body);
  });

  app.put("/profile/cover", { bodyLimit: VIBEX_COVER_MAX_BYTES, ...limit(20) }, async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > VIBEX_COVER_MAX_BYTES) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
    const mime = sniffImage(body);
    if (!mime) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
    return vibex.setCover(req.auth!.userId, mime, body);
  });
  app.delete("/profile/cover", async (req) => vibex.deleteCover(req.auth!.userId));

  // ---------------------------------------------------------------- people
  app.get("/people", async (req) => vibex.people(req.auth!.userId, parse(VibexPeopleQuerySchema, req.query).q));

  // Step 2.16: people to follow (before /people/:id, which would take "suggested" for an id).
  app.get("/people/suggested", async (req) => vibex.suggested(req.auth!.userId));
  // Update 2 · C6: a profile link / QR code (@handle) → the person.
  app.get("/people/by-handle/:handle", limit(120), async (req) => vibex.personByHandle(req.auth!.userId, parse(handleParam, req.params).handle));
  app.get("/people/:id", async (req) => vibex.profile(req.auth!.userId, parse(idParam, req.params).id));

  app.get("/people/:id/cover", async (req, reply) => {
    const cover = await vibex.cover(req.auth!.userId, parse(idParam, req.params).id);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.type(cover.mimeType).send(cover.data);
  });

  app.post("/people/:id/follow", limit(120), async (req) => vibex.follow(req.auth!.userId, parse(idParam, req.params).id, true));
  app.delete("/people/:id/follow", limit(120), async (req) => vibex.follow(req.auth!.userId, parse(idParam, req.params).id, false));
  app.get("/people/:id/followers", async (req) => vibex.followList(req.auth!.userId, parse(idParam, req.params).id, "followers"));
  app.get("/people/:id/following", async (req) => vibex.followList(req.auth!.userId, parse(idParam, req.params).id, "following"));

  app.get("/people/:id/media", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexMediaQuerySchema, req.query);
    return vibex.media(req.auth!.userId, id, q.kind, q.before, q.limit);
  });

  app.get("/people/:id/posts", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexPersonPostsQuerySchema, req.query);
    return vibex.personPosts(req.auth!.userId, id, q.before, q.limit, q.kind);
  });

  /** Step 2.9 "Публикации": the person's posts with a photo / video (the same posts, media first). */
  app.get("/people/:id/publications", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.publications(req.auth!.userId, id, q.before, q.limit);
  });

  // ----------------------------------------------------------------- chats
  app.get("/chats", async (req) => vibex.chats(req.auth!.userId));

  app.post("/chats/direct", limit(60), async (req) => vibex.openDirect(req.auth!.userId, parse(VibexOpenChatSchema, req.body).userId));

  // Step 2.4 group chats.
  app.post("/groups", limit(20), async (req, reply) => {
    reply.status(201);
    return vibex.createGroup(req.auth!.userId, parse(VibexCreateGroupSchema, req.body));
  });
  app.patch("/groups/:id", limit(60), async (req) => vibex.updateGroup(req.auth!.userId, parse(idParam, req.params).id, parse(VibexUpdateGroupSchema, req.body)));
  app.post("/groups/:id/leave", limit(30), async (req) => vibex.leaveGroup(req.auth!.userId, parse(idParam, req.params).id));

  app.put("/chats/pins", limit(120), async (req) => vibex.setPins(req.auth!.userId, parse(VibexPinsSchema, req.body).conversationIds));

  /** Step 2.9: people, groups and message text in my chats. */
  app.get("/chats/search", limit(120), async (req) => vibex.searchChats(req.auth!.userId, parse(VibexChatSearchQuerySchema, req.query).q));

  /** Step 2.9: my settings of one chat (notifications on / off). */
  app.patch("/chats/:id", limit(120), async (req) => vibex.updateChat(req.auth!.userId, parse(idParam, req.params).id, parse(VibexChatUpdateSchema, req.body)));

  /** Step 2.9: delete the chat for me, or for everyone (who may: see VibexService.deleteChat). */
  app.post("/chats/:id/delete", limit(60), async (req) => vibex.deleteChat(req.auth!.userId, parse(idParam, req.params).id, parse(VibexDeleteChatSchema, req.body).scope));

  app.get("/chats/:id", async (req) => vibex.chat(req.auth!.userId, parse(idParam, req.params).id));

  /**
   * The history. Reading it never marks the chat read (Step 2.9: a long-press
   * preview uses exactly this); only POST /chats/:id/read does.
   */
  app.get("/chats/:id/messages", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.messages(req.auth!.userId, id, q.before, q.limit);
  });

  app.post("/chats/:id/messages", limit(120), async (req, reply) => {
    const { id } = parse(idParam, req.params);
    reply.status(201);
    const body = parse(VibexSendMessageSchema, req.body);
    // Step 2.6: a Notes link becomes a file card (title and type only; opening it checks access in Notes).
    const notesCard = body.notesToken ? await app.services.notes.card(body.notesToken) : undefined;
    return vibex.send(req.auth!.userId, id, { ...body, notesCard });
  });

  /** Step 2.5: the sender deletes their message for everyone. */
  app.delete("/messages/:id", limit(120), async (req) => vibex.deleteMessage(req.auth!.userId, parse(idParam, req.params).id));
  // Step 2.10: edit, delete several (for me / for everyone), forward, pin.
  app.patch("/messages/:id", limit(120), async (req) => vibex.editMessage(req.auth!.userId, parse(idParam, req.params).id, parse(VibexEditMessageSchema, req.body).text));
  app.post("/messages/delete", limit(60), async (req) => {
    const body = parse(VibexDeleteMessagesSchema, req.body);
    return vibex.deleteMessages(req.auth!.userId, body.ids, body.scope);
  });
  app.post("/messages/forward", limit(30), async (req) => {
    const body = parse(VibexForwardSchema, req.body);
    return vibex.forward(req.auth!.userId, body.messageIds, body.conversationIds);
  });
  app.put("/chats/:id/pin", limit(60), async (req) => vibex.pinMessage(req.auth!.userId, parse(idParam, req.params).id, parse(VibexPinMessageSchema, req.body).messageId));
  // Update 2 · C1: several pinned messages.
  app.post("/chats/:id/pins", limit(60), async (req) => vibex.addPin(req.auth!.userId, parse(idParam, req.params).id, parse(VibexAddPinSchema, req.body).messageId));
  app.delete("/chats/:id/pins/:messageId", limit(60), async (req) => {
    const p = parse(pinParam, req.params);
    return vibex.removePin(req.auth!.userId, p.id, p.messageId);
  });
  // Update 2 · C4 / C5: clear the history, search in a chat, the info tabs.
  app.post("/chats/:id/clear", limit(30), async (req) => vibex.clearChat(req.auth!.userId, parse(idParam, req.params).id, parse(VibexClearChatSchema, req.body).scope));
  app.get("/chats/:id/search", limit(120), async (req) => {
    const q = parse(VibexChatMessageSearchSchema, req.query);
    return vibex.searchInChat(req.auth!.userId, parse(idParam, req.params).id, q.q, q.cursor);
  });
  app.get("/chats/:id/media", limit(240), async (req) => {
    const q = parse(VibexChatMediaQuerySchema, req.query);
    return vibex.chatMedia(req.auth!.userId, parse(idParam, req.params).id, q.kind, q.cursor);
  });

  // Step 2.10: the activity tab (read on the server) and the Search tab.
  app.get("/activity", async (req) => {
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.activity(req.auth!.userId, q.before, q.limit);
  });
  app.get("/activity/count", async (req) => vibex.activityCount(req.auth!.userId));
  app.post("/activity/read", limit(120), async (req) => vibex.readActivity(req.auth!.userId));
  app.get("/search", limit(240), async (req) => vibex.search(req.auth!.userId, parse(VibexPeopleQuerySchema, req.query).q));
  app.get("/explore", async (req) => {
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.explore(req.auth!.userId, q.before, q.limit);
  });

  app.post("/chats/:id/read", async (req) => vibex.read(req.auth!.userId, parse(idParam, req.params).id));

  // ----------------------------------------------------------------- files
  app.post("/files", { bodyLimit: VIBEX_MEDIA_MAX_BYTES, ...limit(60) }, async (req, reply) => {
    const { purpose } = parse(purposeQuery, req.query);
    if (!Buffer.isBuffer(req.body)) throw fail(ErrorCode.ValidationFailed, "Send the file as application/octet-stream.");
    let filename = "";
    try {
      filename = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
    } catch {
      throw fail(ErrorCode.ValidationFailed, "Invalid file name.");
    }
    if (!filename.trim()) throw fail(ErrorCode.ValidationFailed, "The file needs a name.");
    // Step 2.11: the client's own key for this upload, so it can be cancelled at any moment.
    const key = req.headers["x-upload-key"];
    const uploadKey = typeof key === "string" && UPLOAD_KEY.test(key) ? key : undefined;
    reply.status(201);
    return vibex.upload(req.auth!.userId, purpose, { filename, data: req.body, uploadKey });
  });

  app.delete("/files/uploads/:key", limit(120), async (req) => vibex.cancelUpload(req.auth!.userId, parse(uploadKeyParam, req.params).key));

  app.delete("/files/:id", async (req) => vibex.discardUpload(req.auth!.userId, parse(idParam, req.params).id));

  /** Download. Always an attachment inside a sandbox: never rendered as a page. */
  app.get("/files/:id", async (req, reply) => {
    const file = await vibex.file(req.auth!.userId, parse(idParam, req.params).id);
    const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    reply.header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(file.mimeType).send(file.data);
  });

  // ------------------------------------------------------------ feed/posts
  app.get("/feed", async (req) => {
    const q = parse(VibexFeedQuerySchema, req.query);
    return vibex.feed(req.auth!.userId, q.before, q.limit, q.mode);
  });

  app.post("/posts", limit(30), async (req, reply) => {
    reply.status(201);
    return vibex.createPost(req.auth!.userId, parse(VibexCreatePostSchema, req.body));
  });

  /** Step 2.5: posts that were on screen (unique views). */
  app.post("/views", limit(240), async (req) => vibex.view(req.auth!.userId, parse(VibexViewsSchema, req.body).postIds));

  app.get("/posts/:id", async (req) => vibex.post(req.auth!.userId, parse(idParam, req.params).id));

  app.delete("/posts/:id", async (req) => vibex.deletePost(req.auth!.userId, parse(idParam, req.params).id));

  app.patch("/posts/:id", limit(60), async (req) => {
    const { id } = parse(idParam, req.params);
    return vibex.editPost(req.auth!.userId, id, parse(VibexEditPostSchema, req.body).text);
  });

  app.post("/posts/:id/hide", limit(120), async (req) => vibex.hidePost(req.auth!.userId, parse(idParam, req.params).id));

  app.post("/posts/:id/report", limit(30), async (req) => {
    const { id } = parse(idParam, req.params);
    return vibex.report(req.auth!.userId, id, parse(VibexReportSchema, req.body ?? {}).reason);
  });

  app.post("/posts/:id/translate", limit(60), async (req) => vibex.translate(req.auth!.userId, parse(idParam, req.params).id));

  app.get("/posts/:id/comments", async (req) => vibex.comments(req.auth!.userId, parse(idParam, req.params).id));

  app.post("/posts/:id/comments", limit(60), async (req, reply) => {
    const { id } = parse(idParam, req.params);
    reply.status(201);
    const body = parse(VibexCommentSchema, req.body);
    return vibex.addComment(req.auth!.userId, id, body.text, body.replyToId);
  });

  app.delete("/comments/:id", limit(60), async (req) => vibex.deleteComment(req.auth!.userId, parse(idParam, req.params).id));

  app.post("/posts/:id/like", limit(240), async (req) => vibex.like(req.auth!.userId, parse(idParam, req.params).id, true));
  app.delete("/posts/:id/like", limit(240), async (req) => vibex.like(req.auth!.userId, parse(idParam, req.params).id, false));

  app.post("/posts/:id/bookmark", limit(240), async (req) => vibex.bookmark(req.auth!.userId, parse(idParam, req.params).id, true));
  app.delete("/posts/:id/bookmark", limit(240), async (req) => vibex.bookmark(req.auth!.userId, parse(idParam, req.params).id, false));

  app.post("/posts/:id/repost", limit(60), async (req, reply) => {
    reply.status(201);
    return vibex.repost(req.auth!.userId, parse(idParam, req.params).id);
  });
  app.delete("/posts/:id/repost", limit(60), async (req) => vibex.unrepost(req.auth!.userId, parse(idParam, req.params).id));

  app.post("/posts/:id/share", limit(60), async (req) => {
    const { id } = parse(idParam, req.params);
    return vibex.share(req.auth!.userId, id, parse(VibexShareSchema, req.body));
  });

  // --------------------------------------------------------------- stories (Step 2.9)
  app.get("/stories", async (req) => vibex.storyFeed(req.auth!.userId));
  app.get("/stories/archive", async (req) => vibex.storyArchive(req.auth!.userId));
  app.post("/stories", limit(30), async (req, reply) => {
    reply.status(201);
    return vibex.createStory(req.auth!.userId, parse(VibexCreateStorySchema, req.body).fileId);
  });
  app.post("/stories/:id/view", limit(600), async (req) => vibex.viewStory(req.auth!.userId, parse(idParam, req.params).id));
  app.get("/stories/:id/viewers", async (req) => vibex.storyViewers(req.auth!.userId, parse(idParam, req.params).id));
  app.delete("/stories/:id", limit(60), async (req) => vibex.deleteStory(req.auth!.userId, parse(idParam, req.params).id));
  // Step 2.11: a reaction (one, replaceable) and a reply (a direct message) to someone's story.
  app.post("/stories/:id/react", limit(240), async (req) => vibex.reactStory(req.auth!.userId, parse(idParam, req.params).id, parse(VibexStoryReactSchema, req.body).reaction));
  app.post("/stories/:id/reply", limit(60), async (req) => vibex.replyStory(req.auth!.userId, parse(idParam, req.params).id, parse(VibexStoryReplySchema, req.body).text));

  // --------------------------------------------------------------- history
  app.get("/history", async (req) => {
    const q = parse(VibexHistoryQuerySchema, req.query);
    return vibex.history(req.auth!.userId, q.kind, q.before, q.limit);
  });
};
