import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  ApprovalDecisionSchema,
  ErrorCode,
  PasswordChangeSchema,
  PhoneChangeConfirmSchema,
  PhoneChangeStartSchema,
  PreferencesPatchSchema,
  ProfileUpdateSchema,
  type ServerEvent,
  type SessionDto,
} from "@voidex/shared";
import { z } from "zod";
import { devices, mailAccounts, securityEvents, sessions as sessionsTable } from "../db/schema.js";
import { sniffImage } from "../lib/file-types.js";
import { parse, requestMeta } from "../http.js";
import { fail, notFound } from "../lib/errors.js";

const idParam = z.object({ id: z.string().uuid() });
const AVATAR_MAX = 512 * 1024;
/** Wallpapers arrive downscaled by the client; this is a hard ceiling. */
const WALLPAPER_MAX = 8 * 1024 * 1024;


/**
 * Everything here runs as the authenticated user. Identity always comes from
 * the access token (req.auth), never from ids in the request body.
 */
export const accountRoutes: FastifyPluginAsync = async (app) => {
  const { accounts, sessions, challenges, apps } = app.services;
  const { db } = app.ctx;

  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp"], { parseAs: "buffer", bodyLimit: AVATAR_MAX }, (_req, body, done) =>
    done(null, body),
  );

  // Wallpaper upload: raw image bytes (type sniffed from the content).
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: WALLPAPER_MAX }, (_req, body, done) => done(null, body));

  app.addHook("preHandler", app.authenticate);

  // ---------------------------------------------------------------- account

  app.get("/me", async (req) => accounts.me(req.auth!.userId));

  app.patch("/account/profile", async (req) => accounts.updateProfile(req.auth!.userId, parse(ProfileUpdateSchema, req.body)));

  app.put("/account/avatar", async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
    const mime = sniffImage(body);
    if (!mime) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
    return accounts.setAvatar(req.auth!.userId, mime, body);
  });

  app.delete("/account/avatar", async (req) => accounts.deleteAvatar(req.auth!.userId));

  app.put(
    "/account/wallpaper",
    { bodyLimit: WALLPAPER_MAX, config: { rateLimit: { max: 20 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } },
    async (req) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
      const mime = sniffImage(body);
      if (!mime) throw fail(ErrorCode.ValidationFailed, "Upload a JPEG, PNG or WebP image.");
      return accounts.setWallpaper(req.auth!.userId, mime, body);
    },
  );

  /** Only the owner can read their wallpaper. */
  app.get("/account/wallpaper", async (req, reply) => {
    const w = await accounts.getWallpaper(req.auth!.userId);
    if (!w) throw notFound("Wallpaper");
    reply.header("Cache-Control", "private, max-age=86400");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.type(w.mimeType).send(w.data);
  });

  app.delete("/account/wallpaper", async (req) => accounts.deleteWallpaper(req.auth!.userId));

  /** Avatars are visible to any signed-in VOIDEX user (e.g. mail senders). */
  app.get("/users/:id/avatar", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const avatar = await accounts.getAvatar(id);
    if (!avatar) throw notFound("Avatar");
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.type(avatar.mimeType).send(avatar.data);
  });

  app.post("/account/password", { config: { rateLimit: { max: 5 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req) =>
    accounts.changePassword(req.auth!.userId, req.auth!.sessionId, parse(PasswordChangeSchema, req.body), requestMeta(req)),
  );

  app.post("/account/phone/start", { config: { rateLimit: { max: 5 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req) =>
    accounts.startPhoneChange(req.auth!.userId, parse(PhoneChangeStartSchema, req.body), requestMeta(req)),
  );

  app.post("/account/phone/confirm", { config: { rateLimit: { max: 15 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req) =>
    accounts.confirmPhoneChange(req.auth!.userId, req.auth!.sessionId, parse(PhoneChangeConfirmSchema, req.body), requestMeta(req)),
  );

  app.get("/account/consents", async (req) => accounts.consents(req.auth!.userId));

  /** Machine-readable copy of the account's data (privacy right of access). */
  app.get("/account/export", { config: { rateLimit: { max: 5 * app.ctx.config.rateLimitScale, timeWindow: "1 minute" } } }, async (req, reply) => {
    const userId = req.auth!.userId;
    const [me, consentsList, sessionList, mail] = await Promise.all([
      accounts.me(userId),
      accounts.consents(userId),
      listSessions(userId, req.auth!.sessionId),
      app.services.mail.exportAll(userId),
    ]);
    const events = await db.query.securityEvents.findMany({
      where: eq(securityEvents.userId, userId),
      orderBy: desc(securityEvents.createdAt),
      limit: 500,
    });
    reply.header("Content-Disposition", `attachment; filename="voidex-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      account: me,
      consents: consentsList,
      sessions: sessionList,
      securityEvents: events.map((e) => ({ type: e.type, at: e.createdAt, ip: e.ipAddress })),
      mail,
    };
  });

  // ---------------------------------------------------------------- preferences

  app.get("/preferences", async (req) => (await accounts.me(req.auth!.userId)).preferences);
  app.patch("/preferences", async (req) => accounts.updatePreferences(req.auth!.userId, parse(PreferencesPatchSchema, req.body)));

  // ---------------------------------------------------------------- security

  async function listSessions(userId: string, currentId: string): Promise<SessionDto[]> {
    const now = app.ctx.now();
    const rows = await db
      .select({ s: sessionsTable, d: devices })
      .from(sessionsTable)
      .innerJoin(devices, eq(devices.id, sessionsTable.deviceId))
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt), gt(sessionsTable.expiresAt, now), gt(sessionsTable.absoluteExpiresAt, now)))
      .orderBy(desc(sessionsTable.lastActiveAt));
    return rows.map(({ s, d }) => ({
      id: s.id,
      current: s.id === currentId,
      deviceName: d.name,
      platform: d.platform,
      clientType: d.clientType,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      ipAddress: s.ipAddress,
    }));
  }

  app.get("/security/sessions", async (req) => listSessions(req.auth!.userId, req.auth!.sessionId));

  app.delete("/security/sessions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    // Ownership check: only sessions of the authenticated account.
    const target = await db.query.sessions.findFirst({ where: and(eq(sessionsTable.id, id), eq(sessionsTable.userId, req.auth!.userId)) });
    if (!target) throw notFound("Session");
    await sessions.revoke(id, id === req.auth!.sessionId ? "logout" : "revoked_by_user");
    return { ok: true };
  });

  app.post("/security/sessions/revoke-others", async (req) => {
    const count = await sessions.revokeAll(req.auth!.userId, "revoked_by_user", { except: req.auth!.sessionId });
    return { ok: true, revokedSessions: count };
  });

  app.get("/security/approvals", async (req) => challenges.pendingApprovals(req.auth!));

  app.post("/security/approvals/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { decision } = parse(ApprovalDecisionSchema, req.body);
    await challenges.decide(req.auth!, id, decision, requestMeta(req));
    return { ok: true };
  });

  // ---------------------------------------------------------------- apps

  app.get("/apps", async (req) => apps.list(req.auth!.userId));

  app.get("/mail/account", async (req) => {
    const acc = await db.query.mailAccounts.findFirst({ where: eq(mailAccounts.userId, req.auth!.userId) });
    if (!acc) throw notFound("Mail account");
    return { address: acc.address, transport: acc.transport };
  });

  // ---------------------------------------------------------------- realtime

  /**
   * Server-Sent Events stream for this device. Clients read it with fetch()
   * so the access token travels in the Authorization header, not the URL.
   */
  app.get("/events", async (req, reply) => {
    const auth = req.auth!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    write({ type: "hello", sessionId: auth.sessionId });
    const unsubscribe = app.ctx.events.subscribe(auth.userId, auth.sessionId, (event) => {
      write(event);
      if (event.type === "session.revoked" && event.sessionId === auth.sessionId) close();
    });
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
    // Access tokens are short-lived; end the stream when this one expires so
    // the client reconnects with a fresh token (and a re-checked session).
    const maxAge = setTimeout(close, app.ctx.config.accessTokenTtlSeconds * 1000);
    function close() {
      clearInterval(heartbeat);
      clearTimeout(maxAge);
      unsubscribe();
      openStreams.delete(close);
      if (!res.writableEnded) res.end();
    }
    req.raw.on("close", close);
    openStreams.add(close);
  });

  const openStreams = new Set<() => void>();
  app.addHook("onClose", async () => {
    for (const close of openStreams) close();
  });
};
