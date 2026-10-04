import type { FastifyPluginAsync } from "fastify";
import { ErrorCode, NOTES_DOC_MAX_BYTES, NOTES_MEDIA_MAX_BYTES } from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { fail } from "../lib/errors.js";
import { looksLike } from "../lib/file-types.js";

const saveBody = z.object({ data: z.unknown(), revision: z.number().int().min(0) });
const shareBody = z.object({ data: z.unknown() });
const mediaQuery = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

/** JPEG / PNG / WebP / GIF by content. SVG (scriptable) is never accepted. */
function sniffNotesImage(b: Buffer): string | null {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) if (looksLike(t, b)) return t;
  return null;
}

/**
 * Voidex Notes API (Step 2.5) — the backend of the Notes adapter. Every route
 * acts as the signed-in account; ownership is enforced by NotesService.
 */
export const notesRoutes: FastifyPluginAsync = async (app) => {
  const { notes } = app.services;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "image/gif", "application/octet-stream"], { parseAs: "buffer", bodyLimit: NOTES_MEDIA_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return notes.load(req.auth!.userId);
  });

  app.put("/", { bodyLimit: NOTES_DOC_MAX_BYTES + 64 * 1024, ...limit(240) }, async (req) => {
    const body = parse(saveBody, req.body);
    return notes.save(req.auth!.userId, body.data, body.revision, req.auth!.sessionId);
  });

  app.post("/media", { bodyLimit: NOTES_MEDIA_MAX_BYTES, ...limit(60) }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG, WebP or GIF image.");
    const mime = sniffNotesImage(body);
    if (!mime) throw fail(ErrorCode.AttachmentTypeNotAllowed, "Upload a JPEG, PNG, WebP or GIF image.");
    reply.status(201);
    return notes.upload(req.auth!.userId, mime, body);
  });

  app.get("/media", async (req, reply) => {
    const { id } = parse(mediaQuery, req.query);
    const m = await notes.media(req.auth!.userId, id);
    reply.header("Cache-Control", "private, max-age=86400");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(m.mimeType).send(m.data);
  });

  app.get("/shares", async (req) => notes.listShares(req.auth!.userId));

  app.post("/shares", { bodyLimit: NOTES_DOC_MAX_BYTES + 64 * 1024, ...limit(30) }, async (req, reply) => {
    reply.status(201);
    return notes.createShare(req.auth!.userId, parse(shareBody, req.body).data);
  });

  app.get("/shares/:token", limit(120), async (req) => notes.readShare(parse(tokenParam, req.params).token));

  app.delete("/shares/:token", limit(60), async (req) => notes.revokeShare(req.auth!.userId, parse(tokenParam, req.params).token));
};
