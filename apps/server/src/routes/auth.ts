import type { FastifyPluginAsync } from "fastify";
import {
  ChallengeSecretSchema,
  ChallengeVerifySmsSchema,
  ErrorCode,
  LoginSchema,
  PhoneStartSchema,
  PhoneVerifySchema,
  RecoveryResetSchema,
  RecoveryStartSchema,
  RegisterSchema,
  UsernameCheckSchema,
  parsePhone,
  type CountryCode,
  type LoginResponse,
} from "@voidex/shared";
import { z } from "zod";
import { clearSessionCookie, parse, readRefreshToken, requestMeta, sendSession } from "../http.js";
import { sha256 as sha256Hex } from "../lib/crypto.js";
import { fail } from "../lib/errors.js";

const limit = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });
const idParam = z.object({ id: z.string().uuid() });

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { accounts, sessions, verification, challenges } = app.services;
  const { config } = app.ctx;

  // ---------------------------------------------------------------- sign-up

  /** Step "phone": sends an SMS code to a number that is not linked yet. */
  app.post("/phone/start", { config: limit(5) }, async (req) => {
    const body = parse(PhoneStartSchema, req.body);
    const phone = parsePhone(body.phone, body.country as CountryCode | undefined);
    if (!phone) throw fail(ErrorCode.PhoneInvalid, "Enter a valid mobile phone number.", { fields: { phone: "invalid" } });
    if (await accounts.phoneLinked(phone.e164)) {
      throw fail(ErrorCode.PhoneTaken, "This phone number is already linked to a VOIDEX account.", { fields: { phone: "taken" } });
    }
    const lang = req.headers["accept-language"]?.toLowerCase().startsWith("ru") ? "ru" : "en";
    return verification.start({ purpose: "signup", phone: phone.e164, ip: req.ip, language: lang });
  });

  app.post("/phone/verify", { config: limit(15) }, async (req) => {
    const body = parse(PhoneVerifySchema, req.body);
    const { proof, phone } = await verification.verify({ id: body.verificationId, code: body.code, purpose: "signup" });
    return { verified: true, proof, phone };
  });

  app.get("/username/check", { config: limit(60) }, async (req) => {
    const q = parse(UsernameCheckSchema, req.query);
    return accounts.checkUsername(q.username, q.firstName, q.lastName);
  });

  app.post("/register", { config: limit(5) }, async (req, reply) => {
    const body = parse(RegisterSchema, req.body);
    const { issued, me } = await accounts.register(body, requestMeta(req, body.deviceName));
    reply.status(201);
    return sendSession(req, reply, config, issued, me);
  });

  // ---------------------------------------------------------------- sign-in

  app.post("/login", { config: limit(10) }, async (req, reply): Promise<LoginResponse> => {
    const body = parse(LoginSchema, req.body);
    const meta = requestMeta(req, body.deviceName);
    const user = await accounts.verifyCredentials(body.identifier, body.password, meta);

    if (await sessions.isTrustedDevice(user.id, meta.deviceToken)) {
      const issued = await app.ctx.db.transaction((tx) => sessions.create(tx, user.id, meta, { trustDevice: true }));
      return { status: "ok", ...sendSession(req, reply, config, issued, await accounts.me(user.id)) };
    }
    // New device: password alone is not enough.
    return { status: "challenge", challenge: await challenges.create(user, "login", meta) };
  });

  app.post("/challenges/:id/status", { config: limit(90) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { secret } = parse(ChallengeSecretSchema, req.body);
    return challenges.status(id, secret);
  });

  app.post("/challenges/:id/sms", { config: limit(5) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { secret } = parse(ChallengeSecretSchema, req.body);
    return challenges.sendSms(id, secret, requestMeta(req));
  });

  app.post("/challenges/:id/verify-sms", { config: limit(15) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { secret, code } = parse(ChallengeVerifySmsSchema, req.body);
    await challenges.verifySms(id, secret, code);
    return { status: "verified" };
  });

  app.post("/challenges/:id/device", { config: limit(5) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { secret } = parse(ChallengeSecretSchema, req.body);
    return challenges.requestDeviceApproval(id, secret);
  });

  app.post("/challenges/:id/complete", { config: limit(15) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(ChallengeSecretSchema.extend({ deviceName: z.string().max(80).optional() }), req.body);
    const { issued, me } = await challenges.completeLogin(id, body.secret, requestMeta(req, body.deviceName));
    return sendSession(req, reply, config, issued, me);
  });

  // ---------------------------------------------------------------- recovery

  app.post("/recovery/start", { config: limit(5) }, async (req) => {
    const { identifier } = parse(RecoveryStartSchema, req.body);
    const user = await accounts.findByIdentifier(identifier);
    if (!user || user.status !== "active") {
      throw fail(ErrorCode.AccountNotFound, "We couldn't find a VOIDEX account with this email or phone.");
    }
    return challenges.create(user, "recovery", requestMeta(req));
  });

  app.post("/recovery/reset", { config: limit(10) }, async (req, reply) => {
    const body = parse(RecoveryResetSchema, req.body);
    const { issued, me } = await challenges.completeRecovery(
      body.challengeId,
      body.secret,
      body.newPassword,
      requestMeta(req, body.deviceName),
    );
    return sendSession(req, reply, config, issued, me);
  });

  // ---------------------------------------------------------------- session

  /** Restores a session on app start and renews the access token. */
  app.post("/refresh", { config: limit(60) }, async (req, reply) => {
    const token = readRefreshToken(req);
    if (!token) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    try {
      const r = await sessions.refresh(token, requestMeta(req));
      return sendSession(req, reply, config, r, await accounts.me(r.userId));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === ErrorCode.SessionExpired || code === ErrorCode.SessionRevoked) clearSessionCookie(reply, config);
      throw err;
    }
  });

  app.post("/logout", async (req, reply) => {
    // Works with either a valid access token or just the refresh cookie.
    const header = req.headers.authorization;
    let sessionId: string | null = null;
    if (header?.startsWith("Bearer ")) {
      try {
        sessionId = (await sessions.authenticate(header.slice(7))).sessionId;
      } catch {
        /* fall through to refresh token */
      }
    }
    if (!sessionId) {
      const token = readRefreshToken(req);
      if (token) {
        const s = await app.ctx.db.query.sessions.findFirst({
          where: (t, { eq }) => eq(t.refreshTokenHash, sha256Hex(token)),
        });
        sessionId = s?.id ?? null;
      }
    }
    if (sessionId) await sessions.revoke(sessionId, "logout");
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.post("/logout-all", { preHandler: app.authenticate }, async (req, reply) => {
    const count = await sessions.revokeAll(req.auth!.userId, "logout_all");
    clearSessionCookie(reply, config);
    return { ok: true, revokedSessions: count };
  });
};
