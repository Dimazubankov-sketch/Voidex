import type { NotificationDto } from "./notifications.js";
import type { AppId, AppManifest } from "./apps.js";
import type { Preferences } from "./api.js";
import type { LegalDocumentKey } from "./legal.js";
import type { MailFolder, RecipientKind } from "./mail.js";
import type { LanguageCode } from "./regions.js";

/** Response DTOs of the VOIDEX API. */

export interface MeDto {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  country: string;
  language: LanguageCode;
  phone: string;
  phoneVerifiedAt: string | null;
  hasAvatar: boolean;
  avatarVersion: number;
  mailAddress: string;
  createdAt: string;
  passwordChangedAt: string;
  preferences: Preferences;
}

export interface SessionResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  /** Present only for native clients, which keep it in secure storage. */
  refreshToken?: string;
  user: MeDto;
}

export interface VerificationStartedDto {
  verificationId: string;
  expiresAt: string;
  resendAfterSeconds: number;
  /**
   * Only present when the server runs the development SMS provider. It is
   * never sent in production — the server refuses to start that way.
   */
  devCode?: string;
}

export type ChallengeMethod = "sms" | "device";

export interface ChallengeDto {
  id: string;
  secret: string;
  kind: "login" | "recovery";
  methods: ChallengeMethod[];
  phoneMasked: string;
  expiresAt: string;
}

export type LoginResponse =
  | ({ status: "ok" } & SessionResponse)
  | { status: "challenge"; challenge: ChallengeDto };

export interface ChallengeStatusDto {
  status: "pending" | "approved" | "denied" | "expired" | "verified" | "completed";
}

export interface UsernameCheckDto {
  username: string;
  address: string;
  available: boolean;
  reason?: "taken" | "reserved" | "invalid" | "too_short" | "too_long" | "required";
  suggestions: string[];
}

export interface SessionDto {
  id: string;
  current: boolean;
  deviceName: string;
  platform: string;
  clientType: string;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string | null;
}

export interface ApprovalRequestDto {
  id: string;
  kind: "login" | "recovery";
  deviceName: string;
  platform: string;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ConsentDto {
  key: LegalDocumentKey;
  version: string;
  acceptedAt: string;
  current: boolean;
}

export interface LegalDocumentDto {
  key: LegalDocumentKey;
  version: string;
  title: string;
  language: LanguageCode;
  content: string;
  required: boolean;
}

export interface InstalledAppDto {
  id: AppId;
  installedAt: string;
  manifest: AppManifest;
}

export interface ServerInfoDto {
  name: string;
  version: string;
  environment: string;
  mailDomain: string;
  smsProvider: string;
  smsDevMode: boolean;
  /** False until a real SMS gateway is connected: registration is closed. */
  smsAvailable: boolean;
  /** Git commit of the running server build ("dev" locally). */
  revision: string;
}

// ---- mail -----------------------------------------------------------------

export interface MailAddressDto {
  address: string;
  name: string | null;
}

export interface MailSummaryDto {
  address: string;
  displayName: string;
  unread: { inbox: number; archive: number; starred: number };
  totals: { drafts: number; trash: number };
}

export interface ThreadSummaryDto {
  id: string;
  subject: string;
  snippet: string;
  participants: MailAddressDto[];
  messageCount: number;
  unread: boolean;
  starred: boolean;
  lastMessageAt: string;
  hasDraft: boolean;
  /** At least one message of the conversation carries a file. */
  hasAttachments: boolean;
  /** For the drafts view each item is a single draft. */
  draftId?: string;
}

export interface MailAttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface MailRecipientDto extends MailAddressDto {
  kind: RecipientKind;
}

export interface MailMessageDto {
  id: string;
  threadId: string;
  from: MailAddressDto;
  recipients: MailRecipientDto[];
  subject: string;
  body: string;
  status: "draft" | "sent";
  folder: MailFolder;
  read: boolean;
  starred: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  inReplyToId: string | null;
  forwardOfId: string | null;
  isOwn: boolean;
  attachments: MailAttachmentDto[];
}

export interface ThreadDetailDto {
  id: string;
  subject: string;
  messages: MailMessageDto[];
}

export interface DraftDto {
  id: string;
  threadId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  replyToMessageId: string | null;
  forwardOfMessageId: string | null;
  updatedAt: string;
  attachments: MailAttachmentDto[];
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ---- realtime -------------------------------------------------------------

export type ServerEvent =
  | { type: "hello"; sessionId: string }
  | { type: "account.updated" }
  | { type: "preferences.updated" }
  | { type: "apps.updated" }
  | { type: "sessions.updated" }
  | { type: "session.revoked"; sessionId: string }
  /** Step 2.4: this device's session was locked (lock screen); the stream closes. */
  | { type: "session.locked"; sessionId: string }
  /** Step 2.4: code-password / Face ID / auto-lock settings changed. */
  | { type: "security.updated" }
  | { type: "approval.requested"; approvalId: string }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "mail.changed"; threadIds?: string[] }
  /** Notification Center: a new notification for this account. */
  | { type: "notification.new"; notification: NotificationDto }
  /** Notification Center: read / cleared elsewhere — refresh. */
  | { type: "notifications.changed" }
  /** Vibex: follows / profile of this person changed. */
  | { type: "vibex.profile"; userId: string }
  /** Vibex: a new chat message (to every member's devices). */
  | { type: "vibex.message"; conversationId: string; messageId: string; senderId: string; senderName: string; snippet: string }
  /** Vibex: chats changed (read receipts, pins) — refresh the list. */
  | { type: "vibex.chats"; conversationId?: string }
  /** Vibex: a post was created / edited / liked / commented / removed — refresh feeds. */
  | { type: "vibex.feed"; postId?: string }
  | {
      type: "mail.received";
      threadId: string;
      messageId: string;
      from: MailAddressDto;
      subject: string;
      snippet: string;
    };
