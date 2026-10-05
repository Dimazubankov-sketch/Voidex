import type { NotesCardDto } from "./notes.js";
import { z } from "zod";

/**
 * Vibex — the messenger and social feed of VOIDEX. Same accounts, sessions and
 * sync as the rest of the OS; data lives on the VOIDEX server (PostgreSQL),
 * files in the shared blob storage.
 */

export const VIBEX_MESSAGE_MAX = 4000;
export const VIBEX_POST_MAX = 2000;
export const VIBEX_COMMENT_MAX = 1000;
/** Files on one chat message / images on one post. */
export const VIBEX_FILES_MAX = 10;
export const VIBEX_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Step 2.3: voice messages, video circles and post videos may be larger. */
export const VIBEX_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
/** Post media: pictures (Step 2.3: and videos). */
export const VIBEX_POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const VIBEX_POST_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const VIBEX_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "video/webm"];
export const VIBEX_CIRCLE_TYPES = ["video/webm", "video/mp4"];
/** Voice messages and video circles: at most this long. */
export const VIBEX_VOICE_MAX_MS = 5 * 60 * 1000;
export const VIBEX_CIRCLE_MAX_MS = 60 * 1000;
export const VIBEX_BIO_MAX = 240;
export const VIBEX_WEBSITE_MAX = 120;
export const VIBEX_CITY_MAX = 60;
export const VIBEX_COVER_MAX_BYTES = 8 * 1024 * 1024;
export const VIBEX_PAGE = 30;

export interface VibexPersonDto {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  /** VOIDEX Mail local part — the @handle. */
  handle: string;
  address: string;
  avatarVersion: number;
}

export interface VibexFileDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Images and videos get previews, audio a player; everything else is a downloadable file. */
  kind: "image" | "video" | "audio" | "file";
}

export interface VibexPostDto {
  id: string;
  kind: "post" | "repost";
  author: VibexPersonDto;
  text: string;
  media: VibexFileDto[];
  createdAt: string;
  likes: number;
  /** How many people shared it on their page. */
  reposts: number;
  liked: boolean;
  bookmarked: boolean;
  /** I shared it on my page. */
  reposted: boolean;
  mine: boolean;
  /** Step 2.2: comment count, last edit time. */
  comments: number;
  editedAt: string | null;
  /** Step 2.5: unique signed-in people who saw it (the author is not counted). */
  views: number;
  /** Step 2.5: shares — reposts plus sends into chats. */
  shares: number;
  /** Reposts: the original post, or null when it is no longer available. */
  repostOf?: VibexPostDto | null;
}

export interface VibexMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  mine: boolean;
  /** Step 2.3: a text message (with optional files), a voice message or a video circle. */
  kind: VibexMessageKind;
  /** Voice / circle length. */
  durationMs: number | null;
  /** The message this one answers (a short preview). */
  replyTo: { id: string; senderId: string; text: string; kind: VibexMessageKind; deleted?: boolean } | null;
  text: string;
  files: VibexFileDto[];
  /** A post shared into the chat (null: shared, but no longer available). */
  sharedPost?: VibexPostDto | null;
  createdAt: string;
  /** Step 2.5: deleted by its sender — show "Сообщение удалено" (text and files are gone). */
  deleted?: boolean;
  /** Step 2.6: a Voidex Notes file card (opening it checks access in Notes). */
  notesCard?: NotesCardDto | null;
}

/** Step 2.4: a group chat (several people, a name, an optional picture). */
export interface VibexGroupDto {
  title: string;
  /** Group picture (a Vibex file of purpose "group"), null: initials. */
  avatarFileId: string | null;
  /** Everyone in the group, me included. */
  members: VibexPersonDto[];
  /** My role: the creator ("owner") can rename the group and change its picture. */
  role: "owner" | "member";
}

export interface VibexChatDto {
  id: string;
  kind: "direct" | "group";
  /** Direct chats: the other person. Groups: null (see `group`). */
  peer: VibexPersonDto | null;
  /** Groups only. */
  group: VibexGroupDto | null;
  lastMessage: VibexMessageDto | null;
  lastMessageAt: string;
  unread: number;
  /** Position among pinned chats (0 = top); null when not pinned. */
  pinnedPosition: number | null;
  /** The other person has read everything up to here (read receipts). */
  peerReadAt: string | null;
}

export interface VibexHistoryItemDto {
  postId: string;
  /** When it was liked / bookmarked. */
  at: string;
  /** null: the post was deleted. */
  post: VibexPostDto | null;
}

export type VibexMessageKind = "text" | "voice" | "circle";

export interface VibexProfileDto {
  person: VibexPersonDto;
  posts: number;
  me: boolean;
  /** Step 2.3: profile details (empty strings are not shown). */
  bio: string;
  website: string;
  city: string;
  /** 0: no cover picture. */
  coverVersion: number;
  followers: number;
  following: number;
  /** I follow this person / they follow me. */
  followed: boolean;
  followsMe: boolean;
  /** Privacy: the profile details and posts are visible to me. */
  visible: boolean;
  /** Privacy: I may write to this person. */
  canMessage: boolean;
}

export interface VibexCommentDto {
  id: string;
  postId: string;
  author: VibexPersonDto;
  text: string;
  createdAt: string;
  mine: boolean;
  /** Step 2.3 threads: null for a top-level comment, else the top-level comment it belongs to. */
  rootId: string | null;
  /** Whom this reply answers (shown as "@name"). */
  replyTo: { commentId: string | null; person: VibexPersonDto } | null;
  /** Top-level comments: how many replies they have. */
  replies: number;
}

/** One VOIDEX account = one Vibex profile, created automatically; `person` is how others see me. */
export interface VibexMeDto {
  /** Always true since Step 2.3 (kept for older clients). */
  activated: boolean;
  person: VibexPersonDto;
  settings: VibexSettings;
}

/** A picture or video from someone's posts (profile "Photo / Video"). */
export interface VibexMediaItemDto {
  file: VibexFileDto;
  postId: string;
  createdAt: string;
}

export const VIBEX_AUDIENCES = ["everyone", "followers", "nobody"] as const;
export type VibexAudience = (typeof VIBEX_AUDIENCES)[number];

export const VibexSettingsSchema = z.object({
  privacy: z.object({
    /** Who can write to me. */
    messages: z.enum(VIBEX_AUDIENCES).default("everyone"),
    /** Who sees my profile details (bio, site, city, cover). */
    profile: z.enum(["everyone", "followers"]).default("everyone"),
    /** Who sees my posts and media. */
    posts: z.enum(["everyone", "followers"]).default("everyone"),
    /** Read receipts both ways (off: nobody sees mine and I see nobody's). */
    readReceipts: z.boolean().default(true),
    /** People who can't write to me or follow me. */
    blocked: z.array(z.string().uuid()).max(500).default([]),
  }).default({ messages: "everyone", profile: "everyone", posts: "everyone", readReceipts: true, blocked: [] }),
  notifications: z.object({
    messages: z.boolean().default(true),
    comments: z.boolean().default(true),
    likes: z.boolean().default(true),
    follows: z.boolean().default(true),
  }).default({ messages: true, comments: true, likes: true, follows: true }),
  media: z.object({
    autoplay: z.boolean().default(true),
    quality: z.enum(["auto", "high", "saver"]).default("auto"),
  }).default({ autoplay: true, quality: "auto" }),
});
export type VibexSettings = z.infer<typeof VibexSettingsSchema>;
export const DEFAULT_VIBEX_SETTINGS: VibexSettings = VibexSettingsSchema.parse({});

/** Partial update: any section, any field. */
export const VibexSettingsUpdateSchema = z.object({
  privacy: VibexSettingsSchema.shape.privacy.unwrap().partial().optional(),
  notifications: VibexSettingsSchema.shape.notifications.unwrap().partial().optional(),
  media: VibexSettingsSchema.shape.media.unwrap().partial().optional(),
});

/** Profile editor: names are the VOIDEX account's own (one identity); the rest is Vibex. */
export const VibexProfileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100),
    bio: z.string().trim().max(VIBEX_BIO_MAX),
    website: z
      .string()
      .trim()
      .max(VIBEX_WEBSITE_MAX)
      .refine((v) => !v || /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s]*)?$/i.test(v), { message: "invalid_website" }),
    city: z.string().trim().max(VIBEX_CITY_MAX),
  })
  .partial();

export const VibexMediaQuerySchema = z.object({
  kind: z.enum(["photo", "video"]).default("photo"),
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

export interface VibexTranslationDto {
  text: string;
  /** Detected source language (null: the provider detected it). */
  source: string | null;
  target: string;
}

export interface VibexPage<T> {
  items: T[];
  next: string | null;
}

export const VibexPeopleQuerySchema = z.object({ q: z.string().trim().max(80).default("") });

export const VibexCursorQuerySchema = z.object({
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(VIBEX_PAGE),
});

export const VibexOpenChatSchema = z.object({ userId: z.string().uuid() });

/** Step 2.4 group chats. */
export const VIBEX_GROUP_TITLE_MAX = 64;
/** People in a group besides its creator. */
export const VIBEX_GROUP_MEMBERS_MAX = 49;
export const VibexCreateGroupSchema = z.object({
  title: z.string().trim().min(1).max(VIBEX_GROUP_TITLE_MAX),
  memberIds: z.array(z.string().uuid()).min(1).max(VIBEX_GROUP_MEMBERS_MAX),
  avatarFileId: z.string().uuid().optional(),
});
export const VibexUpdateGroupSchema = z.object({
  title: z.string().trim().min(1).max(VIBEX_GROUP_TITLE_MAX).optional(),
  /** null removes the picture. */
  avatarFileId: z.string().uuid().nullable().optional(),
});

export const VibexSendMessageSchema = z
  .object({
    text: z.string().max(VIBEX_MESSAGE_MAX).default(""),
    fileIds: z.array(z.string().uuid()).max(VIBEX_FILES_MAX).default([]),
    /** Step 2.3: voice message / video circle (exactly one recorded file). */
    kind: z.enum(["text", "voice", "circle"]).default("text"),
    durationMs: z.number().int().min(0).max(VIBEX_VOICE_MAX_MS).optional(),
    replyToId: z.string().uuid().optional(),
    /** Step 2.6: a Voidex Notes share link, shown as a .txt / .prsn file card. */
    notesToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  })
  .refine((m) => m.text.trim().length > 0 || m.fileIds.length > 0 || !!m.notesToken, { message: "Empty message", path: ["text"] })
  .refine((m) => m.kind === "text" || (m.fileIds.length === 1 && !m.text.trim()), { message: "A recording is one file", path: ["fileIds"] })
  .refine((m) => m.kind !== "circle" || (m.durationMs ?? 0) <= VIBEX_CIRCLE_MAX_MS, { message: "Too long", path: ["durationMs"] });

/** Step 2.5: posts the viewer saw (counted once per person). */
export const VibexViewsSchema = z.object({ postIds: z.array(z.string().uuid()).min(1).max(50) });

export const VibexPinsSchema = z.object({ conversationIds: z.array(z.string().uuid()).max(50) });

export const VibexCreatePostSchema = z
  .object({
    text: z.string().max(VIBEX_POST_MAX).default(""),
    mediaIds: z.array(z.string().uuid()).max(VIBEX_FILES_MAX).default([]),
  })
  .refine((p) => p.text.trim().length > 0 || p.mediaIds.length > 0, { message: "Empty post", path: ["text"] });

export const VibexShareSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(20),
  text: z.string().max(VIBEX_MESSAGE_MAX).default(""),
});

export const VibexUploadPurposeSchema = z.enum(["message", "post", "voice", "circle", "group"]);
export type VibexUploadPurpose = z.infer<typeof VibexUploadPurposeSchema>;

export const VibexHistoryQuerySchema = VibexCursorQuerySchema.extend({ kind: z.enum(["liked", "bookmarks"]) });

export const VibexCommentSchema = z.object({
  text: z.string().trim().min(1).max(VIBEX_COMMENT_MAX),
  /** Step 2.3: answer a comment (top-level or a reply); it lands in the top-level comment's thread. */
  replyToId: z.string().uuid().optional(),
});

export const VibexEditPostSchema = z.object({ text: z.string().max(VIBEX_POST_MAX) });

export const VibexReportSchema = z.object({ reason: z.enum(["spam", "abuse", "other"]).default("other") });

/** Retired in Step 2.3 (Vibex uses the VOIDEX session). Kept for API compatibility. */
export const VibexActivateSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(256),
});
