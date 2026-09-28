import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { ErrorCode } from "@voidex/shared";
import type { Tx } from "../db/client.js";
import { devices, securityEvents, sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { describeDevice } from "../lib/device.js";
import { fail } from "../lib/errors.js";
import type { Ctx, RequestMeta } from "./context.js";

/** If the previous refresh token is presented within this window, assume a parallel-tab race, not theft. */
const REFRESH_RACE_GRACE_MS = 20_000;
const ACTIVITY_WRITE_THROTTLE_MS = 60_000;

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
}

export interface IssuedSession {
  sessionId: string;
  deviceId: string;
  refreshToken: string;
  deviceToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * Sessions: short-lived signed access tokens (JWT, HS256) + long-lived opaque
 * refresh tokens stored only as SHA-256 and rotated on every use. Each access
 * check also confirms the session is still alive, so "sign out" and "sign out
 * of all devices" take effect immediately, not when a token expires.
 */
export class SessionService {
  private readonly key: Uint8Array;

  constructor(private readonly ctx: Ctx) {
    this.key = new TextEncoder().encode(ctx.config.accessSecret);
  }

  /** Finds this browser/device for the user, or registers it. */
  async ensureDevice(tx: Tx, userId: string, meta: RequestMeta, trust: boolean) {
    const now = this.ctx.now();
    const info = describeDevice(meta.userAgent, meta.deviceName, meta.native);
    if (meta.deviceToken) {
      const existing = await tx.query.devices.findFirst({
        where: and(eq(devices.userId, userId), eq(devices.tokenHash, sha256(meta.deviceToken)), isNull(devices.revokedAt)),
      });
      if (existing) {
        const [updated] = await tx
          .update(devices)
          .set({
            lastSeenAt: now,
            name: meta.deviceName ? info.name : existing.name,
            trustedAt: existing.trustedAt ?? (trust ? now : null),
          })
          .where(eq(devices.id, existing.id))
          .returning();
        return { device: updated!, deviceToken: meta.deviceToken };
      }
    }
    // Reuse the browser's identifier when it has one (multiple accounts on one
    // browser), otherwise mint a new device secret.
    const deviceToken = meta.deviceToken ?? randomToken();
    const [device] = await tx
      .insert(devices)
      .values({
        userId,
        tokenHash: sha256(deviceToken),
        name: info.name,
        platform: info.platform,
        clientType: info.clientType,
        trustedAt: trust ? now : null,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning();
    return { device: device!, deviceToken };
  }

  /** Is the presented device already trusted by this account? */
  async isTrustedDevice(userId: string, deviceToken: string | undefined): Promise<boolean> {
    if (!deviceToken) return false;
    const d = await this.ctx.db.query.devices.findFirst({
      where: and(eq(devices.userId, userId), eq(devices.tokenHash, sha256(deviceToken)), isNull(devices.revokedAt)),
    });
    return !!d?.trustedAt;
  }

  async create(tx: Tx, userId: string, meta: RequestMeta, opts: { trustDevice: boolean }): Promise<IssuedSession> {
    const now = this.ctx.now();
    const { device, deviceToken } = await this.ensureDevice(tx, userId, meta, opts.trustDevice);
    const refreshToken = randomToken();
    const absoluteExpiresAt = new Date(now.getTime() + this.ctx.config.sessionAbsoluteMs);
    const [session] = await tx
      .insert(sessions)
      .values({
        userId,
        deviceId: device.id,
        refreshTokenHash: sha256(refreshToken),
        createdAt: now,
        lastActiveAt: now,
        expiresAt: new Date(now.getTime() + this.ctx.config.sessionIdleMs),
        absoluteExpiresAt,
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 400),
      })
      .returning();
    await tx.insert(securityEvents).values({
      userId,
      type: "session.created",
      sessionId: session!.id,
      ipAddress: meta.ip,
      meta: { device: device.name },
    });
    const access = await this.signAccess(userId, session!.id);
    return {
      sessionId: session!.id,
      deviceId: device.id,
      refreshToken,
      deviceToken,
      absoluteExpiresAt,
      ...access,
    };
  }

  async signAccess(userId: string, sessionId: string) {
    const now = this.ctx.now();
    const exp = new Date(now.getTime() + this.ctx.config.accessTokenTtlSeconds * 1000);
    const accessToken = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(exp.getTime() / 1000))
      .setIssuer("voidex")
      .setAudience("voidex-api")
      .sign(this.key);
    return { accessToken, accessTokenExpiresAt: exp };
  }

  /** Validates an access token and the live session behind it. */
  async authenticate(accessToken: string): Promise<AuthContext> {
    let payload;
    try {
      ({ payload } = await jwtVerify(accessToken, this.key, {
        issuer: "voidex",
        audience: "voidex-api",
        algorithms: ["HS256"],
        currentDate: this.ctx.now(),
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw fail(ErrorCode.SessionExpired, "Your session has expired.");
      throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    }
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    if (!sid || !payload.sub) throw fail(ErrorCode.Unauthenticated, "Please sign in.");

    const now = this.ctx.now();
    const [row] = await this.ctx.db
      .select({
        userId: sessions.userId,
        deviceId: sessions.deviceId,
        revokedAt: sessions.revokedAt,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        lastActiveAt: sessions.lastActiveAt,
        userStatus: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sid));

    if (!row || row.userId !== payload.sub) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    if (row.revokedAt) throw fail(ErrorCode.SessionRevoked, "You were signed out on this device.");
    if (row.absoluteExpiresAt <= now) throw fail(ErrorCode.SessionExpired, "Your session has expired.");
    if (row.userStatus !== "active") throw fail(ErrorCode.Forbidden, "This account is not active.");

    if (now.getTime() - row.lastActiveAt.getTime() > ACTIVITY_WRITE_THROTTLE_MS) {
      await this.ctx.db.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, sid));
      await this.ctx.db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.deviceId));
    }
    return { userId: row.userId, sessionId: sid, deviceId: row.deviceId };
  }

  /** Exchanges a refresh token for a new pair (rotation + reuse detection). */
  async refresh(refreshToken: string, meta: RequestMeta) {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const hash = sha256(refreshToken);

    const result = await db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(sessions)
        .where(or(eq(sessions.refreshTokenHash, hash), eq(sessions.previousRefreshTokenHash, hash)))
        .for("update");

      if (!session) throw fail(ErrorCode.SessionExpired, "Your session has expired. Please sign in again.");
      if (session.revokedAt) throw fail(ErrorCode.SessionRevoked, "You were signed out on this device.");

      if (session.refreshTokenHash !== hash) {
        // An old token came back.
        if (session.rotatedAt && now.getTime() - session.rotatedAt.getTime() < REFRESH_RACE_GRACE_MS) {
          throw fail(ErrorCode.RefreshRace, "Session is being refreshed. Retry.");
        }
        // Possible theft: kill the session. Returned (not thrown) so the revoke commits.
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: "refresh_token_reuse" })
          .where(eq(sessions.id, session.id));
        await tx.insert(securityEvents).values({
          userId: session.userId,
          type: "session.refresh_reuse",
          sessionId: session.id,
          ipAddress: meta.ip,
        });
        return { reused: true as const, sessionId: session.id, userId: session.userId };
      }

      if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
        throw fail(ErrorCode.SessionExpired, "Your session has expired. Please sign in again.");
      }
      const user = await tx.query.users.findFirst({ where: eq(users.id, session.userId) });
      if (!user || user.status !== "active") throw fail(ErrorCode.Forbidden, "This account is not active.");

      const next = randomToken();
      const idle = new Date(now.getTime() + this.ctx.config.sessionIdleMs);
      await tx
        .update(sessions)
        .set({
          refreshTokenHash: sha256(next),
          previousRefreshTokenHash: hash,
          rotatedAt: now,
          lastActiveAt: now,
          expiresAt: idle < session.absoluteExpiresAt ? idle : session.absoluteExpiresAt,
          ipAddress: meta.ip,
        })
        .where(eq(sessions.id, session.id));
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, session.deviceId));

      const access = await this.signAccess(session.userId, session.id);
      return {
        reused: false as const,
        userId: session.userId,
        sessionId: session.id,
        refreshToken: next,
        absoluteExpiresAt: session.absoluteExpiresAt,
        ...access,
      };
    });
    if (result.reused) {
      this.ctx.events.toSession(result.sessionId, { type: "session.revoked", sessionId: result.sessionId });
      this.ctx.events.toUser(result.userId, { type: "sessions.updated" });
      throw fail(ErrorCode.SessionRevoked, "For your security this session was signed out. Please sign in again.");
    }
    return result;
  }

  async revoke(sessionId: string, reason: string, tx: Tx = this.ctx.db) {
    const now = this.ctx.now();
    const [row] = await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id, userId: sessions.userId });
    if (row) {
      this.ctx.events.toSession(row.id, { type: "session.revoked", sessionId: row.id });
      this.ctx.events.toUser(row.userId, { type: "sessions.updated" });
    }
    return !!row;
  }

  /** Revokes every live session of a user, optionally keeping one. */
  async revokeAll(userId: string, reason: string, opts: { except?: string } = {}, tx: Tx = this.ctx.db) {
    const now = this.ctx.now();
    const rows = await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          opts.except ? ne(sessions.id, opts.except) : sql`true`,
        ),
      )
      .returning({ id: sessions.id });
    for (const r of rows) this.ctx.events.toSession(r.id, { type: "session.revoked", sessionId: r.id });
    this.ctx.events.toUser(userId, { type: "sessions.updated" });
    return rows.length;
  }

  /** Live sessions on trusted devices — the ones allowed to approve a sign-in. */
  async trustedSessionCount(userId: string): Promise<number> {
    const now = this.ctx.now();
    const [row] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
          sql`${devices.trustedAt} is not null`,
          isNull(devices.revokedAt),
        ),
      );
    return row?.n ?? 0;
  }
}
