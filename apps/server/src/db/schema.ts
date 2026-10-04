import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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
    /** Step 2.4: 6-digit code-password (scrypt hash), its lockout counter and window. */
    passcodeHash: text("passcode_hash"),
    passcodeSetAt: ts("passcode_set_at"),
    passcodeFailedCount: integer("passcode_failed_count").notNull().default(0),
    passcodeLockedUntil: ts("passcode_locked_until"),
    /** Registered from Step 2.4 on: the first setup asks for a passcode before the desktop. */
    passcodeSetupRequired: boolean("passcode_setup_required").notNull().default(false),
    /** Auto-lock after this many minutes without activity (0 = only on start / manually). */
    autoLockMinutes: integer("auto_lock_minutes").notNull().default(5),
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
    /** Step 2.4: the lock screen is up — no API access until unlocked (passcode / Face ID). */
    lockedAt: ts("locked_at"),
    /** Last confirmation for sensitive changes (passcode / Face ID); valid for a few minutes. */
    stepUpAt: ts("step_up_at"),
    /** Pending WebAuthn challenge of this session (one at a time, short-lived). */
    webauthnChallenge: text("webauthn_challenge"),
    webauthnChallengeAt: ts("webauthn_challenge_at"),
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

/**
 * One-time codes sent over SMS. A code made by VOIDEX is stored only as an
 * HMAC (`codeHash`). With a hosted-OTP gateway (otp.com) the gateway makes and
 * checks the code: `codeHash` is null and `providerRef` holds its otp_id.
 */
export const phoneVerifications = pgTable(
  "phone_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose", { enum: verificationPurposes }).notNull(),
    phone: text("phone").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash"),
    /** SMS provider that issued the code (e.g. "otpcom"). */
    provider: text("provider"),
    /** The hosted-OTP gateway's id for this verification. */
    providerRef: text("provider_ref"),
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
 * Mail attachments: metadata only. The bytes live behind the `BlobStorage`
 * interface (services/blobs.ts), referenced by `storageKey`.
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

/* ==========================================================================
   Files
   ========================================================================== */

/**
 * Binary content behind the BlobStorage interface (mail attachments, desktop
 * wallpapers). Owned by a user: deleting the account removes their files.
 * Callers delete a blob when the last thing referencing it goes away.
 */
export const blobs = pgTable(
  "blobs",
  {
    key: text("key").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the blob is for: "mail" attachment content or the "wallpaper". */
    purpose: text("purpose", { enum: ["mail", "wallpaper", "lock-wallpaper", "vibex"] }).notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("blobs_owner_idx").on(t.ownerUserId, t.purpose)],
);

/**
 * Step 2.4 Face ID: WebAuthn credentials of the device's own biometric
 * authenticator (Face ID / Touch ID / Windows Hello / fingerprint). Only the
 * public key is stored; the biometric itself never leaves the device.
 */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [uniqueIndex("webauthn_credentials_credential_uq").on(t.credentialId), index("webauthn_credentials_user_idx").on(t.userId, t.deviceId)],
);

/* ==========================================================================
   Vibex — messenger and social feed
   ========================================================================== */

/** A conversation. Direct chats have one row per pair of people (direct_key); groups have a title. */
export const vibexConversations = pgTable(
  "vibex_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["direct", "group"] }).notNull().default("direct"),
    /** "<smaller user id>:<larger user id>" — one direct chat per pair. */
    directKey: text("direct_key"),
    /** Step 2.4 groups: name, picture (a Vibex file), who created it. */
    title: text("title"),
    avatarFileId: uuid("avatar_file_id").references((): AnyPgColumn => vibexFiles.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vibex_conversations_direct_uq").on(t.directKey)],
);

/** Membership, with each member's read marker and their own pinned order. */
export const vibexMembers = pgTable(
  "vibex_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => vibexConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Everything up to here is read (null: nothing yet). */
    lastReadAt: ts("last_read_at"),
    /** Position among this member's pinned chats; null = not pinned. */
    pinnedPosition: integer("pinned_position"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    /** Groups: the creator is "owner" (renames, adds and removes people). */
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("vibex_members_user_idx").on(t.userId)],
);

/**
 * A post on someone's page. A repost is a post of kind "repost" pointing at the
 * original (never a copy). Posts are soft-deleted so reposts and history can
 * show "post unavailable".
 */
export const vibexPosts = pgTable(
  "vibex_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["post", "repost"] }).notNull().default("post"),
    text: text("text").notNull().default(""),
    repostOfId: uuid("repost_of_id").references((): AnyPgColumn => vibexPosts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** Step 2.2: the author edited the text. */
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("vibex_posts_created_idx").on(t.createdAt),
    index("vibex_posts_author_idx").on(t.authorId, t.createdAt),
    index("vibex_posts_repost_of_idx").on(t.repostOfId),
    uniqueIndex("vibex_posts_one_repost_uq").on(t.authorId, t.repostOfId).where(sql`kind = 'repost' AND deleted_at IS NULL`),
  ],
);

export const vibexMessages = pgTable(
  "vibex_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => vibexConversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull().default(""),
    /** A post shared into the chat ("Share → send in a message"). */
    sharedPostId: uuid("shared_post_id").references(() => vibexPosts.id, { onDelete: "set null" }),
    sharedPost: boolean("shared_post").notNull().default(false),
    /** Step 2.3: text (with optional files), a voice message or a video circle. */
    kind: text("kind", { enum: ["text", "voice", "circle"] }).notNull().default("text"),
    durationMs: integer("duration_ms"),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => vibexMessages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("vibex_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/** Files of chat messages and pictures of posts; the bytes live in `blobs`. */
export const vibexFiles = pgTable(
  "vibex_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["message", "post", "voice", "circle"] }).notNull(),
    /** Set when the message / post is sent; until then only the owner sees it. */
    messageId: uuid("message_id").references(() => vibexMessages.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => vibexPosts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("vibex_files_message_idx").on(t.messageId),
    index("vibex_files_post_idx").on(t.postId),
    index("vibex_files_owner_idx").on(t.ownerId, t.createdAt),
  ],
);

export const vibexLikes = pgTable(
  "vibex_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => vibexPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index("vibex_likes_user_idx").on(t.userId, t.createdAt)],
);

/** Private: only the person who bookmarked sees it. */
export const vibexBookmarks = pgTable(
  "vibex_bookmarks",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => vibexPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index("vibex_bookmarks_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Step 2.2: Vibex is activated per VOIDEX account (email + password on the
 * Vibex sign-in screen). One account = one Vibex profile; no second identity.
 */
export const vibexProfiles = pgTable("vibex_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Step 2.3: created automatically the first time the account uses Vibex (no separate sign-in). */
  activatedAt: ts("activated_at").notNull().defaultNow(),
  bio: text("bio").notNull().default(""),
  website: text("website").notNull().default(""),
  city: text("city").notNull().default(""),
  /** Profile cover (blob key); `coverVersion` changes with every new picture. */
  coverKey: text("cover_key"),
  coverMime: text("cover_mime"),
  coverVersion: integer("cover_version").notNull().default(0),
  /** Privacy / notification / media settings (VibexSettings, defaults filled in by the service). */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
});

/** Who follows whom (Vibex). */
export const vibexFollows = pgTable(
  "vibex_follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: "vibex_follows_pk", columns: [t.followerId, t.followeeId] }), index("vibex_follows_followee_idx").on(t.followeeId, t.createdAt)],
);

export const vibexComments = pgTable(
  "vibex_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => vibexPosts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** Step 2.3 threads: the top-level comment a reply belongs to (null: it is top-level). */
    rootId: uuid("root_id").references((): AnyPgColumn => vibexComments.id, { onDelete: "cascade" }),
    /** The comment (root or reply) this one answers, and its author (for "@name"). */
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => vibexComments.id, { onDelete: "set null" }),
    replyToUserId: uuid("reply_to_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("vibex_comments_post_idx").on(t.postId, t.createdAt), index("vibex_comments_root_idx").on(t.rootId, t.createdAt)],
);

/** "Not interested": the post leaves this person's feed. */
export const vibexHiddenPosts = pgTable(
  "vibex_hidden_posts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => vibexPosts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: "vibex_hidden_posts_pk", columns: [t.userId, t.postId] })],
);

/** Reports of posts, kept for moderation (one per person per post). */
export const vibexReports = pgTable(
  "vibex_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => vibexPosts.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: ["spam", "abuse", "other"] }).notNull().default("other"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("vibex_reports_once_uq").on(t.reporterId, t.postId)],
);

/* ==========================================================================
   Notification Center (Step 2.3)
   ========================================================================== */

/**
 * One notification for one account, from an app (Mail, Vibex) or the system.
 * `target` says what a tap opens (e.g. { threadId } / { chatId } / { postId }).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    target: jsonb("target").$type<Record<string, string>>().notNull().default({}),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);
