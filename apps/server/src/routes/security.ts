import type { FastifyPluginAsync } from "fastify";
import { AutoLockSchema, ErrorCode, FaceIdRegisterSchema, SetPasscodeSchema, VerifySchema, type AutoLockMinutes } from "@voidex/shared";
import { z } from "zod";
import { clearSessionCookie, parse, readRefreshToken, relyingParty, requestMeta, sendSession } from "../http.js";
import { fail } from "../lib/errors.js";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

/**
 * Lock screen (Step 2.4) — under /api/auth/lock so the refresh cookie (scoped
 * to /api/auth) identifies the session: a locked session has no access token.
 */
export const lockRoutes: FastifyPluginAsync = async (app) => {
  const { security, sessions, accounts } = app.services;
  const { config } = app.ctx;
  const limit = (max: number) => ({ rateLimit: { max: max * config.rateLimitScale, timeWindow: "1 minute" } });

  /** What the lock screen shows (Face ID offered, lockout, wallpaper). */
  app.post("/state", { config: limit(60) }, async (req) => {
    const s = await security.sessionByRefresh(readRefreshToken(req));
    return security.lockState(s.id);
  });

  /** Locks this device now (manual lock, app start, inactivity). Without a passcode nothing happens. */
  app.post("/", { config: limit(60) }, async (req) => {
    const s = await security.sessionByRefresh(readRefreshToken(req));
    return { locked: await security.lock(s.id) };
  });

  /** WebAuthn assertion options for Face ID on this device. */
  app.post("/options", { config: limit(30) }, async (req) => {
    const s = await security.sessionByRefresh(readRefreshToken(req));
    return security.assertionOptions(s.id, relyingParty(req, config));
  });

  /** Unlock with the passcode or Face ID; returns a fresh session (tokens rotate). */
  app.post("/unlock", { config: limit(20) }, async (req, reply) => {
    const token = readRefreshToken(req);
    const s = await security.sessionByRefresh(token);
    const input = parse(VerifySchema, req.body);
    try {
      await security.unlock(s.id, input, "webauthn" in input ? relyingParty(req, config) : { rpId: "", origin: "" });
    } catch (err) {
      if ((err as { code?: string }).code === ErrorCode.SessionRevoked) clearSessionCookie(reply, config);
      throw err;
    }
    const r = await sessions.refresh(token!, requestMeta(req));
    return sendSession(req, reply, config, r, await accounts.me(r.userId));
  });

  /** The lock-screen wallpaper image (its own, else the desktop's), readable while locked. */
  app.get("/wallpaper", async (req, reply) => {
    const s = await security.sessionByRefresh(readRefreshToken(req));
    const slot = z.object({ slot: z.enum(["lock", "desktop"]).default("lock") }).parse(req.query ?? {}).slot;
    const w = await accounts.getWallpaper(s.userId, slot);
    if (!w) throw fail(ErrorCode.NotFound, "Wallpaper not found.");
    reply.header("Cache-Control", "private, max-age=3600");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.type(w.mimeType).send(w.data);
  });
};

/** Code-password, Face ID, auto-lock and step-up for a signed-in, unlocked session. */
export const securityRoutes: FastifyPluginAsync = async (app) => {
  const { security } = app.services;
  const { config } = app.ctx;
  const limit = (max: number) => ({ rateLimit: { max: max * config.rateLimitScale, timeWindow: "1 minute" } });
  app.addHook("preHandler", app.authenticate);

  app.get("/status", async (req) => security.status(req.auth!));
  /** Activity heartbeat while the person uses VOIDEX (keeps auto-lock from firing mid-use). */
  app.post("/activity", async () => ({ ok: true }));
  app.post("/passcode", { config: limit(10) }, async (req) => security.setPasscode(req.auth!, parse(SetPasscodeSchema, req.body).passcode));
  app.delete("/passcode", async (req) => security.disablePasscode(req.auth!));
  app.post("/auto-lock", async (req) => security.setAutoLock(req.auth!, parse(AutoLockSchema, req.body).minutes as AutoLockMinutes));
  app.post("/step-up/options", { config: limit(30) }, async (req) => security.assertionOptions(req.auth!.sessionId, relyingParty(req, config)));
  app.post("/step-up", { config: limit(20) }, async (req) => {
    const input = parse(VerifySchema, req.body);
    return security.stepUp(req.auth!, input, "webauthn" in input ? relyingParty(req, config) : { rpId: "", origin: "" });
  });
  app.post("/face-id/options", { config: limit(20) }, async (req) => security.faceIdRegisterOptions(req.auth!, relyingParty(req, config)));
  app.post("/face-id", { config: limit(20) }, async (req) =>
    security.faceIdRegisterVerify(req.auth!, parse(FaceIdRegisterSchema, req.body).response as unknown as RegistrationResponseJSON, relyingParty(req, config)),
  );
  app.delete("/face-id", async (req) => security.faceIdRemove(req.auth!));
};
