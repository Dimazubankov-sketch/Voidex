import type { FastifyPluginAsync } from "fastify";
import { ErrorCode, NOTES_DOC_MAX_BYTES, NOTES_MEDIA_MAX_BYTES, NOTES_NAME_MAX } from "@voidex/shared";
import { z } from "zod";
import { parse } from "../http.js";
import { fail } from "../lib/errors.js";
import { looksLike } from "../lib/file-types.js";

const id = z.string().uuid();
const idParam = z.object({ id });
const name = z.string().max(NOTES_NAME_MAX * 2);
const cover = z.string().max(200).nullable();
const resource = z.object({ type: z.enum(["project", "document"]), id });
const memberParam = resource.extend({ userId: id });
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
const mediaQuery = z.object({ id });
const projectBody = z.object({ name: name.default("") });
const projectPatch = z.object({ name: name.optional(), cover: cover.optional(), position: z.number().int().min(-2_000_000).max(2_000_000).optional() });
const docCreate = z.object({ kind: z.enum(["note", "presentation"]), name: name.default(""), format: z.enum(["vertical", "square", "rect"]).optional(), data: z.unknown().optional() });
const docSave = z.object({ data: z.unknown(), revision: z.number().int().min(0) });
const docPatch = projectPatch;
const roleBody = z.object({ role: z.enum(["editor", "viewer"]) });
const shareBody = z.object({
  resourceType: z.enum(["project", "document"]),
  resourceId: id,
  mode: z.enum(["copy", "access"]),
  role: z.enum(["editor", "viewer"]).default("viewer"),
  recipientIds: z.array(id).max(50).optional(),
});
const acceptBody = z.object({ copy: z.boolean().default(false) });
const prefsBody = z
  .object({
    projectsView: z.enum(["grid", "list"]),
    projectsSort: z.enum(["custom", "name", "modified", "created"]),
    docsView: z.enum(["grid", "list"]),
    docsSort: z.enum(["custom", "name", "modified", "created"]),
  })
  .partial();

/** JPEG / PNG / WebP / GIF by content. SVG (scriptable) is never accepted. */
function sniffNotesImage(b: Buffer): string | null {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) if (looksLike(t, b)) return t;
  return null;
}

/**
 * Voidex Notes API (Step 2.6): projects, documents (notes / presentations),
 * people with access, share links, images, list preferences. Every route acts
 * as the signed-in account; NotesService checks the role on every request.
 */
export const notesRoutes: FastifyPluginAsync = async (app) => {
  const { notes } = app.services;
  const scale = app.ctx.config.rateLimitScale;
  const limit = (max: number) => ({ config: { rateLimit: { max: max * scale, timeWindow: "1 minute" } } });
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "image/gif", "application/octet-stream"], { parseAs: "buffer", bodyLimit: NOTES_MEDIA_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  app.addHook("preHandler", app.authenticate);
  app.addHook("onSend", async (_req, reply) => {
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });
  const me = (req: { auth?: { userId: string } | null }) => req.auth!.userId;
  const session = (req: { auth?: { sessionId?: string } | null }) => req.auth?.sessionId;

  // projects
  app.get("/projects", async (req) => notes.listProjects(me(req)));
  app.post("/projects", limit(60), async (req, reply) => {
    reply.status(201);
    return notes.createProject(me(req), parse(projectBody, req.body).name);
  });
  app.get("/projects/:id", async (req) => notes.project(me(req), parse(idParam, req.params).id));
  app.patch("/projects/:id", limit(240), async (req) => notes.updateProject(me(req), parse(idParam, req.params).id, parse(projectPatch, req.body), session(req)));
  app.delete("/projects/:id", limit(60), async (req) => notes.deleteProject(me(req), parse(idParam, req.params).id));

  // documents
  app.post("/projects/:id/documents", { bodyLimit: NOTES_DOC_MAX_BYTES + 64 * 1024, ...limit(120) }, async (req, reply) => {
    reply.status(201);
    return notes.createDocument(me(req), parse(idParam, req.params).id, parse(docCreate, req.body), session(req));
  });
  app.get("/documents/:id", async (req) => notes.document(me(req), parse(idParam, req.params).id));
  app.put("/documents/:id", { bodyLimit: NOTES_DOC_MAX_BYTES + 64 * 1024, ...limit(600) }, async (req) =>
    notes.saveDocument(me(req), parse(idParam, req.params).id, parse(docSave, req.body), session(req)),
  );
  app.patch("/documents/:id", limit(240), async (req) => notes.updateDocument(me(req), parse(idParam, req.params).id, parse(docPatch, req.body), session(req)));
  app.delete("/documents/:id", limit(60), async (req) => notes.deleteDocument(me(req), parse(idParam, req.params).id));

  // people with access
  app.get("/access/:type/:id", async (req) => {
    const r = parse(resource, req.params);
    return notes.members(me(req), r.type, r.id);
  });
  app.patch("/access/:type/:id/:userId", limit(120), async (req) => {
    const r = parse(memberParam, req.params);
    return notes.setMemberRole(me(req), r.type, r.id, r.userId, parse(roleBody, req.body).role);
  });
  app.delete("/access/:type/:id/:userId", limit(120), async (req) => {
    const r = parse(memberParam, req.params);
    return notes.removeMember(me(req), r.type, r.id, r.userId);
  });
  app.get("/access/:type/:id/links", async (req) => {
    const r = parse(resource, req.params);
    return notes.listShares(me(req), r.type, r.id);
  });

  // share links
  app.post("/shares", { ...limit(60) }, async (req, reply) => {
    reply.status(201);
    return notes.createShare(me(req), parse(shareBody, req.body));
  });
  app.get("/shares/:token", limit(240), async (req) => notes.shareInfo(me(req), parse(tokenParam, req.params).token));
  app.post("/shares/:token/accept", limit(60), async (req) => notes.acceptShare(me(req), parse(tokenParam, req.params).token, parse(acceptBody, req.body ?? {})));
  app.delete("/shares/:token", limit(60), async (req) => notes.revokeShare(me(req), parse(tokenParam, req.params).token));

  // list preferences
  app.get("/prefs", async (req) => notes.prefs(me(req)));
  app.put("/prefs", limit(120), async (req) => notes.setPrefs(me(req), parse(prefsBody, req.body)));

  // images
  app.post("/media", { bodyLimit: NOTES_MEDIA_MAX_BYTES, ...limit(60) }, async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG, WebP or GIF image.");
    const mime = sniffNotesImage(body);
    if (!mime) throw fail(ErrorCode.AttachmentTypeNotAllowed, "Upload a JPEG, PNG, WebP or GIF image.");
    reply.status(201);
    return notes.upload(me(req), mime, body);
  });
  app.get("/media", async (req, reply) => {
    const { id: mediaId } = parse(mediaQuery, req.query);
    const m = await notes.media(me(req), mediaId);
    reply.header("Cache-Control", "private, max-age=86400");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.type(m.mimeType).send(m.data);
  });
};
