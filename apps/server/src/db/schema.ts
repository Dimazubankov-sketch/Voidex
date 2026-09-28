import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Preferences } from "@voidex/shared";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

/* ==========================================================================
   Identity
   ========================================================================== */

/**
 * A VOIDEX account. One row = one person's whole digital space; every device
 * signs in to the same row, which is the single source of truth.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    country: text("country").notNull(),
    language: text("language").notNull(),
    phone: text("phone").notNull(), // E.164
    phoneVerifiedAt: ts("phone_verified_at"),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: ts("password_changed_at").notNull().defaultNow(),
    status: text("status", { enum: ["active", "locked", "deleted"] }).notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    avatarVersion: integer("avatar_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_phone_uq").on(t.phone)],
);

export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Synced per-account preferences (same on every device). */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Preferences>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Record of every legal document version a user explicitly accepted. */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentKey: text("document_key").notNull(),
    documentVersion: text("document_version").notNull(),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("consents_user_doc_uq").on(t.userId, t.documentKey, t.documentVersion)],
);

/* ==========================================================================
   Devices & sessions
   ========================================================================== */

/**
 * A physical/browser installation of VOIDEX. Identified by a random device
 * secret held by the client (httpOnly cookie on web, secure storage on native);
 * only its SHA-256 is stored. A device becomes `trusted` after a sign-in that
 * passed a second factor, which lets later sign-ins skip the challenge.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    clientType: text("client_type").notNull(),
    trustedAt: ts("trusted_at"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("devices_user_token_uq").on(t.userId, t.tokenHash)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    /** Hash of the token before the last rotation; reuse outside the grace window = theft. */
    previousRefreshTokenHash: text("previous_refresh_token_hash"),
    rotatedAt: ts("rotated_at"),
    createdAt: createdAt(),
    lastActiveAt: ts("last_active_at").notNull().defaultNow(),
    /** Sliding idle expiry, extended on every refresh. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap regardless of activity. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    revokeReason: text("revoke_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_refresh_uq").on(t.refreshTokenHash),
    index("sessions_prev_refresh_idx").on(t.previousRefreshTokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/* ==========================================================================
   Verification (OTP) & challenges
   ========================================================================== */

export const verificationPurposes = ["signup", "login", "recovery", "change_phone"] as const;

/** One-time codes sent over SMS. The code itself is stored only as an HMAC. */
export const phoneVerifications = pgTable(
  "phone_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose", { enum: verificationPurposes }).notNull(),
    phone: text("phone").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: ts("expires_at").notNull(),
    verifiedAt: ts("verified_at"),
    /** Hash of the proof token handed out after successful verification. */
    proofHash: text("proof_hash"),
    consumedAt: ts("consumed_at"),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [index("phone_verifications_phone_idx").on(t.phone, t.createdAt)],
);

/**
 * A pending second step for sign-in from a new device or password recovery.
 * The requesting client proves ownership with `secret` (stored hashed); the
 * challenge is satisfied by an SMS code or by approval from a trusted device.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["login", "recovery"] }).notNull(),
    secretHash: text("secret_hash").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "denied", "verified", "completed", "expired"],
    })
      .notNull()
      .default("pending"),
    method: text("method", { enum: ["sms", "device"] }),
    verificationId: uuid("verification_id").references(() => phoneVerifications.id, { onDelete: "set null" }),
    deviceApprovalRequestedAt: ts("device_approval_requested_at"),
    resolvedBySessionId: uuid("resolved_by_session_id"),
    requestDeviceName: text("request_device_name").notNull(),
    requestPlatform: text("request_platform").notNull(),
    requestClientType: text("request_client_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_challenges_user_idx").on(t.userId, t.status)],
);

/** Audit trail of security-relevant events (shown to the user later). */
export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sessionId: uuid("session_id"),
    ipAddress: text("ip_address"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("security_events_user_idx").on(t.userId, t.createdAt)],
);

/* ==========================================================================
   Apps
   ========================================================================== */

/** Apps installed into an account (synced across devices). */
export const installedApps = pgTable(
  "installed_apps",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    version: text("version").notNull(),
    installedAt: ts("installed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.appId] })],
);

/* ==========================================================================
   Mail
   ========================================================================== */

/** A mail address owned by a user. Step 1: exactly one internal address. */
export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localPart: text("local_part").notNull(),
    domain: text("domain").notNull(),
    address: text("address").notNull(),
    transport: text("transport", { enum: ["internal"] }).notNull().default("internal"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mail_accounts_address_uq").on(t.address),
    uniqueIndex("mail_accounts_local_uq").on(t.localPart, t.domain),
    index("mail_accounts_user_idx").on(t.userId),
  ],
);

/** A conversation. Visibility is never granted by the thread — only by mailbox entries. */
export const mailThreads = pgTable("mail_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull(),
  createdAt: createdAt(),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
});

/** A single message (draft or sent). Content is stored once and shared by all recipients. */
export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").references(() => mailThreads.id, { onDelete: "cascade" }),
    senderAccountId: uuid("sender_account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    senderAddress: text("sender_address").notNull(),
    senderName: text("sender_name").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    status: text("status", { enum: ["draft", "sent"] }).notNull(),
    transport: text("transport", { enum: ["internal"] }).notNull().default("internal"),
    inReplyToId: uuid("in_reply_to_id"),
    forwardOfId: uuid("forward_of_id"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("mail_messages_thread_idx").on(t.threadId), index("mail_messages_sender_idx").on(t.senderAccountId, t.status)],
);

export const mailRecipients = pgTable(
  "mail_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["to", "cc", "bcc"] }).notNull(),
    address: text("address").notNull(),
    name: text("name"),
    accountId: uuid("account_id").references(() => mailAccounts.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("mail_recipients_message_idx").on(t.messageId)],
);

/**
 * A message as it appears in one mailbox: folder, read and star state are
 * per owner. A user can read a message only through an entry they own.
 */
export const mailEntries = pgTable(
  "mail_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => mailAccounts.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => mailThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["sender", "recipient"] }).notNull(),
    folder: text("folder", { enum: ["inbox", "sent", "drafts", "archive", "trash"] }).notNull(),
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    /** Sort key: sent time for delivered mail, last edit for drafts. */
    sortAt: ts("sort_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mail_entries_account_message_uq").on(t.accountId, t.messageId),
    index("mail_entries_folder_idx")
      .on(t.accountId, t.folder, t.sortAt)
      .where(sql`${t.deletedAt} is null`),
    index("mail_entries_thread_idx").on(t.accountId, t.threadId),
  ],
);

/**
 * Attachments — data model reserved for the next step. Binary content will live
 * in an object store behind the `BlobStorage` interface; only metadata here.
 */
export const mailAttachments = pgTable(
  "mail_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailMessages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("mail_attachments_message_idx").on(t.messageId)],
);
