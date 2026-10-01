import { z } from "zod";

/**
 * Vibex — the messenger and social feed of VOIDEX. Same accounts, sessions and
 * sync as the rest of the OS; data lives on the VOIDEX server (PostgreSQL),
 * files in the shared blob storage.
 */

export const VIBEX_MESSAGE_MAX = 4000;
export const VIBEX_POST_MAX = 2000;
/** Files on one chat message / images on one post. */
export const VIBEX_FILES_MAX = 10;
export const VIBEX_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Post media: pictures only. */
export const VIBEX_POST_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
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
  /** Images get previews; everything else is a downloadable file. */
  kind: "image" | "file";
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
  /** Reposts: the original post, or null when it is no longer available. */
  repostOf?: VibexPostDto | null;
}

export interface VibexMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  mine: boolean;
  text: string;
  files: VibexFileDto[];
  /** A post shared into the chat (null: shared, but no longer available). */
  sharedPost?: VibexPostDto | null;
  createdAt: string;
}

export interface VibexChatDto {
  id: string;
  kind: "direct";
  peer: VibexPersonDto;
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

export interface VibexProfileDto {
  person: VibexPersonDto;
  posts: number;
  me: boolean;
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

export const VibexSendMessageSchema = z
  .object({
    text: z.string().max(VIBEX_MESSAGE_MAX).default(""),
    fileIds: z.array(z.string().uuid()).max(VIBEX_FILES_MAX).default([]),
  })
  .refine((m) => m.text.trim().length > 0 || m.fileIds.length > 0, { message: "Empty message", path: ["text"] });

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

export const VibexHistoryQuerySchema = VibexCursorQuerySchema.extend({ kind: z.enum(["liked", "bookmarks"]) });
