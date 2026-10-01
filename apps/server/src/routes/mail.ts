import type { FastifyPluginAsync } from "fastify";
import {
  DraftCreateSchema,
  ErrorCode,
  MAIL_ATTACHMENT_MAX_BYTES,
  DraftInputSchema,
  LANGUAGE_CODES,
  MailListQuerySchema,
  MailMessageFlagSchema,
  MailThreadActionSchema,
  MailThreadQuerySchema,
} from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { fail } from "../lib/errors.js";

const idParam = z.object({ id: z.string().uuid() });

/** VOIDEX Mail API. Every call is scoped to the caller's own mailbox by MailService. */
export const mailRoutes: FastifyPluginAsync = async (app) => {
  const { mail } = app.services;
  // Attachment uploads: raw bytes, file name in the X-File-Name header (URI-encoded).
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAIL_ATTACHMENT_MAX_BYTES }, (_req, body, done) => done(null, body));
  app.addHook("preHandler", app.authenticate);

  app.get("/summary", async (req) => mail.summary(req.auth!.userId));

  app.get("/threads", async (req) => mail.list(req.auth!.userId, parse(MailListQuerySchema, req.query)));

  app.get("/threads/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { view } = parse(MailThreadQuerySchema, req.query);
    return mail.thread(req.auth!.userId, id, view);
  });

  app.post("/threads/actions", async (req) => {
    const body = parse(MailThreadActionSchema, req.body);
    return mail.threadAction(req.auth!.userId, body.threadIds, body.action);
  });

  app.patch("/messages/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.flagMessage(req.auth!.userId, id, parse(MailMessageFlagSchema, req.body));
  });

  app.get("/messages/:id/compose", async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(
      z.object({
        mode: z.enum(["reply", "reply_all", "forward"]),
        lang: z.enum(LANGUAGE_CODES).default("en"),
        tz: z.string().max(64).regex(/^[A-Za-z_+\-/0-9]+$/).optional(),
      }),
      req.query,
    );
    return mail.composeDefaults(req.auth!.userId, id, q.mode, { lang: q.lang, tz: q.tz });
  });

  app.post("/drafts", { config: { rateLimit: { max: 60 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.status(201);
    return mail.createDraft(req.auth!.userId, parse(DraftCreateSchema, req.body));
  });

  app.get("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.getDraft(req.auth!.userId, id);
  });

  app.put("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.updateDraft(req.auth!.userId, id, parse(DraftInputSchema, req.body));
  });

  app.delete("/drafts/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.deleteDraft(req.auth!.userId, id);
  });

  app.post(
    "/drafts/:id/attachments",
    { bodyLimit: MAIL_ATTACHMENT_MAX_BYTES, config: { rateLimit: { max: 60 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      if (!Buffer.isBuffer(req.body)) throw fail(ErrorCode.ValidationFailed, "Send the file as application/octet-stream.");
      let filename = "";
      try {
        filename = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
      } catch {
        throw fail(ErrorCode.ValidationFailed, "Invalid file name.");
      }
      if (!filename.trim()) throw fail(ErrorCode.ValidationFailed, "The file needs a name.");
      reply.status(201);
      return mail.addAttachment(req.auth!.userId, id, { filename, data: req.body });
    },
  );

  app.delete("/drafts/:id/attachments/:attachmentId", async (req) => {
    const { id, attachmentId } = parse(z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }), req.params);
    return mail.removeAttachment(req.auth!.userId, id, attachmentId);
  });

  /** File download. Always served as an attachment inside a sandbox: never rendered as a page. */
  app.get("/attachments/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const file = await mail.attachment(req.auth!.userId, id);
    const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    reply.header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(file.mimeType).send(file.data);
  });

  app.post("/drafts/:id/send", { config: { rateLimit: { max: 30 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return mail.sendDraft(req.auth!.userId, id);
  });

  app.get("/resolve", { config: { rateLimit: { max: 120 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req) => {
    const { address } = parse(z.object({ address: z.string().min(1).max(254) }), req.query);
    return mail.resolveAddress(address);
  });

  app.get("/contacts", async (req) => {
    const { q } = parse(z.object({ q: z.string().max(100).default("") }), req.query);
    return mail.contacts(req.auth!.userId, q);
  });
};
