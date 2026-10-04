import { and, eq, isNotNull } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_AUTO_LOCK,
  ErrorCode,
  STEP_UP_TTL_MS,
  normalizeLayout,
  type AutoLockMinutes,
  type LockStateDto,
  type SecurityStatusDto,
  type VerifyInput,
} from "@voidex/shared";
import { mailAccounts, securityEvents, sessions, userPreferences, users, webauthnCredentials } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { fail } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import type { AuthContext, SessionService } from "./sessions.js";
import type { Ctx } from "./context.js";

/** Wrong codes before the passcode is blocked for a while (the block doubles each time). */
const PASSCODE_FREE_ATTEMPTS = 5;
/** Wrong codes in a row after which the session is signed out (full sign-in needed). */
const PASSCODE_MAX_ATTEMPTS = 10;
const PASSCODE_BLOCK_BASE_MS = 30_000;
const PASSCODE_BLOCK_MAX_MS = 15 * 60_000;
/** A WebAuthn challenge is valid this long. */
const CHALLENGE_TTL_MS = 2 * 60_000;
/** Extra time over the auto-lock interval before the server locks on its own (activity heartbeats are throttled). */
export const AUTO_LOCK_GRACE_MS = 2 * 60_000;

/** WebAuthn relying party of one request: the site's domain and the page origin. */
export interface RelyingParty {
  rpId: string;
  origin: string;
}

/**
 * Step 2.4: code-password, lock screen, step-up for sensitive changes and
 * Face ID through WebAuthn.
 *
 * Security model (everything is decided here, on the server):
 * - The passcode is stored only as a scrypt hash. Wrong codes count per
 *   account; after 5 the passcode is blocked for 30 s, doubling up to 15 min;
 *   after 10 in a row the session is signed out (a full sign-in with the
 *   account password is needed).
 * - A locked session gets no API access (SessionService refuses it with 423)
 *   until the passcode or Face ID unlocks it.
 * - Sensitive changes need a confirmation (passcode / Face ID) from the last
 *   5 minutes when a passcode is set. A full sign-in counts as one.
 * - Face ID = a WebAuthn credential of the device's platform authenticator with
 *   mandatory user verification, bound to one VOIDEX device. The server stores
 *   only its public key and checks the signature, origin, RP id, the
 *   user-verified flag and the signature counter.
 */
export class SecurityService {
  constructor(
    private readonly ctx: Ctx,
    private readonly sessions: SessionService,
  ) {}

  // ---------------------------------------------------------------- status

  async status(auth: AuthContext): Promise<SecurityStatusDto> {
    const [u] = await this.ctx.db.select().from(users).where(eq(users.id, auth.userId));
    if (!u) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const [s] = await this.ctx.db.select({ stepUpAt: sessions.stepUpAt }).from(sessions).where(eq(sessions.id, auth.sessionId));
    const creds = await this.ctx.db.select({ deviceId: webauthnCredentials.deviceId }).from(webauthnCredentials).where(eq(webauthnCredentials.userId, auth.userId));
    const now = this.ctx.now().getTime();
    const stepUpUntil = s?.stepUpAt && s.stepUpAt.getTime() + STEP_UP_TTL_MS > now ? new Date(s.stepUpAt.getTime() + STEP_UP_TTL_MS).toISOString() : null;
    return {
      passcodeEnabled: !!u.passcodeHash,
      passcodeSetupRequired: u.passcodeSetupRequired && !u.passcodeHash,
      faceIdOnThisDevice: creds.some((c) => c.deviceId === auth.deviceId),
      faceIdDevices: new Set(creds.map((c) => c.deviceId)).size,
      autoLockMinutes: toAutoLock(u.autoLockMinutes),
      stepUpUntil: u.passcodeHash ? stepUpUntil : null,
      passcodeLockedUntil: u.passcodeLockedUntil && u.passcodeLockedUntil.getTime() > now ? u.passcodeLockedUntil.toISOString() : null,
    };
  }

  // ---------------------------------------------------------------- passcode

  /**
   * Creates or changes the passcode. Creating the first one needs no
   * confirmation (it is the first setup); changing an existing one does.
   */
  async setPasscode(auth: AuthContext, passcode: string): Promise<SecurityStatusDto> {
    const [u] = await this.ctx.db.select({ passcodeHash: users.passcodeHash }).from(users).where(eq(users.id, auth.userId));
    if (u?.passcodeHash) await this.requireStepUp(auth);
    const now = this.ctx.now();
    await this.ctx.db
      .update(users)
      .set({ passcodeHash: await hashPassword(passcode), passcodeSetAt: now, passcodeSetupRequired: false, passcodeFailedCount: 0, passcodeLockedUntil: null, updatedAt: now })
      .where(eq(users.id, auth.userId));
    // Setting it is a proof of presence on this session.
    await this.ctx.db.update(sessions).set({ stepUpAt: now }).where(eq(sessions.id, auth.sessionId));
    await this.audit(auth.userId, auth.sessionId, u?.passcodeHash ? "passcode.changed" : "passcode.created");
    this.ctx.events.toUser(auth.userId, { type: "security.updated" });
    return this.status(auth);
  }

  /** Turns the passcode off (confirmed). Face ID goes with it: it always needs the passcode as fallback. */
  async disablePasscode(auth: AuthContext): Promise<SecurityStatusDto> {
    await this.requireStepUp(auth);
    await this.ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ passcodeHash: null, passcodeSetAt: null, passcodeFailedCount: 0, passcodeLockedUntil: null, updatedAt: this.ctx.now() }).where(eq(users.id, auth.userId));
      await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, auth.userId));
      // Nothing can unlock a locked session any more: release them.
      await tx.update(sessions).set({ lockedAt: null }).where(and(eq(sessions.userId, auth.userId), isNotNull(sessions.lockedAt)));
    });
    await this.audit(auth.userId, auth.sessionId, "passcode.disabled");
    this.ctx.events.toUser(auth.userId, { type: "security.updated" });
    return this.status(auth);
  }

  async setAutoLock(auth: AuthContext, minutes: AutoLockMinutes): Promise<SecurityStatusDto> {
    // Making the lock weaker is a sensitive change.
    await this.requireStepUp(auth);
    await this.ctx.db.update(users).set({ autoLockMinutes: minutes }).where(eq(users.id, auth.userId));
    this.ctx.events.toUser(auth.userId, { type: "security.updated" });
    return this.status(auth);
  }

  /** Throws StepUpRequired unless this session confirmed itself recently (only when a passcode is set). */
  async requireStepUp(auth: AuthContext) {
    const [row] = await this.ctx.db
      .select({ passcodeSetAt: users.passcodeSetAt, stepUpAt: sessions.stepUpAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, auth.sessionId));
    if (!row?.passcodeSetAt) return;
    const now = this.ctx.now().getTime();
    if (row.stepUpAt && now - row.stepUpAt.getTime() < STEP_UP_TTL_MS) return;
    throw fail(ErrorCode.StepUpRequired, "Confirm with your code-password or Face ID.");
  }

  /** Confirms this session for sensitive changes (passcode or Face ID). */
  async stepUp(auth: AuthContext, input: VerifyInput, rp: RelyingParty): Promise<SecurityStatusDto> {
    await this.verifyFactor(auth.userId, auth.sessionId, auth.deviceId, input, rp);
    await this.ctx.db.update(sessions).set({ stepUpAt: this.ctx.now() }).where(eq(sessions.id, auth.sessionId));
    return this.status(auth);
  }

  // ---------------------------------------------------------------- lock

  /** Locks a session (only meaningful with a passcode: otherwise there is nothing to unlock with). */
  async lock(sessionId: string): Promise<boolean> {
    const [row] = await this.ctx.db
      .select({ userId: sessions.userId, passcodeSetAt: users.passcodeSetAt, lockedAt: sessions.lockedAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId));
    if (!row?.passcodeSetAt) return false;
    if (!row.lockedAt) {
      await this.ctx.db.update(sessions).set({ lockedAt: this.ctx.now(), stepUpAt: null }).where(eq(sessions.id, sessionId));
      this.ctx.events.toSession(sessionId, { type: "session.locked", sessionId });
    }
    return true;
  }

  /** The session behind a refresh token (the lock screen has no access token). */
  async sessionByRefresh(refreshToken: string | undefined) {
    if (!refreshToken) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const [s] = await this.ctx.db.select().from(sessions).where(eq(sessions.refreshTokenHash, sha256(refreshToken)));
    const now = this.ctx.now();
    if (!s || s.revokedAt) throw fail(ErrorCode.SessionRevoked, "You were signed out on this device.");
    if (s.expiresAt <= now || s.absoluteExpiresAt <= now) throw fail(ErrorCode.SessionExpired, "Your session has expired. Please sign in again.");
    return s;
  }

  /** What the lock screen shows: Face ID offered or not, the lockout, the wallpaper. */
  async lockState(sessionId: string): Promise<LockStateDto> {
    const [row] = await this.ctx.db
      .select({
        userId: sessions.userId,
        deviceId: sessions.deviceId,
        lockedAt: sessions.lockedAt,
        firstName: users.firstName,
        passcodeSetAt: users.passcodeSetAt,
        passcodeLockedUntil: users.passcodeLockedUntil,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId));
    if (!row) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const [cred] = await this.ctx.db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, row.userId), eq(webauthnCredentials.deviceId, row.deviceId)));
    const [prefs] = await this.ctx.db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, row.userId));
    const stored = prefs?.data.workspace.layout;
    const appearance = stored ? normalizeLayout(stored, []).appearance : null;
    const now = this.ctx.now().getTime();
    return {
      locked: !!row.lockedAt && !!row.passcodeSetAt,
      faceId: !!cred,
      passcodeLockedUntil: row.passcodeLockedUntil && row.passcodeLockedUntil.getTime() > now ? row.passcodeLockedUntil.toISOString() : null,
      firstName: row.firstName,
      wallpaper: appearance ? (appearance.lockWallpaper ?? appearance.wallpaper) : null,
    };
  }

  /** Unlocks the session (passcode or Face ID); the caller then issues fresh tokens. */
  async unlock(sessionId: string, input: VerifyInput, rp: RelyingParty) {
    const [s] = await this.ctx.db.select({ userId: sessions.userId, deviceId: sessions.deviceId }).from(sessions).where(eq(sessions.id, sessionId));
    if (!s) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    await this.verifyFactor(s.userId, sessionId, s.deviceId, input, rp);
    const now = this.ctx.now();
    await this.ctx.db.update(sessions).set({ lockedAt: null, stepUpAt: now, lastActiveAt: now }).where(eq(sessions.id, sessionId));
  }

  // ---------------------------------------------------------------- factors

  private async verifyFactor(userId: string, sessionId: string, deviceId: string, input: VerifyInput, rp: RelyingParty) {
    if ("passcode" in input) return this.verifyPasscode(userId, sessionId, input.passcode);
    return this.verifyAssertion(userId, sessionId, deviceId, input.webauthn as unknown as AuthenticationResponseJSON, rp);
  }

  private async verifyPasscode(userId: string, sessionId: string, passcode: string) {
    const [u] = await this.ctx.db
      .select({ hash: users.passcodeHash, failed: users.passcodeFailedCount, lockedUntil: users.passcodeLockedUntil })
      .from(users)
      .where(eq(users.id, userId));
    if (!u?.hash) throw fail(ErrorCode.PasscodeNotSet, "No code-password is set.");
    const now = this.ctx.now();
    if (u.lockedUntil && u.lockedUntil > now) {
      throw fail(ErrorCode.PasscodeLocked, "Too many wrong codes. Try again later.", {
        details: { lockedUntil: u.lockedUntil.toISOString(), retryAfterSeconds: Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 1000) },
      });
    }
    if (await verifyPassword(passcode, u.hash)) {
      if (u.failed || u.lockedUntil) await this.ctx.db.update(users).set({ passcodeFailedCount: 0, passcodeLockedUntil: null }).where(eq(users.id, userId));
      return;
    }
    const failed = u.failed + 1;
    if (failed >= PASSCODE_MAX_ATTEMPTS) {
      await this.ctx.db.update(users).set({ passcodeFailedCount: 0, passcodeLockedUntil: null }).where(eq(users.id, userId));
      await this.audit(userId, sessionId, "passcode.too_many_attempts");
      await this.sessions.revoke(sessionId, "passcode_attempts");
      throw fail(ErrorCode.SessionRevoked, "Too many wrong codes: this device was signed out. Sign in with your password.");
    }
    const blocked = failed >= PASSCODE_FREE_ATTEMPTS ? new Date(now.getTime() + Math.min(PASSCODE_BLOCK_BASE_MS * 2 ** (failed - PASSCODE_FREE_ATTEMPTS), PASSCODE_BLOCK_MAX_MS)) : null;
    await this.ctx.db.update(users).set({ passcodeFailedCount: failed, passcodeLockedUntil: blocked }).where(eq(users.id, userId));
    throw fail(ErrorCode.PasscodeInvalid, "Wrong code-password.", {
      details: { attemptsLeft: PASSCODE_MAX_ATTEMPTS - failed, ...(blocked ? { lockedUntil: blocked.toISOString(), retryAfterSeconds: Math.ceil((blocked.getTime() - now.getTime()) / 1000) } : {}) },
    });
  }

  // ---------------------------------------------------------------- Face ID (WebAuthn)

  /** Registration options for this device's platform authenticator (confirmed; passcode required). */
  async faceIdRegisterOptions(auth: AuthContext, rp: RelyingParty) {
    const [u] = await this.ctx.db.select({ passcodeHash: users.passcodeHash, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, auth.userId));
    if (!u?.passcodeHash) throw fail(ErrorCode.PasscodeNotSet, "Create a code-password first: it is the fallback for Face ID.");
    await this.requireStepUp(auth);
    const [mail] = await this.ctx.db.select({ address: mailAccounts.address }).from(mailAccounts).where(eq(mailAccounts.userId, auth.userId));
    const existing = await this.ctx.db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, auth.userId));
    const options = await generateRegistrationOptions({
      rpName: "VOIDEX",
      rpID: rp.rpId,
      userName: mail?.address ?? auth.userId,
      userDisplayName: `${u.firstName} ${u.lastName}`.trim(),
      userID: new TextEncoder().encode(auth.userId),
      attestationType: "none",
      // One credential per device: this device's own keys are excluded (re-setup replaces them).
      excludeCredentials: existing.filter((c) => c.deviceId !== auth.deviceId).map((c) => ({ id: c.credentialId, transports: c.transports as never })),
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
      timeout: CHALLENGE_TTL_MS,
    });
    await this.saveChallenge(auth.sessionId, options.challenge);
    return options;
  }

  async faceIdRegisterVerify(auth: AuthContext, response: RegistrationResponseJSON, rp: RelyingParty): Promise<SecurityStatusDto> {
    const challenge = await this.takeChallenge(auth.sessionId);
    let result;
    try {
      result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId, requireUserVerification: true });
    } catch {
      throw fail(ErrorCode.FaceIdFailed, "Face ID could not be set up.");
    }
    if (!result.verified || !result.registrationInfo.userVerified) throw fail(ErrorCode.FaceIdFailed, "Face ID could not be set up.");
    const { credential } = result.registrationInfo;
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(webauthnCredentials).where(and(eq(webauthnCredentials.userId, auth.userId), eq(webauthnCredentials.deviceId, auth.deviceId)));
      await tx.insert(webauthnCredentials).values({
        userId: auth.userId,
        deviceId: auth.deviceId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
      });
    });
    await this.audit(auth.userId, auth.sessionId, "face_id.enabled");
    this.ctx.events.toUser(auth.userId, { type: "security.updated" });
    return this.status(auth);
  }

  /** Turns Face ID off on this device (confirmed). */
  async faceIdRemove(auth: AuthContext): Promise<SecurityStatusDto> {
    await this.requireStepUp(auth);
    await this.ctx.db.delete(webauthnCredentials).where(and(eq(webauthnCredentials.userId, auth.userId), eq(webauthnCredentials.deviceId, auth.deviceId)));
    await this.audit(auth.userId, auth.sessionId, "face_id.disabled");
    this.ctx.events.toUser(auth.userId, { type: "security.updated" });
    return this.status(auth);
  }

  /** Assertion options for unlock / step-up: only this device's Face ID key is allowed. */
  async assertionOptions(sessionId: string, rp: RelyingParty) {
    const [s] = await this.ctx.db.select({ userId: sessions.userId, deviceId: sessions.deviceId }).from(sessions).where(eq(sessions.id, sessionId));
    if (!s) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const creds = await this.ctx.db
      .select()
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, s.userId), eq(webauthnCredentials.deviceId, s.deviceId)));
    if (!creds.length) throw fail(ErrorCode.FaceIdUnavailable, "Face ID is not set up on this device.");
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
      userVerification: "required",
      timeout: CHALLENGE_TTL_MS,
    });
    await this.saveChallenge(sessionId, options.challenge);
    return options;
  }

  private async verifyAssertion(userId: string, sessionId: string, deviceId: string, response: AuthenticationResponseJSON, rp: RelyingParty) {
    const challenge = await this.takeChallenge(sessionId);
    const [cred] = await this.ctx.db
      .select()
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.deviceId, deviceId), eq(webauthnCredentials.credentialId, String(response?.id ?? ""))));
    if (!cred) throw fail(ErrorCode.FaceIdFailed, "Face ID was not recognised on this device.");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        credential: { id: cred.credentialId, publicKey: new Uint8Array(cred.publicKey), counter: cred.counter, transports: cred.transports as never },
        requireUserVerification: true,
      });
    } catch {
      throw fail(ErrorCode.FaceIdFailed, "Face ID was not recognised.");
    }
    if (!result.verified) throw fail(ErrorCode.FaceIdFailed, "Face ID was not recognised.");
    await this.ctx.db
      .update(webauthnCredentials)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: this.ctx.now() })
      .where(eq(webauthnCredentials.id, cred.id));
  }

  private async saveChallenge(sessionId: string, challenge: string) {
    await this.ctx.db.update(sessions).set({ webauthnChallenge: challenge, webauthnChallengeAt: this.ctx.now() }).where(eq(sessions.id, sessionId));
  }

  /** One-time: the challenge is cleared as it is read, and only a fresh one counts. */
  private async takeChallenge(sessionId: string): Promise<string> {
    const challenge = await this.ctx.db.transaction(async (tx) => {
      const [s] = await tx
        .select({ challenge: sessions.webauthnChallenge, at: sessions.webauthnChallengeAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .for("update");
      await tx.update(sessions).set({ webauthnChallenge: null, webauthnChallengeAt: null }).where(eq(sessions.id, sessionId));
      if (!s?.challenge || !s.at || this.ctx.now().getTime() - s.at.getTime() > CHALLENGE_TTL_MS) return null;
      return s.challenge;
    });
    if (!challenge) throw fail(ErrorCode.FaceIdFailed, "The Face ID request expired. Try again.");
    return challenge;
  }

  private async audit(userId: string, sessionId: string, type: string) {
    await this.ctx.db.insert(securityEvents).values({ userId, type, sessionId });
  }
}

export function toAutoLock(m: number): AutoLockMinutes {
  return (AUTO_LOCK_OPTIONS as readonly number[]).includes(m) ? (m as AutoLockMinutes) : DEFAULT_AUTO_LOCK;
}
