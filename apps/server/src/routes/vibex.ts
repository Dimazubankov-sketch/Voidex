import type { FastifyPluginAsync } from "fastify";
import {
  ErrorCode,
  VIBEX_FILE_MAX_BYTES,
  VibexCreatePostSchema,
  VibexCursorQuerySchema,
  VibexHistoryQuerySchema,
  VibexOpenChatSchema,
  VibexPeopleQuerySchema,
  VibexPinsSchema,
  VibexSendMessageSchema,
  VibexShareSchema,
  VibexActivateSchema,
  VibexCommentSchema,
  VibexEditPostSchema,
  VibexReportSchema,
} from "@voidex/shared";
import { z } from "zod";
import { parse, requestMeta } from "../http.js";
import { fail } from "../lib/errors.js";

const idParam = z.object({ id: z.string().uuid() });
const purposeQuery = z.object({ purpose: z.enum(["message", "post"]).default("message") });

/** Vibex API: chats, files and the feed. Every call acts as the signed-in user (VibexService enforces ownership). */
export const vibexRoutes: FastifyPluginAsync = async (app) => {
  const { vibex } = app.services;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });
  // Uploads: raw bytes, file name in the X-File-Name header (URI-encoded).
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: VIBEX_FILE_MAX_BYTES }, (_req, body, done) => done(null, body));
  app.addHook("preHandler", app.authenticate);
  // Vibex is activated per VOIDEX account (its own sign-in screen); until then only /me and /activate answer.
  app.addHook("preHandler", async (req) => {
    const path = req.routeOptions.url ?? "";
    if (path.endsWith("/me") || path.endsWith("/activate")) return;
    if (!(await vibex.isActivated(req.auth!.userId))) throw fail(ErrorCode.VibexNotActivated, "Sign in to Vibex first.", { status: 403 });
  });

  // ------------------------------------------------------------- profile
  app.get("/me", async (req) => vibex.me(req.auth!.userId));

  /**
   * Vibex sign-in / registration: the email (VOIDEX Mail address) and password
   * of THIS VOIDEX account. One account = one Vibex profile. Another account's
   * email is answered with vibex_other_account (the client then switches
   * accounts through the normal VOIDEX sign-in); an unknown one as wrong credentials.
   */
  app.post("/activate", limit(10), async (req) => {
    const body = parse(VibexActivateSchema, req.body);
    const { accounts } = app.services;
    const owner = await accounts.findByIdentifier(body.email);
    if (owner && owner.id !== req.auth!.userId && owner.status === "active") {
      throw fail(ErrorCode.VibexOtherAccount, "This email belongs to another VOIDEX account.", { status: 409 });
    }
    if (!owner || !body.email.includes("@")) throw fail(ErrorCode.InvalidCredentials, "Incorrect email or password.");
    await accounts.verifyCredentials(body.email, body.password, requestMeta(req));
    return vibex.activate(req.auth!.userId);
  });

  // ---------------------------------------------------------------- people
  app.get("/people", async (req) => vibex.people(req.auth!.userId, parse(VibexPeopleQuerySchema, req.query).q));

  app.get("/people/:id", async (req) => vibex.profile(req.auth!.userId, parse(idParam, req.params).id));

  app.get("/people/:id/posts", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.personPosts(req.auth!.userId, id, q.before, q.limit);
  });

  // ----------------------------------------------------------------- chats
  app.get("/chats", async (req) => vibex.chats(req.auth!.userId));

  app.post("/chats/direct", limit(60), async (req) => vibex.openDirect(req.auth!.userId, parse(VibexOpenChatSchema, req.body).userId));

  app.put("/chats/pins", limit(120), async (req) => vibex.setPins(req.auth!.userId, parse(VibexPinsSchema, req.body).conversationIds));

  app.get("/chats/:id", async (req) => vibex.chat(req.auth!.userId, parse(idParam, req.params).id));

  app.get("/chats/:id/messages", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.messages(req.auth!.userId, id, q.before, q.limit);
  });

  app.post("/chats/:id/messages", limit(120), async (req, reply) => {
    const { id } = parse(idParam, req.params);
    reply.status(201);
    return vibex.send(req.auth!.userId, id, parse(VibexSendMessageSchema, req.body));
  });

  app.post("/chats/:id/read", async (req) => vibex.read(req.auth!.userId, parse(idParam, req.params).id));

  // ----------------------------------------------------------------- files
  app.post("/files", { bodyLimit: VIBEX_FILE_MAX_BYTES, ...limit(60) }, async (req, reply) => {
    const { purpose } = parse(purposeQuery, req.query);
    if (!Buffer.isBuffer(req.body)) throw fail(ErrorCode.ValidationFailed, "Send the file as application/octet-stream.");
    let filename = "";
    try {
      filename = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
    } catch {
      throw fail(ErrorCode.ValidationFailed, "Invalid file name.");
    }
    if (!filename.trim()) throw fail(ErrorCode.ValidationFailed, "The file needs a name.");
    reply.status(201);
    return vibex.upload(req.auth!.userId, purpose, { filename, data: req.body });
  });

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
    const q = parse(VibexCursorQuerySchema, req.query);
    return vibex.feed(req.auth!.userId, q.before, q.limit);
  });

  app.post("/posts", limit(30), async (req, reply) => {
    reply.status(201);
    return vibex.createPost(req.auth!.userId, parse(VibexCreatePostSchema, req.body));
  });

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
    return vibex.addComment(req.auth!.userId, id, parse(VibexCommentSchema, req.body).text);
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

  // --------------------------------------------------------------- history
  app.get("/history", async (req) => {
    const q = parse(VibexHistoryQuerySchema, req.query);
    return vibex.history(req.auth!.userId, q.kind, q.before, q.limit);
  });
};
