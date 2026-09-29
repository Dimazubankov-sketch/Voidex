import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  ErrorCode,
  type ApprovalRequestDto,
  type ChallengeDto,
  type ChallengeMethod,
  type ChallengeStatusDto,
} from "@voidex/shared";
import { maskPhone } from "@voidex/shared/phone";
import { authChallenges, devices, securityEvents, sessions, users } from "../db/schema.js";
import { hmac, randomToken, safeEqualHex } from "../lib/crypto.js";
import { describeDevice } from "../lib/device.js";
import { fail } from "../lib/errors.js";
import type { AccountService } from "./accounts.js";
import type { Ctx, RequestMeta } from "./context.js";
import type { SessionService, AuthContext } from "./sessions.js";
import type { VerificationService } from "./verification.js";

const CHALLENGE_TTL_MS = 15 * 60_000;

type Challenge = typeof authChallenges.$inferSelect;
type User = typeof users.$inferSelect;

/**
 * Second step for (a) signing in on a device the account has never trusted and
 * (b) recovering a forgotten password. Both are satisfied by either an SMS code
 * to the account phone or approval from another signed-in trusted device.
 */
export class ChallengeService {
  constructor(
    private readonly ctx: Ctx,
    private readonly sessions: SessionService,
    private readonly verification: VerificationService,
    private readonly accounts: AccountService,
  ) {}

  private secretHash(id: string, secret: string) {
    return hmac(this.ctx.config.tokenPepper, `challenge:${id}:${secret}`);
  }

  async create(user: User, kind: "login" | "recovery", meta: RequestMeta): Promise<ChallengeDto> {
    const now = this.ctx.now();
    const id = crypto.randomUUID();
    const secret = randomToken();
    const info = describeDevice(meta.userAgent, meta.deviceName, meta.native);
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    await this.ctx.db.insert(authChallenges).values({
      id,
      userId: user.id,
      kind,
      secretHash: this.secretHash(id, secret),
      requestDeviceName: info.name,
      requestPlatform: info.platform,
      requestClientType: info.clientType,
      ipAddress: meta.ip,
      userAgent: meta.userAgent?.slice(0, 400),
      expiresAt,
      createdAt: now,
    });
    // Offer only methods that can really work right now.
    const methods: ChallengeMethod[] = this.ctx.sms.enabled ? ["sms"] : [];
    if ((await this.sessions.trustedSessionCount(user.id)) > 0) methods.push("device");
    return { id, secret, kind, methods, phoneMasked: maskPhone(user.phone), expiresAt: expiresAt.toISOString() };
  }

  /** Loads a challenge for its requester, checking the secret and expiry. */
  private async load(id: string, secret: string): Promise<{ challenge: Challenge; user: User }> {
    const challenge = await this.ctx.db.query.authChallenges.findFirst({ where: eq(authChallenges.id, id) });
    if (!challenge || !safeEqualHex(this.secretHash(id, secret), challenge.secretHash)) {
      throw fail(ErrorCode.ChallengeInvalid, "This sign-in request is not valid. Please start again.", { status: 404 });
    }
    if (challenge.status === "completed") {
      throw fail(ErrorCode.ChallengeInvalid, "This sign-in request was already used. Please start again.", { status: 410 });
    }
    if (challenge.expiresAt <= this.ctx.now() || challenge.status === "expired") {
      if (challenge.status !== "expired") {
        await this.ctx.db.update(authChallenges).set({ status: "expired" }).where(eq(authChallenges.id, id));
      }
      throw fail(ErrorCode.ChallengeExpired, "This request has expired. Please start again.");
    }
    const user = await this.ctx.db.query.users.findFirst({ where: eq(users.id, challenge.userId) });
    if (!user || user.status !== "active") throw fail(ErrorCode.ChallengeInvalid, "This request is not valid.", { status: 404 });
    return { challenge, user };
  }

  async status(id: string, secret: string): Promise<ChallengeStatusDto> {
    const { challenge } = await this.load(id, secret);
    return { status: challenge.status };
  }

  async sendSms(id: string, secret: string, meta: RequestMeta) {
    const { challenge, user } = await this.load(id, secret);
    if (challenge.status !== "pending") throw fail(ErrorCode.ChallengeInvalid, "This request is no longer pending.", { status: 409 });
    const started = await this.verification.start({
      purpose: challenge.kind,
      phone: user.phone,
      userId: user.id,
      ip: meta.ip,
      language: user.language,
    });
    await this.ctx.db
      .update(authChallenges)
      .set({ method: "sms", verificationId: started.verificationId })
      .where(eq(authChallenges.id, id));
    return started;
  }

  async verifySms(id: string, secret: string, code: string) {
    const { challenge, user } = await this.load(id, secret);
    if (challenge.status !== "pending" || !challenge.verificationId) {
      throw fail(ErrorCode.CodeInvalid, "Request a code first.");
    }
    await this.verification.verify({ id: challenge.verificationId, code, purpose: challenge.kind, userId: user.id });
    await this.ctx.db.update(authChallenges).set({ status: "verified" }).where(eq(authChallenges.id, id));
  }

  async requestDeviceApproval(id: string, secret: string) {
    const { challenge, user } = await this.load(id, secret);
    if (challenge.status !== "pending") throw fail(ErrorCode.ChallengeInvalid, "This request is no longer pending.", { status: 409 });
    if ((await this.sessions.trustedSessionCount(user.id)) === 0) {
      throw fail(ErrorCode.NoTrustedDevice, "You are not signed in on any other trusted device.", { status: 409 });
    }
    await this.ctx.db
      .update(authChallenges)
      .set({ method: "device", deviceApprovalRequestedAt: this.ctx.now() })
      .where(eq(authChallenges.id, id));
    this.ctx.events.toUser(user.id, { type: "approval.requested", approvalId: id });
    return { status: "pending" as const };
  }

  // ------------------------------------------------ approver side (trusted device)

  async pendingApprovals(auth: AuthContext): Promise<ApprovalRequestDto[]> {
    if (!(await this.isTrustedSession(auth))) return [];
    const rows = await this.ctx.db
      .select()
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.userId, auth.userId),
          eq(authChallenges.status, "pending"),
          eq(authChallenges.method, "device"),
          isNotNull(authChallenges.deviceApprovalRequestedAt),
          gt(authChallenges.expiresAt, this.ctx.now()),
        ),
      )
      .orderBy(desc(authChallenges.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      deviceName: r.requestDeviceName,
      platform: r.requestPlatform,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  private async isTrustedSession(auth: AuthContext) {
    const d = await this.ctx.db.query.devices.findFirst({ where: eq(devices.id, auth.deviceId) });
    return !!d?.trustedAt && !d.revokedAt;
  }

  async decide(auth: AuthContext, approvalId: string, decision: "approve" | "deny", meta: RequestMeta) {
    if (!(await this.isTrustedSession(auth))) {
      throw fail(ErrorCode.Forbidden, "Only a trusted device can approve sign-ins.");
    }
    // Ownership: the challenge must belong to the authenticated account.
    const [updated] = await this.ctx.db
      .update(authChallenges)
      .set({ status: decision === "approve" ? "approved" : "denied", resolvedBySessionId: auth.sessionId })
      .where(
        and(
          eq(authChallenges.id, approvalId),
          eq(authChallenges.userId, auth.userId),
          eq(authChallenges.status, "pending"),
          eq(authChallenges.method, "device"),
          gt(authChallenges.expiresAt, this.ctx.now()),
        ),
      )
      .returning({ id: authChallenges.id, kind: authChallenges.kind });
    if (!updated) throw fail(ErrorCode.NotFound, "This request no longer exists or has expired.");
    await this.ctx.db.insert(securityEvents).values({
      userId: auth.userId,
      type: decision === "approve" ? "approval.granted" : "approval.denied",
      sessionId: auth.sessionId,
      ipAddress: meta.ip,
      meta: { challengeId: approvalId, kind: updated.kind },
    });
    this.ctx.events.toUser(auth.userId, { type: "approval.resolved", approvalId });
  }

  // ------------------------------------------------ completion (requester side)

  private assertSatisfied(challenge: Challenge) {
    if (challenge.status === "denied") throw fail(ErrorCode.ChallengeDenied, "The request was declined on your other device.");
    if (challenge.status === "pending") throw fail(ErrorCode.ChallengePending, "The request has not been confirmed yet.");
    if (challenge.status !== "approved" && challenge.status !== "verified") {
      throw fail(ErrorCode.ChallengeInvalid, "This request is not valid.", { status: 409 });
    }
  }

  private async markCompleted(tx: Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0], challenge: Challenge) {
    const [won] = await tx
      .update(authChallenges)
      .set({ status: "completed" })
      .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.status, challenge.status)))
      .returning({ id: authChallenges.id });
    if (!won) throw fail(ErrorCode.ChallengeInvalid, "This request was already used.", { status: 409 });
  }

  /** Finishes a sign-in challenge: the device becomes trusted and gets a session. */
  async completeLogin(id: string, secret: string, meta: RequestMeta) {
    const { challenge, user } = await this.load(id, secret);
    if (challenge.kind !== "login") throw fail(ErrorCode.ChallengeInvalid, "Wrong request type.", { status: 409 });
    this.assertSatisfied(challenge);
    return this.ctx.db.transaction(async (tx) => {
      await this.markCompleted(tx, challenge);
      const issued = await this.sessions.create(tx, user.id, meta, { trustDevice: true });
      const me = await this.accounts.me(user.id, tx);
      return { issued, me };
    });
  }

  /** Finishes recovery: sets the new password, signs out everywhere else, signs this device in. */
  async completeRecovery(id: string, secret: string, newPassword: string, meta: RequestMeta) {
    const { challenge, user } = await this.load(id, secret);
    if (challenge.kind !== "recovery") throw fail(ErrorCode.ChallengeInvalid, "Wrong request type.", { status: 409 });
    this.assertSatisfied(challenge);
    const result = await this.ctx.db.transaction(async (tx) => {
      await this.accounts.setPassword(user, newPassword, tx);
      await this.markCompleted(tx, challenge);
      await tx.insert(securityEvents).values({ userId: user.id, type: "password.recovered", ipAddress: meta.ip });
      const revokedIds = await tx
        .update(sessions)
        .set({ revokedAt: this.ctx.now(), revokeReason: "password_recovered" })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      const issued = await this.sessions.create(tx, user.id, meta, { trustDevice: true });
      const me = await this.accounts.me(user.id, tx);
      return { issued, me, revokedIds };
    });
    for (const r of result.revokedIds) this.ctx.events.toSession(r.id, { type: "session.revoked", sessionId: r.id });
    this.ctx.events.toUser(user.id, { type: "sessions.updated" });
    return result;
  }
}
