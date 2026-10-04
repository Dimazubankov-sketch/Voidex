import { and, eq, inArray, sql } from "drizzle-orm";
import {
  APP_IDS,
  APP_REGISTRY,
  DEFAULT_PREFERENCES,
  ErrorCode,
  LEGAL_DOCUMENTS,
  PreferencesPatchSchema,
  normalizeLayout,
  type MeDto,
  type Preferences,
  type UsernameCheckDto,
  isPasswordAcceptable,
  normalizeName,
  normalizeUsername,
  parseIsoDate,
  usernameCandidates,
  validateBirthDate,
  validateName,
  validateUsername,
  type LanguageCode,
} from "@voidex/shared";
import { isCountryCode, parsePhone, type CountryCode } from "@voidex/shared/phone";
import type { z } from "zod";
import type { RegisterSchema, ProfileUpdateSchema } from "@voidex/shared";
import type { Tx } from "../db/client.js";
import {
  consents,
  installedApps,
  mailAccounts,
  securityEvents,
  userAvatars,
  userPreferences,
  users,
} from "../db/schema.js";
import { AppError, fail, validationError } from "../lib/errors.js";
import { dummyHash, hashPassword, needsRehash, verifyPassword } from "../lib/password.js";
import type { Ctx, RequestMeta } from "./context.js";
import type { SessionService } from "./sessions.js";
import type { VerificationService } from "./verification.js";

const LOCK_THRESHOLD = 5;
const MAX_LOCK_MS = 60 * 60_000;

type User = typeof users.$inferSelect;

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const c = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (!constraint || c === constraint);
}

export class AccountService {
  constructor(
    private readonly ctx: Ctx,
    private readonly sessions: SessionService,
    private readonly verification: VerificationService,
  ) {}

  // ---------------------------------------------------------------- reads

  async me(userId: string, tx: Tx = this.ctx.db): Promise<MeDto> {
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const mail = await tx.query.mailAccounts.findFirst({
      where: and(eq(mailAccounts.userId, userId), eq(mailAccounts.isPrimary, true)),
    });
    const prefs = await tx.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) });
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      birthDate: user.birthDate,
      country: user.country,
      language: user.language as LanguageCode,
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      hasAvatar: user.avatarVersion > 0,
      avatarVersion: user.avatarVersion,
      mailAddress: mail?.address ?? "",
      createdAt: user.createdAt.toISOString(),
      passwordChangedAt: user.passwordChangedAt.toISOString(),
      preferences: mergePreferences(prefs?.data),
    };
  }

  async checkUsername(raw: string, firstName = "", lastName = ""): Promise<UsernameCheckDto> {
    const username = normalizeUsername(raw);
    const domain = this.ctx.config.mailDomain;
    const problem = validateUsername(username);
    let available = false;
    let reason: UsernameCheckDto["reason"];
    if (problem) reason = problem;
    else {
      available = !(await this.usernameExists(username));
      if (!available) reason = "taken";
    }
    let suggestions: string[] = [];
    if (!available && (username || firstName || lastName)) {
      const candidates = usernameCandidates(username, firstName, lastName).slice(0, 20);
      if (candidates.length) {
        const taken = await this.ctx.db
          .select({ local: mailAccounts.localPart })
          .from(mailAccounts)
          .where(and(eq(mailAccounts.domain, domain), inArray(mailAccounts.localPart, candidates)));
        const takenSet = new Set(taken.map((t) => t.local));
        suggestions = candidates.filter((c) => !takenSet.has(c)).slice(0, 4);
      }
    }
    return { username, address: `${username}@${domain}`, available, reason, suggestions };
  }

  private async usernameExists(local: string, tx: Tx = this.ctx.db) {
    const row = await tx.query.mailAccounts.findFirst({
      where: and(eq(mailAccounts.localPart, local), eq(mailAccounts.domain, this.ctx.config.mailDomain)),
      columns: { id: true },
    });
    return !!row;
  }

  async phoneLinked(phone: string) {
    const row = await this.ctx.db.query.users.findFirst({ where: eq(users.phone, phone), columns: { id: true } });
    return !!row;
  }

  /**
   * Resolves what a user typed into "Email or phone": a VOIDEX address, a bare
   * username, or a phone number.
   */
  async findByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim();
    const domain = this.ctx.config.mailDomain;
    if (value.includes("@")) {
      const [local, dom] = value.toLowerCase().split("@");
      if (dom !== domain || !local) return null;
      return this.findByUsername(local);
    }
    if (/^[+\d][\d\s()-]{5,}$/.test(value)) {
      const phone = parsePhone(value);
      if (!phone) return null;
      return (await this.ctx.db.query.users.findFirst({ where: eq(users.phone, phone.e164) })) ?? null;
    }
    return this.findByUsername(value.toLowerCase());
  }

  private async findByUsername(local: string): Promise<User | null> {
    const [row] = await this.ctx.db
      .select({ user: users })
      .from(mailAccounts)
      .innerJoin(users, eq(users.id, mailAccounts.userId))
      .where(and(eq(mailAccounts.localPart, local), eq(mailAccounts.domain, this.ctx.config.mailDomain)));
    return row?.user ?? null;
  }

  // ---------------------------------------------------------------- register

  async register(input: z.infer<typeof RegisterSchema>, meta: RequestMeta) {
    const fields: Record<string, string> = {};
    const firstName = normalizeName(input.firstName);
    const lastName = normalizeName(input.lastName);
    const fnErr = validateName(firstName);
    const lnErr = validateName(lastName);
    if (fnErr) fields.firstName = fnErr;
    if (lnErr) fields.lastName = lnErr;

    if (!isCountryCode(input.country)) fields.country = "invalid";
    const birth = parseIsoDate(input.birthDate);
    const birthErr = birth ? validateBirthDate(birth, input.country as CountryCode, this.ctx.now()) : "invalid";
    if (birthErr) fields.birthDate = birthErr;

    const username = normalizeUsername(input.username);
    const unErr = validateUsername(username);
    if (unErr) fields.username = unErr;

    if (!isPasswordAcceptable(input.password, { username, firstName, lastName })) fields.password = "weak";

    const accepted = new Map(input.consents.map((c) => [c.key, c.version]));
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.required && accepted.get(doc.key) !== doc.version) fields[`consent.${doc.key}`] = "required";
    }

    if (Object.keys(fields).length) {
      if (fields.birthDate === "too_young") {
        throw fail(ErrorCode.TooYoung, "You are below the minimum age for a VOIDEX account in your country.", { fields });
      }
      if (Object.keys(fields).some((f) => f.startsWith("consent."))) {
        throw fail(ErrorCode.ConsentRequired, "Please accept the required documents.", { fields });
      }
      if (fields.password) throw fail(ErrorCode.PasswordWeak, "This password is too weak.", { fields });
      throw validationError(fields);
    }

    const passwordHash = await hashPassword(input.password);
    const domain = this.ctx.config.mailDomain;
    const now = this.ctx.now();

    try {
      return await this.ctx.db.transaction(async (tx) => {
        const phone = await this.verification.consumeProof(
          { id: input.phoneVerification.id, proof: input.phoneVerification.proof, purpose: "signup" },
          tx,
        );
        if (await tx.query.users.findFirst({ where: eq(users.phone, phone), columns: { id: true } })) {
          throw fail(ErrorCode.PhoneTaken, "This phone number is already linked to a VOIDEX account.");
        }
        if (await this.usernameExists(username, tx)) {
          const check = await this.checkUsername(username, firstName, lastName);
          throw fail(ErrorCode.UsernameTaken, "This address is already taken.", {
            details: { suggestions: check.suggestions },
          });
        }

        const [user] = await tx
          .insert(users)
          .values({
            firstName,
            lastName,
            birthDate: input.birthDate,
            country: input.country,
            language: input.language,
            phone,
            phoneVerifiedAt: now,
            passwordHash,
            passwordChangedAt: now,
            // Step 2.4: the first setup asks for a code-password before the desktop.
            passcodeSetupRequired: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const userId = user!.id;

        await tx.insert(mailAccounts).values({
          userId,
          localPart: username,
          domain,
          address: `${username}@${domain}`,
          createdAt: now,
        });
        await tx.insert(userPreferences).values({ userId, data: DEFAULT_PREFERENCES });
        await tx.insert(consents).values(
          LEGAL_DOCUMENTS.map((d) => ({
            userId,
            documentKey: d.key,
            documentVersion: d.version,
            acceptedAt: now,
            ipAddress: meta.ip,
            userAgent: meta.userAgent?.slice(0, 400),
          })),
        );
        await tx.insert(installedApps).values(
          Object.values(APP_REGISTRY)
            .filter((a) => a.preinstalled)
            .map((a) => ({ userId, appId: a.id, version: a.version, installedAt: now })),
        );
        await tx.insert(securityEvents).values({ userId, type: "account.created", ipAddress: meta.ip });

        // Phone was just verified on this device, so it starts trusted.
        const issued = await this.sessions.create(tx, userId, meta, { trustDevice: true });
        const me = await this.me(userId, tx);
        return { issued, me };
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isUniqueViolation(err, "users_phone_uq")) {
        throw fail(ErrorCode.PhoneTaken, "This phone number is already linked to a VOIDEX account.");
      }
      if (isUniqueViolation(err, "mail_accounts_address_uq") || isUniqueViolation(err, "mail_accounts_local_uq")) {
        throw fail(ErrorCode.UsernameTaken, "This address is already taken.");
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- login

  /**
   * Checks credentials with brute-force protection. Returns the user on
   * success; the caller decides between issuing a session and a challenge.
   */
  async verifyCredentials(identifier: string, password: string, meta: RequestMeta): Promise<User> {
    const user = await this.findByIdentifier(identifier);
    const now = this.ctx.now();
    if (!user || user.status === "deleted") {
      await verifyPassword(password, await dummyHash()); // equalise timing
      throw fail(ErrorCode.InvalidCredentials, "Incorrect email/phone or password.");
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw fail(ErrorCode.AccountLocked, "Too many failed attempts. Try again later.", { details: { retryAfterSeconds } });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const count = user.failedLoginCount + 1;
      const lockedUntil =
        count >= LOCK_THRESHOLD ? new Date(now.getTime() + Math.min(MAX_LOCK_MS, 60_000 * 2 ** (count - LOCK_THRESHOLD))) : null;
      await this.ctx.db.update(users).set({ failedLoginCount: count, lockedUntil }).where(eq(users.id, user.id));
      await this.ctx.db
        .insert(securityEvents)
        .values({ userId: user.id, type: "login.failed", ipAddress: meta.ip, meta: { count } });
      if (lockedUntil) {
        throw fail(ErrorCode.AccountLocked, "Too many failed attempts. Try again later.", {
          details: { retryAfterSeconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000) },
        });
      }
      throw fail(ErrorCode.InvalidCredentials, "Incorrect email/phone or password.");
    }
    const patch: Partial<User> = { failedLoginCount: 0, lockedUntil: null };
    if (needsRehash(user.passwordHash)) patch.passwordHash = await hashPassword(password);
    await this.ctx.db.update(users).set(patch).where(eq(users.id, user.id));
    return user;
  }

  // ---------------------------------------------------------------- profile

  async updateProfile(userId: string, input: z.infer<typeof ProfileUpdateSchema>) {
    const user = await this.ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    const fields: Record<string, string> = {};
    const patch: Partial<User> = {};
    if (input.firstName !== undefined) {
      const v = normalizeName(input.firstName);
      const e = validateName(v);
      if (e) fields.firstName = e;
      else patch.firstName = v;
    }
    if (input.lastName !== undefined) {
      const v = normalizeName(input.lastName);
      const e = validateName(v);
      if (e) fields.lastName = e;
      else patch.lastName = v;
    }
    if (input.country !== undefined) {
      if (isCountryCode(input.country)) patch.country = input.country;
      else fields.country = "invalid";
    }
    if (input.language !== undefined) patch.language = input.language;
    if (input.birthDate !== undefined || input.country !== undefined) {
      const birthIso = input.birthDate ?? user.birthDate;
      const parts = parseIsoDate(birthIso);
      const e = parts ? validateBirthDate(parts, (patch.country ?? user.country) as CountryCode, this.ctx.now()) : "invalid";
      if (e) fields.birthDate = e;
      else if (input.birthDate !== undefined) patch.birthDate = birthIso;
    }
    if (Object.keys(fields).length) throw validationError(fields);
    if (Object.keys(patch).length) {
      await this.ctx.db.update(users).set({ ...patch, updatedAt: this.ctx.now() }).where(eq(users.id, userId));
      this.ctx.events.toUser(userId, { type: "account.updated" });
    }
    return this.me(userId);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    input: { currentPassword: string; newPassword: string; signOutOtherDevices: boolean },
    meta: RequestMeta,
  ) {
    const user = await this.ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      await this.ctx.db.insert(securityEvents).values({ userId, type: "password.change_failed", sessionId, ipAddress: meta.ip });
      throw fail(ErrorCode.WrongPassword, "Current password is incorrect.", { fields: { currentPassword: "wrong" } });
    }
    await this.setPassword(user, input.newPassword);
    await this.ctx.db.insert(securityEvents).values({ userId, type: "password.changed", sessionId, ipAddress: meta.ip });
    let revoked = 0;
    if (input.signOutOtherDevices) revoked = await this.sessions.revokeAll(userId, "password_changed", { except: sessionId });
    this.ctx.events.toUser(userId, { type: "account.updated" });
    return { revokedSessions: revoked };
  }

  /** Validates and stores a new password (used by change and recovery). */
  async setPassword(user: User, newPassword: string, tx: Tx = this.ctx.db) {
    const mail = await tx.query.mailAccounts.findFirst({ where: eq(mailAccounts.userId, user.id) });
    if (!isPasswordAcceptable(newPassword, { username: mail?.localPart, firstName: user.firstName, lastName: user.lastName, phone: user.phone })) {
      throw fail(ErrorCode.PasswordWeak, "This password is too weak.", { fields: { newPassword: "weak" } });
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw fail(ErrorCode.PasswordWeak, "The new password must be different from the current one.", {
        fields: { newPassword: "same" },
      });
    }
    const now = this.ctx.now();
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, user.id));
  }

  async startPhoneChange(userId: string, input: { password: string; phone: string; country?: string }, meta: RequestMeta) {
    const user = await this.ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw fail(ErrorCode.Unauthenticated, "Please sign in.");
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw fail(ErrorCode.WrongPassword, "Password is incorrect.", { fields: { password: "wrong" } });
    }
    const parsed = parsePhone(input.phone, input.country as CountryCode | undefined);
    if (!parsed) throw fail(ErrorCode.PhoneInvalid, "Enter a valid mobile phone number.", { fields: { phone: "invalid" } });
    if (parsed.e164 === user.phone) {
      throw fail(ErrorCode.PhoneInvalid, "This is already your phone number.", { fields: { phone: "same" } });
    }
    if (await this.phoneLinked(parsed.e164)) {
      throw fail(ErrorCode.PhoneTaken, "This phone number is already linked to a VOIDEX account.", { fields: { phone: "taken" } });
    }
    return this.verification.start({ purpose: "change_phone", phone: parsed.e164, userId, ip: meta.ip, language: user.language });
  }

  async confirmPhoneChange(userId: string, sessionId: string, input: { verificationId: string; code: string }, meta: RequestMeta) {
    const { phone } = await this.verification.verify({ id: input.verificationId, code: input.code, purpose: "change_phone", userId });
    const now = this.ctx.now();
    try {
      await this.ctx.db.update(users).set({ phone, phoneVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
    } catch (err) {
      if (isUniqueViolation(err)) throw fail(ErrorCode.PhoneTaken, "This phone number is already linked to a VOIDEX account.");
      throw err;
    }
    await this.ctx.db.insert(securityEvents).values({ userId, type: "phone.changed", sessionId, ipAddress: meta.ip });
    this.ctx.events.toUser(userId, { type: "account.updated" });
    return this.me(userId);
  }

  // ---------------------------------------------------------------- avatar

  async setAvatar(userId: string, mimeType: string, data: Buffer) {
    await this.ctx.db
      .insert(userAvatars)
      .values({ userId, mimeType, data })
      .onConflictDoUpdate({ target: userAvatars.userId, set: { mimeType, data, updatedAt: this.ctx.now() } });
    await this.ctx.db
      .update(users)
      .set({ avatarVersion: sql`${users.avatarVersion} + 1` })
      .where(eq(users.id, userId));
    this.ctx.events.toUser(userId, { type: "account.updated" });
    return this.me(userId);
  }

  async deleteAvatar(userId: string) {
    await this.ctx.db.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await this.ctx.db.update(users).set({ avatarVersion: 0 }).where(eq(users.id, userId));
    this.ctx.events.toUser(userId, { type: "account.updated" });
    return this.me(userId);
  }

  async getAvatar(userId: string) {
    return (await this.ctx.db.query.userAvatars.findFirst({ where: eq(userAvatars.userId, userId) })) ?? null;
  }

  // ---------------------------------------------------------------- wallpaper

  /**
   * One wallpaper image per account and slot (desktop, and since Step 2.4 the
   * lock screen): a new upload replaces the previous one in that slot.
   */
  async setWallpaper(userId: string, mimeType: string, data: Buffer, slot: WallpaperSlot = "desktop") {
    const purpose = slotPurpose(slot);
    const version = await this.ctx.db.transaction(async (tx) => {
      await this.ctx.blobs.delete(await this.ctx.blobs.keysOf(userId, purpose, tx), tx);
      const key = await this.ctx.blobs.put({ ownerUserId: userId, purpose, mimeType, data }, tx);
      return key.slice(-12);
    });
    return { version };
  }

  async getWallpaper(userId: string, slot: WallpaperSlot = "desktop") {
    const [key] = await this.ctx.blobs.keysOf(userId, slotPurpose(slot));
    return key ? this.ctx.blobs.get(key) : null;
  }

  async deleteWallpaper(userId: string, slot: WallpaperSlot = "desktop") {
    await this.ctx.blobs.delete(await this.ctx.blobs.keysOf(userId, slotPurpose(slot)));
    return { ok: true };
  }

  // ---------------------------------------------------------------- preferences

  async updatePreferences(userId: string, patch: z.infer<typeof PreferencesPatchSchema>) {
    const current = await this.ctx.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, userId) });
    const base = mergePreferences(current?.data);
    const next: Preferences = {
      notifications: { ...base.notifications, ...patch.notifications },
      workspace: { ...base.workspace, ...patch.workspace },
    };
    if (patch.workspace?.layout) {
      // The server keeps the desktop consistent with what is really installed.
      const installed = await this.ctx.db.query.installedApps.findMany({ where: eq(installedApps.userId, userId) });
      // Registry order (rows come back in no guaranteed order): missing apps are appended in this order.
      const have = new Set(installed.map((r) => r.appId));
      const ids = APP_IDS.filter((id) => have.has(id) && APP_REGISTRY[id].status === "available");
      next.workspace.layout = normalizeLayout(patch.workspace.layout, ids);
    }
    await this.ctx.db
      .insert(userPreferences)
      .values({ userId, data: next })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { data: next, updatedAt: this.ctx.now() } });
    this.ctx.events.toUser(userId, { type: "preferences.updated" });
    return next;
  }

  async consents(userId: string) {
    const rows = await this.ctx.db.query.consents.findMany({ where: eq(consents.userId, userId) });
    return rows.map((r) => ({
      key: r.documentKey,
      version: r.documentVersion,
      acceptedAt: r.acceptedAt.toISOString(),
      current: LEGAL_DOCUMENTS.some((d) => d.key === r.documentKey && d.version === r.documentVersion),
    }));
  }
}

export function mergePreferences(data: Partial<Preferences> | undefined | null): Preferences {
  return {
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...data?.notifications },
    workspace: { ...DEFAULT_PREFERENCES.workspace, ...data?.workspace },
  };
}

export type WallpaperSlot = "desktop" | "lock";
const slotPurpose = (slot: WallpaperSlot) => (slot === "lock" ? ("lock-wallpaper" as const) : ("wallpaper" as const));
