import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  DEFAULT_VIBEX_SETTINGS,
  ErrorCode,
  VIBEX_AUDIO_TYPES,
  VIBEX_CIRCLE_TYPES,
  VIBEX_FILES_MAX,
  VIBEX_FILE_MAX_BYTES,
  VIBEX_MEDIA_MAX_BYTES,
  VIBEX_POST_IMAGE_TYPES,
  VIBEX_POST_VIDEO_TYPES,
  VibexSettingsSchema,
  type VibexMediaItemDto,
  type VibexMessageKind,
  type VibexSettings,
  type VibexUploadPurpose,
  attachmentMimeType,
  sanitizeFilename,
  detectLanguage,
  type VibexChatDto,
  type VibexCommentDto,
  type VibexMeDto,
  type VibexTranslationDto,
  type VibexFileDto,
  type VibexHistoryItemDto,
  type VibexMessageDto,
  type VibexPage,
  type VibexPersonDto,
  type VibexPostDto,
  type VibexProfileDto,
} from "@voidex/shared";
import type { Db, Tx } from "../db/client.js";
import {
  mailAccounts,
  users,
  vibexBookmarks,
  vibexComments,
  vibexConversations,
  vibexFiles,
  vibexFollows,
  vibexHiddenPosts,
  vibexLikes,
  vibexMembers,
  vibexMessages,
  vibexPosts,
  vibexProfiles,
  vibexReports,
} from "../db/schema.js";
import { looksLike } from "../lib/file-types.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";
import type { NotificationService } from "./notifications.js";

type FileRow = typeof vibexFiles.$inferSelect;
type PostRow = typeof vibexPosts.$inferSelect;
type MessageRow = typeof vibexMessages.$inferSelect;

const IMAGE_PREVIEW = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_PREVIEW = new Set(VIBEX_POST_VIDEO_TYPES);
/** Uploaded but never sent files are removed after a day. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const at = new Date(iso!);
    if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? "")) return null;
    return { at, id: id! };
  } catch {
    return null;
  }
}
/** Rows strictly older than the cursor, newest first (ties broken by id). */
function olderThan(col: { createdAt: typeof vibexPosts.createdAt; id: typeof vibexPosts.id } | { createdAt: typeof vibexMessages.createdAt; id: typeof vibexMessages.id }, cursor: { at: Date; id: string } | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(lt(col.createdAt, cursor.at), and(eq(col.createdAt, cursor.at), lt(col.id, cursor.id)));
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const fileDto = (f: FileRow): VibexFileDto => ({
  id: f.id,
  filename: f.filename,
  mimeType: f.mimeType,
  size: f.sizeBytes,
  kind:
    f.purpose === "voice"
      ? "audio"
      : f.purpose === "circle"
        ? "video"
        : IMAGE_PREVIEW.has(f.mimeType)
          ? "image"
          : VIDEO_PREVIEW.has(f.mimeType)
            ? "video"
            : f.mimeType.startsWith("audio/")
              ? "audio"
              : "file",
});

/** Stored settings (any shape, older or partial) → complete settings with defaults. */
export function readSettings(raw: unknown): VibexSettings {
  const r = VibexSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_VIBEX_SETTINGS;
}

/** Allowed types and size per upload purpose. */
const UPLOAD_RULES: Record<VibexUploadPurpose, { types: string[] | null; max: number }> = {
  message: { types: null, max: VIBEX_FILE_MAX_BYTES },
  post: { types: [...VIBEX_POST_IMAGE_TYPES, ...VIBEX_POST_VIDEO_TYPES], max: VIBEX_MEDIA_MAX_BYTES },
  voice: { types: VIBEX_AUDIO_TYPES, max: VIBEX_MEDIA_MAX_BYTES },
  circle: { types: VIBEX_CIRCLE_TYPES, max: VIBEX_MEDIA_MAX_BYTES },
};
const PURPOSE_OF_KIND: Record<VibexMessageKind, VibexUploadPurpose> = { text: "message", voice: "voice", circle: "circle" };

/**
 * Vibex — chats and the social feed. Every call is scoped to the signed-in
 * user: you only read conversations you are a member of, only change your own
 * posts, likes, bookmarks and pins.
 */
export class VibexService {
  constructor(
    private readonly ctx: Ctx,
    private readonly notifications?: NotificationService,
  ) {}

  /** Translations cache: post id + edit time + target → text (bounded). */
  private readonly translations = new Map<string, VibexTranslationDto>();

  // ---------------------------------------------------------------- profile

  /**
   * One VOIDEX account = one Vibex profile (Step 2.3): the profile is created
   * the first time the account uses Vibex — no separate sign-in or identity.
   */
  async ensureProfile(userId: string) {
    await this.ctx.db.insert(vibexProfiles).values({ userId }).onConflictDoNothing();
  }

  /** Kept for older callers: every VOIDEX account can use Vibex. */
  async isActivated(userId: string): Promise<boolean> {
    await this.ensureProfile(userId);
    return true;
  }

  async me(userId: string): Promise<VibexMeDto> {
    await this.ensureProfile(userId);
    return { activated: true, person: await this.person(userId), settings: await this.settings(userId) };
  }

  /** Retired activation (Step 2.2 sign-in screen): now simply ensures the profile. */
  async activate(userId: string): Promise<VibexMeDto> {
    return this.me(userId);
  }

  private async settingsOf(ids: string[]): Promise<Map<string, VibexSettings>> {
    const unique = [...new Set(ids)];
    const rows = unique.length ? await this.ctx.db.select({ id: vibexProfiles.userId, settings: vibexProfiles.settings }).from(vibexProfiles).where(inArray(vibexProfiles.userId, unique)) : [];
    const map = new Map(rows.map((r) => [r.id, readSettings(r.settings)]));
    for (const id of unique) if (!map.has(id)) map.set(id, DEFAULT_VIBEX_SETTINGS);
    return map;
  }

  async settings(userId: string): Promise<VibexSettings> {
    return (await this.settingsOf([userId])).get(userId)!;
  }

  async updateSettings(userId: string, patch: { privacy?: Partial<VibexSettings["privacy"]>; notifications?: Partial<VibexSettings["notifications"]>; media?: Partial<VibexSettings["media"]> }): Promise<VibexSettings> {
    await this.ensureProfile(userId);
    const cur = await this.settings(userId);
    const next = readSettings({
      privacy: { ...cur.privacy, ...patch.privacy },
      notifications: { ...cur.notifications, ...patch.notifications },
      media: { ...cur.media, ...patch.media },
    });
    next.privacy.blocked = [...new Set(next.privacy.blocked.filter((id) => id !== userId))];
    await this.ctx.db.update(vibexProfiles).set({ settings: next }).where(eq(vibexProfiles.userId, userId));
    this.ctx.events.toUser(userId, { type: "vibex.profile", userId });
    return next;
  }

  /** Bio, site, city (names belong to the VOIDEX account and are changed there). */
  async updateProfile(userId: string, input: { bio?: string; website?: string; city?: string }) {
    await this.ensureProfile(userId);
    const patch: Partial<typeof vibexProfiles.$inferInsert> = {};
    if (input.bio !== undefined) patch.bio = input.bio.trim();
    if (input.website !== undefined) patch.website = input.website.trim();
    if (input.city !== undefined) patch.city = input.city.trim();
    if (Object.keys(patch).length) await this.ctx.db.update(vibexProfiles).set(patch).where(eq(vibexProfiles.userId, userId));
    this.profileChanged(userId);
    return this.profile(userId, userId);
  }

  async setCover(userId: string, mimeType: string, data: Buffer) {
    await this.ensureProfile(userId);
    const [cur] = await this.ctx.db.select().from(vibexProfiles).where(eq(vibexProfiles.userId, userId));
    await this.ctx.db.transaction(async (tx) => {
      const key = await this.ctx.blobs.put({ ownerUserId: userId, purpose: "vibex", mimeType, data }, tx);
      await tx
        .update(vibexProfiles)
        .set({ coverKey: key, coverMime: mimeType, coverVersion: (cur?.coverVersion ?? 0) + 1 })
        .where(eq(vibexProfiles.userId, userId));
      if (cur?.coverKey) await this.ctx.blobs.delete([cur.coverKey], tx);
    });
    this.profileChanged(userId);
    return this.profile(userId, userId);
  }

  async deleteCover(userId: string) {
    const [cur] = await this.ctx.db.select().from(vibexProfiles).where(eq(vibexProfiles.userId, userId));
    if (cur?.coverKey) {
      await this.ctx.db.update(vibexProfiles).set({ coverKey: null, coverMime: null, coverVersion: 0 }).where(eq(vibexProfiles.userId, userId));
      await this.ctx.blobs.delete([cur.coverKey]);
    }
    this.profileChanged(userId);
    return this.profile(userId, userId);
  }

  /** A profile cover, for whoever may see that profile's details. */
  async cover(viewerId: string, userId: string) {
    const [p] = await this.ctx.db.select().from(vibexProfiles).where(eq(vibexProfiles.userId, userId));
    if (!p?.coverKey || !(await this.canSee(viewerId, userId, "profile"))) throw notFound("Cover");
    const blob = await this.ctx.blobs.get(p.coverKey);
    if (!blob) throw notFound("Cover");
    return { mimeType: p.coverMime ?? blob.mimeType, data: blob.data };
  }

  private profileChanged(userId: string) {
    this.ctx.events.toAll({ type: "vibex.profile", userId });
  }

  // ---------------------------------------------------------------- privacy

  private async follows(followerId: string, followeeId: string): Promise<boolean> {
    const [f] = await this.ctx.db
      .select({ id: vibexFollows.followerId })
      .from(vibexFollows)
      .where(and(eq(vibexFollows.followerId, followerId), eq(vibexFollows.followeeId, followeeId)));
    return !!f;
  }

  /** Privacy: may the viewer see this person's profile details / posts? */
  private async canSee(viewerId: string, ownerId: string, what: "profile" | "posts", settings?: VibexSettings): Promise<boolean> {
    if (viewerId === ownerId) return true;
    const s = settings ?? (await this.settings(ownerId));
    if (s.privacy.blocked.includes(viewerId)) return false;
    return s.privacy[what] === "everyone" || (await this.follows(viewerId, ownerId));
  }

  /** Privacy: may `senderId` write to `recipientId`? */
  async canMessage(senderId: string, recipientId: string, settings?: VibexSettings): Promise<boolean> {
    if (senderId === recipientId) return false;
    const s = settings ?? (await this.settings(recipientId));
    if (s.privacy.blocked.includes(senderId)) return false;
    if (s.privacy.messages === "nobody") return false;
    if (s.privacy.messages === "followers") return this.follows(senderId, recipientId);
    return true;
  }

  /** SQL: posts whose author lets this viewer see them (privacy "followers" needs a follow). */
  private visiblePosts(viewerId: string): SQL {
    return sql`(${vibexPosts.authorId} = ${viewerId}::uuid OR NOT EXISTS (
      SELECT 1 FROM vibex_profiles vp WHERE vp.user_id = ${vibexPosts.authorId} AND (
        (vp.settings -> 'privacy' -> 'blocked') ? ${viewerId}
        OR (vp.settings -> 'privacy' ->> 'posts' = 'followers' AND NOT EXISTS (
          SELECT 1 FROM vibex_follows vf WHERE vf.follower_id = ${viewerId}::uuid AND vf.followee_id = ${vibexPosts.authorId}))
      )))`;
  }

  // ---------------------------------------------------------------- follows

  async follow(userId: string, otherId: string, on: boolean): Promise<VibexProfileDto> {
    if (otherId === userId) throw fail(ErrorCode.ValidationFailed, "You can't follow yourself.");
    const [other] = await this.ctx.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, otherId));
    if (!other || other.status !== "active") throw notFound("User");
    await this.ensureProfile(userId);
    if (on) {
      const s = await this.settings(otherId);
      if (s.privacy.blocked.includes(userId)) throw notFound("User");
      const added = await this.ctx.db.insert(vibexFollows).values({ followerId: userId, followeeId: otherId }).onConflictDoNothing().returning();
      if (added.length && s.notifications.follows) {
        const me = await this.person(userId);
        await this.notifications?.tryNotify({ userId: otherId, app: "vibex", type: "vibex.follow", title: me.name, body: "", actorId: userId, target: { userId } });
      }
    } else {
      await this.ctx.db.delete(vibexFollows).where(and(eq(vibexFollows.followerId, userId), eq(vibexFollows.followeeId, otherId)));
    }
    this.ctx.events.toUser(otherId, { type: "vibex.profile", userId: otherId });
    this.ctx.events.toUser(userId, { type: "vibex.profile", userId: otherId });
    return this.profile(userId, otherId);
  }

  /** Followers / following of a person (names only, newest first). */
  async followList(viewerId: string, userId: string, which: "followers" | "following"): Promise<VibexPersonDto[]> {
    if (!(await this.canSee(viewerId, userId, "profile"))) return [];
    const rows = await this.ctx.db
      .select({ id: which === "followers" ? vibexFollows.followerId : vibexFollows.followeeId })
      .from(vibexFollows)
      .where(eq(which === "followers" ? vibexFollows.followeeId : vibexFollows.followerId, userId))
      .orderBy(desc(vibexFollows.createdAt))
      .limit(500);
    const map = await this.persons(rows.map((r) => r.id));
    return rows.map((r) => map.get(r.id)!).filter(Boolean);
  }

  // ------------------------------------------------------------------ people

  private async persons(ids: string[], db: Db | Tx = this.ctx.db): Promise<Map<string, VibexPersonDto>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db
      .select({ u: users, address: mailAccounts.address, local: mailAccounts.localPart })
      .from(users)
      .leftJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
      .where(inArray(users.id, unique));
    return new Map(
      rows.map((r) => [
        r.u.id,
        {
          id: r.u.id,
          firstName: r.u.firstName,
          lastName: r.u.lastName,
          name: `${r.u.firstName} ${r.u.lastName}`.trim(),
          handle: r.local ?? "",
          address: r.address ?? "",
          avatarVersion: r.u.avatarVersion,
        },
      ]),
    );
  }

  private async person(id: string): Promise<VibexPersonDto> {
    const p = (await this.persons([id])).get(id);
    if (!p) throw notFound("User");
    return p;
  }

  /** People search by name or @handle (other active VOIDEX users). */
  async people(viewerId: string, q: string): Promise<VibexPersonDto[]> {
    const query = q.replace(/^@/, "").trim();
    if (!query) return [];
    const like = `%${escapeLike(query)}%`;
    const prefix = `${escapeLike(query)}%`;
    const rows = await this.ctx.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(mailAccounts, and(eq(mailAccounts.userId, users.id), eq(mailAccounts.isPrimary, true)))
      // Every VOIDEX account has a Vibex profile (one identity).
      .where(
        and(
          ne(users.id, viewerId),
          eq(users.status, "active"),
          or(
            ilike(users.firstName, prefix),
            ilike(users.lastName, prefix),
            ilike(mailAccounts.localPart, prefix),
            ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, like),
            ilike(mailAccounts.address, `${escapeLike(query.toLowerCase())}%`),
          ),
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName))
      .limit(20);
    const map = await this.persons(rows.map((r) => r.id));
    return rows.map((r) => map.get(r.id)!).filter(Boolean);
  }

  async profile(viewerId: string, userId: string): Promise<VibexProfileDto> {
    const person = await this.person(userId);
    const settings = await this.settings(userId);
    const [[{ n }], [p], [{ followers }], [{ following }], followed, followsMe] = (await Promise.all([
      this.ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(vibexPosts)
        .where(and(eq(vibexPosts.authorId, userId), isNull(vibexPosts.deletedAt))),
      this.ctx.db.select().from(vibexProfiles).where(eq(vibexProfiles.userId, userId)),
      this.ctx.db.select({ followers: sql<number>`count(*)::int` }).from(vibexFollows).where(eq(vibexFollows.followeeId, userId)),
      this.ctx.db.select({ following: sql<number>`count(*)::int` }).from(vibexFollows).where(eq(vibexFollows.followerId, userId)),
      viewerId === userId ? Promise.resolve(false) : this.follows(viewerId, userId),
      viewerId === userId ? Promise.resolve(false) : this.follows(userId, viewerId),
    ])) as [[{ n: number }], [typeof vibexProfiles.$inferSelect | undefined], [{ followers: number }], [{ following: number }], boolean, boolean];
    const visible = await this.canSee(viewerId, userId, "profile", settings);
    const postsVisible = await this.canSee(viewerId, userId, "posts", settings);
    return {
      person,
      posts: postsVisible ? n : 0,
      me: userId === viewerId,
      bio: visible ? (p?.bio ?? "") : "",
      website: visible ? (p?.website ?? "") : "",
      city: visible ? (p?.city ?? "") : "",
      coverVersion: visible && p?.coverKey ? p.coverVersion : 0,
      followers,
      following,
      followed,
      followsMe,
      visible: visible && postsVisible,
      canMessage: viewerId !== userId && (await this.canMessage(viewerId, userId, settings)),
    };
  }

  /** Pictures / videos of a person's posts, newest first (profile "Photo / Video"). */
  async media(viewerId: string, userId: string, kind: "photo" | "video", cursor?: string, limit = 60): Promise<VibexPage<VibexMediaItemDto>> {
    if (!(await this.canSee(viewerId, userId, "posts"))) return { items: [], next: null };
    const c = decodeCursor(cursor);
    const types = kind === "photo" ? VIBEX_POST_IMAGE_TYPES : VIBEX_POST_VIDEO_TYPES;
    const rows = await this.ctx.db
      .select({ f: vibexFiles, at: vibexPosts.createdAt })
      .from(vibexFiles)
      .innerJoin(vibexPosts, eq(vibexPosts.id, vibexFiles.postId))
      .where(
        and(
          eq(vibexPosts.authorId, userId),
          isNull(vibexPosts.deletedAt),
          inArray(vibexFiles.mimeType, types),
          c ? or(lt(vibexPosts.createdAt, c.at), and(eq(vibexPosts.createdAt, c.at), lt(vibexFiles.id, c.id))) : undefined,
        ),
      )
      .orderBy(desc(vibexPosts.createdAt), desc(vibexFiles.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items: items.map((r) => ({ file: fileDto(r.f), postId: r.f.postId!, createdAt: r.at.toISOString() })),
      next: more ? encodeCursor(items.at(-1)!.at, items.at(-1)!.f.id) : null,
    };
  }

  // ------------------------------------------------------------------- files

  /** Upload before sending: a chat file or a post picture, visible only to its owner until sent. */
  async upload(ownerId: string, purpose: VibexUploadPurpose, input: { filename: string; data: Buffer }): Promise<VibexFileDto> {
    const filename = sanitizeFilename(input.filename);
    const mimeType = attachmentMimeType(filename);
    const rule = UPLOAD_RULES[purpose];
    if (!mimeType || (rule.types && !rule.types.includes(mimeType))) {
      throw fail(ErrorCode.AttachmentTypeNotAllowed, "This type of file can't be attached.", { status: 415, details: { filename } });
    }
    if (!input.data.length) throw fail(ErrorCode.ValidationFailed, "The file is empty.");
    if (input.data.length > rule.max) {
      throw fail(ErrorCode.AttachmentTooLarge, "The file is too large.", { status: 413, details: { maxBytes: rule.max } });
    }
    if (!looksLike(mimeType, input.data)) {
      throw fail(ErrorCode.AttachmentTypeNotAllowed, "The file content does not match its type.", { status: 415, details: { filename } });
    }
    const now = this.ctx.now();
    return this.ctx.db.transaction(async (tx) => {
      // Housekeeping: drop this person's files that were uploaded and never sent.
      const stale = await tx
        .delete(vibexFiles)
        .where(
          and(
            eq(vibexFiles.ownerId, ownerId),
            isNull(vibexFiles.messageId),
            isNull(vibexFiles.postId),
            lt(vibexFiles.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
          ),
        )
        .returning({ key: vibexFiles.storageKey });
      await this.ctx.blobs.delete(stale.map((s) => s.key), tx);
      const key = await this.ctx.blobs.put({ ownerUserId: ownerId, purpose: "vibex", mimeType, data: input.data }, tx);
      const [row] = await tx.insert(vibexFiles).values({ ownerId, purpose, filename, mimeType, sizeBytes: input.data.length, storageKey: key }).returning();
      return fileDto(row!);
    });
  }

  async discardUpload(ownerId: string, fileId: string) {
    const [row] = await this.ctx.db
      .delete(vibexFiles)
      .where(and(eq(vibexFiles.id, fileId), eq(vibexFiles.ownerId, ownerId), isNull(vibexFiles.messageId), isNull(vibexFiles.postId)))
      .returning();
    if (!row) throw notFound("File");
    await this.ctx.blobs.delete([row.storageKey]);
    return { ok: true };
  }

  /** Download: chat files for members of that chat, post pictures for any signed-in user. */
  async file(viewerId: string, fileId: string) {
    const [row] = await this.ctx.db.select().from(vibexFiles).where(eq(vibexFiles.id, fileId));
    if (!row) throw notFound("File");
    let allowed = false;
    if (row.messageId) {
      const [m] = await this.ctx.db
        .select({ id: vibexMembers.userId })
        .from(vibexMessages)
        .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexMessages.conversationId), eq(vibexMembers.userId, viewerId)))
        .where(eq(vibexMessages.id, row.messageId));
      allowed = !!m;
    } else if (row.postId) {
      const [p] = await this.ctx.db.select().from(vibexPosts).where(eq(vibexPosts.id, row.postId));
      allowed = !!p && (p.authorId === viewerId || (!p.deletedAt && (await this.canSee(viewerId, p.authorId, "posts"))));
    } else {
      allowed = row.ownerId === viewerId;
    }
    if (!allowed) throw notFound("File");
    const blob = await this.ctx.blobs.get(row.storageKey);
    if (!blob) throw notFound("File");
    return { filename: row.filename, mimeType: row.mimeType, data: blob.data };
  }

  /** Claims uploaded files for a message / post (owner, purpose and "not yet sent" are enforced). */
  private async claimFiles(tx: Tx, ownerId: string, purpose: VibexUploadPurpose, ids: string[], target: { messageId: string } | { postId: string }) {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    if (unique.length > VIBEX_FILES_MAX) throw fail(ErrorCode.AttachmentLimit, "Too many files.", { status: 422, details: { max: VIBEX_FILES_MAX } });
    const rows = await tx
      .select()
      .from(vibexFiles)
      .where(and(inArray(vibexFiles.id, unique), eq(vibexFiles.ownerId, ownerId), eq(vibexFiles.purpose, purpose), isNull(vibexFiles.messageId), isNull(vibexFiles.postId)));
    if (rows.length !== unique.length) throw notFound("File");
    for (const [i, id] of unique.entries()) {
      await tx
        .update(vibexFiles)
        .set({ ...target, position: i })
        .where(eq(vibexFiles.id, id));
    }
  }

  private async filesOf(column: "messageId" | "postId", ids: string[]): Promise<Map<string, VibexFileDto[]>> {
    const map = new Map<string, VibexFileDto[]>();
    if (!ids.length) return map;
    const col = column === "messageId" ? vibexFiles.messageId : vibexFiles.postId;
    const rows = await this.ctx.db.select().from(vibexFiles).where(inArray(col, ids)).orderBy(asc(vibexFiles.position));
    for (const r of rows) {
      const key = (column === "messageId" ? r.messageId : r.postId)!;
      map.set(key, [...(map.get(key) ?? []), fileDto(r)]);
    }
    return map;
  }

  // ------------------------------------------------------------------- posts

  /** Builds post DTOs as seen by `viewerId` (counts, my like / bookmark / repost, originals of reposts). */
  private async postDtos(viewerId: string, rows: PostRow[]): Promise<Map<string, VibexPostDto>> {
    const out = new Map<string, VibexPostDto>();
    if (!rows.length) return out;
    // Originals of reposts (they may be deleted → "unavailable").
    const originalIds = [...new Set(rows.filter((r) => r.kind === "repost" && r.repostOfId).map((r) => r.repostOfId!))].filter((id) => !rows.some((r) => r.id === id));
    const originals = originalIds.length ? await this.ctx.db.select().from(vibexPosts).where(inArray(vibexPosts.id, originalIds)) : [];
    const all = [...rows, ...originals];
    const ids = all.map((r) => r.id);
    const [people, media, likeCounts, repostCounts, myLikes, myMarks, myReposts, commentCounts] = await Promise.all([
      this.persons(all.map((r) => r.authorId)),
      this.filesOf("postId", ids),
      this.ctx.db
        .select({ id: vibexLikes.postId, n: sql<number>`count(*)::int` })
        .from(vibexLikes)
        .where(inArray(vibexLikes.postId, ids))
        .groupBy(vibexLikes.postId),
      this.ctx.db
        .select({ id: vibexPosts.repostOfId, n: sql<number>`count(*)::int` })
        .from(vibexPosts)
        .where(and(inArray(vibexPosts.repostOfId, ids), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)))
        .groupBy(vibexPosts.repostOfId),
      this.ctx.db.select({ id: vibexLikes.postId }).from(vibexLikes).where(and(inArray(vibexLikes.postId, ids), eq(vibexLikes.userId, viewerId))),
      this.ctx.db.select({ id: vibexBookmarks.postId }).from(vibexBookmarks).where(and(inArray(vibexBookmarks.postId, ids), eq(vibexBookmarks.userId, viewerId))),
      this.ctx.db
        .select({ id: vibexPosts.repostOfId })
        .from(vibexPosts)
        .where(and(inArray(vibexPosts.repostOfId, ids), eq(vibexPosts.authorId, viewerId), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt))),
      this.ctx.db
        .select({ id: vibexComments.postId, n: sql<number>`count(*)::int` })
        .from(vibexComments)
        .where(and(inArray(vibexComments.postId, ids), isNull(vibexComments.deletedAt)))
        .groupBy(vibexComments.postId),
    ]);
    const comments = new Map(commentCounts.map((r) => [r.id, r.n]));
    const likes = new Map(likeCounts.map((r) => [r.id, r.n]));
    const reposts = new Map(repostCounts.map((r) => [r.id!, r.n]));
    const liked = new Set(myLikes.map((r) => r.id));
    const marked = new Set(myMarks.map((r) => r.id));
    const reposted = new Set(myReposts.map((r) => r.id!));
    const base = (r: PostRow): VibexPostDto => ({
      id: r.id,
      kind: r.kind,
      author: people.get(r.authorId)!,
      text: r.text,
      media: media.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
      likes: likes.get(r.id) ?? 0,
      reposts: reposts.get(r.id) ?? 0,
      liked: liked.has(r.id),
      bookmarked: marked.has(r.id),
      reposted: reposted.has(r.id),
      mine: r.authorId === viewerId,
      comments: comments.get(r.id) ?? 0,
      editedAt: r.editedAt?.toISOString() ?? null,
    });
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const r of rows) {
      const dto = base(r);
      if (r.kind === "repost") {
        const orig = r.repostOfId ? byId.get(r.repostOfId) : undefined;
        dto.repostOf = orig && !orig.deletedAt ? base(orig) : null;
      }
      out.set(r.id, dto);
    }
    return out;
  }

  private async page(viewerId: string, where: SQL | undefined, cursor: string | undefined, limit: number): Promise<VibexPage<VibexPostDto>> {
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexPosts)
      .where(and(isNull(vibexPosts.deletedAt), where, this.visiblePosts(viewerId), olderThan(vibexPosts, c)))
      .orderBy(desc(vibexPosts.createdAt), desc(vibexPosts.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.postDtos(viewerId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  /** Everyone's posts and reposts, newest first — minus what I marked "not interested". */
  feed(viewerId: string, cursor?: string, limit = 30) {
    const hidden = this.ctx.db.select({ id: vibexHiddenPosts.postId }).from(vibexHiddenPosts).where(eq(vibexHiddenPosts.userId, viewerId));
    return this.page(
      viewerId,
      and(
        sql`${vibexPosts.id} NOT IN (${hidden})`,
        or(isNull(vibexPosts.repostOfId), sql`${vibexPosts.repostOfId} NOT IN (${hidden})`),
      ),
      cursor,
      limit,
    );
  }

  personPosts(viewerId: string, userId: string, cursor?: string, limit = 30) {
    return this.page(viewerId, eq(vibexPosts.authorId, userId), cursor, limit);
  }

  private async livePost(id: string, db: Db | Tx = this.ctx.db): Promise<PostRow> {
    const [row] = await db.select().from(vibexPosts).where(and(eq(vibexPosts.id, id), isNull(vibexPosts.deletedAt)));
    if (!row) throw notFound("Post");
    return row;
  }

  async post(viewerId: string, id: string): Promise<VibexPostDto> {
    const row = await this.livePost(id);
    if (!(await this.canSee(viewerId, row.authorId, "posts"))) throw notFound("Post");
    return (await this.postDtos(viewerId, [row])).get(row.id)!;
  }

  async createPost(authorId: string, input: { text: string; mediaIds: string[] }): Promise<VibexPostDto> {
    const row = await this.ctx.db.transaction(async (tx) => {
      const [p] = await tx.insert(vibexPosts).values({ authorId, kind: "post", text: input.text.trim() }).returning();
      await this.claimFiles(tx, authorId, "post", input.mediaIds, { postId: p!.id });
      return p!;
    });
    this.feedChanged(row.id);
    return this.post(authorId, row.id);
  }

  /** The author edits the text of their post (not of a repost). */
  async editPost(authorId: string, id: string, text: string): Promise<VibexPostDto> {
    const [row] = await this.ctx.db
      .update(vibexPosts)
      .set({ text: text.trim(), editedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.id, id), eq(vibexPosts.authorId, authorId), eq(vibexPosts.kind, "post"), isNull(vibexPosts.deletedAt)))
      .returning();
    if (!row) throw notFound("Post");
    const media = await this.filesOf("postId", [row.id]);
    if (!row.text && !(media.get(row.id)?.length ?? 0)) throw fail(ErrorCode.ValidationFailed, "Empty post", { fields: { text: "required" } });
    this.feedChanged(row.id);
    return this.post(authorId, row.id);
  }

  /** "Not interested": the post (and reposts of it) leave my feed. */
  async hidePost(userId: string, id: string) {
    const post = await this.target(id);
    if (post.authorId === userId) throw fail(ErrorCode.ValidationFailed, "You can't hide your own post.");
    await this.ctx.db.insert(vibexHiddenPosts).values({ userId, postId: post.id }).onConflictDoNothing();
    return { ok: true };
  }

  /** A report for moderation (one per person per post). */
  async report(userId: string, id: string, reason: "spam" | "abuse" | "other") {
    const post = await this.target(id);
    if (post.authorId === userId) throw fail(ErrorCode.ValidationFailed, "You can't report your own post.");
    await this.ctx.db.insert(vibexReports).values({ reporterId: userId, postId: post.id, reason }).onConflictDoNothing();
    return { ok: true };
  }

  // --------------------------------------------------------------- comments

  /**
   * Comments of a post, oldest first: top-level comments and their replies
   * (TikTok-style threads — every reply belongs to one top-level comment and
   * names whom it answers; there is no deeper nesting).
   */
  async comments(viewerId: string, postId: string): Promise<VibexCommentDto[]> {
    const post = await this.target(postId);
    if (!(await this.canSee(viewerId, post.authorId, "posts"))) throw notFound("Post");
    const rows = await this.ctx.db
      .select()
      .from(vibexComments)
      .where(and(eq(vibexComments.postId, post.id), isNull(vibexComments.deletedAt)))
      .orderBy(asc(vibexComments.createdAt), asc(vibexComments.id))
      .limit(1000);
    const live = new Set(rows.map((r) => r.id));
    // Replies whose top-level comment was removed disappear with it.
    const visible = rows.filter((r) => !r.rootId || live.has(r.rootId));
    const replies = new Map<string, number>();
    for (const r of visible) if (r.rootId) replies.set(r.rootId, (replies.get(r.rootId) ?? 0) + 1);
    const people = await this.persons([...visible.map((r) => r.authorId), ...visible.map((r) => r.replyToUserId).filter((x): x is string => !!x)]);
    return visible.map((r) => this.commentDto(r, viewerId, people, replies.get(r.id) ?? 0));
  }

  private commentDto(r: typeof vibexComments.$inferSelect, viewerId: string, people: Map<string, VibexPersonDto>, replies: number): VibexCommentDto {
    const to = r.replyToUserId ? people.get(r.replyToUserId) : undefined;
    return {
      id: r.id,
      postId: r.postId,
      author: people.get(r.authorId)!,
      text: r.text,
      createdAt: r.createdAt.toISOString(),
      mine: r.authorId === viewerId,
      rootId: r.rootId,
      replyTo: r.rootId && to ? { commentId: r.replyToId, person: to } : null,
      replies,
    };
  }

  async addComment(authorId: string, postId: string, text: string, replyToId?: string): Promise<VibexCommentDto> {
    const post = await this.target(postId);
    if (!(await this.canSee(authorId, post.authorId, "posts"))) throw notFound("Post");
    let parent: typeof vibexComments.$inferSelect | undefined;
    if (replyToId) {
      [parent] = await this.ctx.db
        .select()
        .from(vibexComments)
        .where(and(eq(vibexComments.id, replyToId), eq(vibexComments.postId, post.id), isNull(vibexComments.deletedAt)));
      if (!parent) throw notFound("Comment");
    }
    const [row] = await this.ctx.db
      .insert(vibexComments)
      .values({
        postId: post.id,
        authorId,
        text: text.trim(),
        rootId: parent ? (parent.rootId ?? parent.id) : null,
        replyToId: parent?.id ?? null,
        replyToUserId: parent?.authorId ?? null,
      })
      .returning();
    this.feedChanged(post.id);
    const people = await this.persons([authorId, ...(parent ? [parent.authorId] : [])]);
    const me = people.get(authorId)!;
    // Notifications: a reply → the person answered; a comment → the post's author.
    const recipient = parent ? parent.authorId : post.authorId;
    if (recipient !== authorId && (await this.settings(recipient)).notifications.comments) {
      await this.notifications?.tryNotify({
        userId: recipient,
        app: "vibex",
        type: parent ? "vibex.reply" : "vibex.comment",
        title: me.name,
        body: row!.text.slice(0, 200),
        actorId: authorId,
        target: { postId: post.id, commentId: row!.id },
      });
    }
    return this.commentDto(row!, authorId, people, 0);
  }

  /** The comment's author or the post's author removes a comment. */
  async deleteComment(userId: string, commentId: string) {
    const [c] = await this.ctx.db.select().from(vibexComments).where(and(eq(vibexComments.id, commentId), isNull(vibexComments.deletedAt)));
    if (!c) throw notFound("Comment");
    const [p] = await this.ctx.db.select({ authorId: vibexPosts.authorId }).from(vibexPosts).where(eq(vibexPosts.id, c.postId));
    if (c.authorId !== userId && p?.authorId !== userId) throw notFound("Comment");
    await this.ctx.db.update(vibexComments).set({ deletedAt: this.ctx.now() }).where(eq(vibexComments.id, commentId));
    this.feedChanged(c.postId);
    return { ok: true };
  }

  // ------------------------------------------------------------- translation

  /** Translates a post the reader can see into their language. */
  async translate(viewerId: string, postId: string): Promise<VibexTranslationDto> {
    const post = await this.target(postId);
    const [viewer] = await this.ctx.db.select({ language: users.language }).from(users).where(eq(users.id, viewerId));
    const target = viewer?.language ?? "en";
    if (!post.text.trim()) throw fail(ErrorCode.ValidationFailed, "Nothing to translate.");
    const key = `${post.id}|${post.editedAt?.getTime() ?? 0}|${target}`;
    const cached = this.translations.get(key);
    if (cached) return cached;
    const source = detectLanguage(post.text);
    if (source === target) return { text: post.text, source, target };
    const text = await this.ctx.translator.translate(post.text, source, target);
    const dto = { text, source, target };
    if (this.translations.size > 2000) this.translations.delete(this.translations.keys().next().value!);
    this.translations.set(key, dto);
    return dto;
  }

  /** Feed-wide change (new post, edit, comment, delete): every signed-in Vibex refreshes. */
  private feedChanged(postId?: string) {
    this.ctx.events.toAll({ type: "vibex.feed", ...(postId ? { postId } : {}) });
  }

  async deletePost(authorId: string, id: string) {
    const [row] = await this.ctx.db
      .update(vibexPosts)
      .set({ deletedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.id, id), eq(vibexPosts.authorId, authorId), isNull(vibexPosts.deletedAt)))
      .returning();
    if (!row) throw notFound("Post");
    this.feedChanged(row.id);
    return { ok: true };
  }

  /** Likes and bookmarks always apply to the original post, never to a repost wrapper. */
  private async target(id: string) {
    const row = await this.livePost(id);
    if (row.kind === "repost") {
      if (!row.repostOfId) throw notFound("Post");
      return this.livePost(row.repostOfId);
    }
    return row;
  }

  async like(userId: string, id: string, on: boolean) {
    const post = await this.target(id);
    if (on) {
      const added = await this.ctx.db.insert(vibexLikes).values({ postId: post.id, userId }).onConflictDoNothing().returning();
      if (added.length && post.authorId !== userId && (await this.settings(post.authorId)).notifications.likes) {
        const me = await this.person(userId);
        await this.notifications?.tryNotify({ userId: post.authorId, app: "vibex", type: "vibex.like", title: me.name, body: post.text.slice(0, 140), actorId: userId, target: { postId: post.id } });
      }
    } else await this.ctx.db.delete(vibexLikes).where(and(eq(vibexLikes.postId, post.id), eq(vibexLikes.userId, userId)));
    this.feedChanged(post.id);
    return this.post(userId, post.id);
  }

  async bookmark(userId: string, id: string, on: boolean) {
    const post = await this.target(id);
    if (on) await this.ctx.db.insert(vibexBookmarks).values({ postId: post.id, userId }).onConflictDoNothing();
    else await this.ctx.db.delete(vibexBookmarks).where(and(eq(vibexBookmarks.postId, post.id), eq(vibexBookmarks.userId, userId)));
    return this.post(userId, post.id);
  }

  /** "Share on my page": a repost that points at the original (one per person). */
  async repost(userId: string, id: string): Promise<VibexPostDto> {
    const original = await this.target(id);
    await this.ctx.db.insert(vibexPosts).values({ authorId: userId, kind: "repost", repostOfId: original.id }).onConflictDoNothing();
    this.feedChanged(original.id);
    const [mine] = await this.ctx.db
      .select()
      .from(vibexPosts)
      .where(and(eq(vibexPosts.authorId, userId), eq(vibexPosts.repostOfId, original.id), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)));
    return (await this.postDtos(userId, [mine!])).get(mine!.id)!;
  }

  async unrepost(userId: string, id: string) {
    const original = await this.target(id);
    await this.ctx.db
      .update(vibexPosts)
      .set({ deletedAt: this.ctx.now() })
      .where(and(eq(vibexPosts.authorId, userId), eq(vibexPosts.repostOfId, original.id), eq(vibexPosts.kind, "repost"), isNull(vibexPosts.deletedAt)));
    this.feedChanged(original.id);
    return this.post(userId, original.id);
  }

  /** Liked or bookmarked posts, most recent first; deleted ones stay as "unavailable". */
  async history(userId: string, kind: "liked" | "bookmarks", cursor?: string, limit = 30): Promise<VibexPage<VibexHistoryItemDto>> {
    const table = kind === "liked" ? vibexLikes : vibexBookmarks;
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select({ postId: table.postId, at: table.createdAt })
      .from(table)
      .where(and(eq(table.userId, userId), c ? or(lt(table.createdAt, c.at), and(eq(table.createdAt, c.at), lt(table.postId, c.id))) : undefined))
      .orderBy(desc(table.createdAt), desc(table.postId))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const posts = items.length ? await this.ctx.db.select().from(vibexPosts).where(inArray(vibexPosts.id, items.map((r) => r.postId))) : [];
    const dtos = await this.postDtos(userId, posts.filter((p) => !p.deletedAt));
    return {
      items: items.map((r) => ({ postId: r.postId, at: r.at.toISOString(), post: dtos.get(r.postId) ?? null })),
      next: more ? encodeCursor(items.at(-1)!.at, items.at(-1)!.postId) : null,
    };
  }

  // ------------------------------------------------------------------- chats

  private async membership(userId: string, conversationId: string, db: Db | Tx = this.ctx.db) {
    const [m] = await db
      .select()
      .from(vibexMembers)
      .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
    if (!m) throw notFound("Chat");
    return m;
  }

  /** The direct chat with someone, created on first use. */
  async openDirect(userId: string, otherId: string): Promise<VibexChatDto> {
    if (otherId === userId) throw fail(ErrorCode.ValidationFailed, "You can't chat with yourself.");
    const [other] = await this.ctx.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, otherId));
    if (!other || other.status !== "active") throw notFound("User");
    await this.ensureProfile(userId);
    await this.ensureProfile(otherId);
    const directKey = [userId, otherId].sort().join(":");
    const id = await this.ctx.db.transaction(async (tx) => {
      await tx.insert(vibexConversations).values({ kind: "direct", directKey }).onConflictDoNothing();
      const [conv] = await tx.select().from(vibexConversations).where(eq(vibexConversations.directKey, directKey));
      await tx
        .insert(vibexMembers)
        .values([
          { conversationId: conv!.id, userId },
          { conversationId: conv!.id, userId: otherId },
        ])
        .onConflictDoNothing();
      return conv!.id;
    });
    return this.chat(userId, id);
  }

  async chat(userId: string, conversationId: string): Promise<VibexChatDto> {
    await this.membership(userId, conversationId);
    const [c] = await this.chatDtos(userId, [conversationId]);
    if (!c) throw notFound("Chat");
    return c;
  }

  /** My chats: pinned first (my order), then by last activity. Empty chats are listed only once pinned. */
  async chats(userId: string): Promise<VibexChatDto[]> {
    const mine = await this.ctx.db.select({ id: vibexMembers.conversationId }).from(vibexMembers).where(eq(vibexMembers.userId, userId));
    const list = await this.chatDtos(userId, mine.map((m) => m.id));
    return list
      .filter((c) => c.lastMessage || c.pinnedPosition !== null)
      .sort((a, b) => {
        if (a.pinnedPosition !== null || b.pinnedPosition !== null) {
          if (a.pinnedPosition === null) return 1;
          if (b.pinnedPosition === null) return -1;
          return a.pinnedPosition - b.pinnedPosition;
        }
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      });
  }

  private async chatDtos(userId: string, ids: string[]): Promise<VibexChatDto[]> {
    if (!ids.length) return [];
    const [convs, members, lastIds] = await Promise.all([
      this.ctx.db.select().from(vibexConversations).where(inArray(vibexConversations.id, ids)),
      this.ctx.db.select().from(vibexMembers).where(inArray(vibexMembers.conversationId, ids)),
      this.ctx.db.execute<{ id: string }>(
        sql`SELECT DISTINCT ON (conversation_id) id FROM vibex_messages WHERE conversation_id IN (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}) ORDER BY conversation_id, created_at DESC, id DESC`,
      ),
    ]);
    const lastRows = lastIds.rows.length ? await this.ctx.db.select().from(vibexMessages).where(inArray(vibexMessages.id, lastIds.rows.map((r) => r.id))) : [];
    const lastDtos = await this.messageDtos(userId, lastRows);
    const lastByConv = new Map(lastRows.map((m) => [m.conversationId, lastDtos.get(m.id)!]));
    const mineByConv = new Map(members.filter((m) => m.userId === userId).map((m) => [m.conversationId, m]));
    const peerByConv = new Map(members.filter((m) => m.userId !== userId).map((m) => [m.conversationId, m]));
    const people = await this.persons([...peerByConv.values()].map((m) => m.userId));
    const settings = await this.settingsOf([userId, ...[...peerByConv.values()].map((m) => m.userId)]);
    const myReceipts = settings.get(userId)!.privacy.readReceipts;
    // Unread: messages from others after my read marker.
    const unread = await this.ctx.db
      .select({ id: vibexMessages.conversationId, n: sql<number>`count(*)::int` })
      .from(vibexMessages)
      .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexMessages.conversationId), eq(vibexMembers.userId, userId)))
      .where(
        and(
          inArray(vibexMessages.conversationId, ids),
          ne(vibexMessages.senderId, userId),
          or(isNull(vibexMembers.lastReadAt), gt(vibexMessages.createdAt, vibexMembers.lastReadAt)),
        ),
      )
      .groupBy(vibexMessages.conversationId);
    const unreadBy = new Map(unread.map((u) => [u.id, u.n]));
    const out: VibexChatDto[] = [];
    for (const c of convs) {
      const peer = peerByConv.get(c.id);
      const me = mineByConv.get(c.id);
      if (!peer || !me || !people.get(peer.userId)) continue;
      out.push({
        id: c.id,
        kind: "direct",
        peer: people.get(peer.userId)!,
        lastMessage: lastByConv.get(c.id) ?? null,
        lastMessageAt: c.lastMessageAt.toISOString(),
        unread: unreadBy.get(c.id) ?? 0,
        pinnedPosition: me.pinnedPosition,
        // Read receipts only when both people share them.
        peerReadAt: myReceipts && settings.get(peer.userId)!.privacy.readReceipts ? (peer.lastReadAt?.toISOString() ?? null) : null,
      });
    }
    return out;
  }

  private async messageDtos(viewerId: string, rows: MessageRow[]): Promise<Map<string, VibexMessageDto>> {
    const out = new Map<string, VibexMessageDto>();
    if (!rows.length) return out;
    const files = await this.filesOf("messageId", rows.map((r) => r.id));
    const sharedIds = [...new Set(rows.filter((r) => r.sharedPost && r.sharedPostId).map((r) => r.sharedPostId!))];
    const shared = sharedIds.length ? await this.ctx.db.select().from(vibexPosts).where(and(inArray(vibexPosts.id, sharedIds), isNull(vibexPosts.deletedAt))) : [];
    const posts = await this.postDtos(viewerId, shared);
    const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
    const replied = replyIds.length ? await this.ctx.db.select().from(vibexMessages).where(inArray(vibexMessages.id, replyIds)) : [];
    const repliedBy = new Map(replied.map((m) => [m.id, m]));
    for (const r of rows) {
      const to = r.replyToId ? repliedBy.get(r.replyToId) : undefined;
      out.set(r.id, {
        id: r.id,
        conversationId: r.conversationId,
        senderId: r.senderId,
        mine: r.senderId === viewerId,
        kind: r.kind,
        durationMs: r.durationMs,
        replyTo: to && to.conversationId === r.conversationId ? { id: to.id, senderId: to.senderId, text: to.text.slice(0, 160), kind: to.kind } : null,
        text: r.text,
        files: files.get(r.id) ?? [],
        ...(r.sharedPost ? { sharedPost: (r.sharedPostId && posts.get(r.sharedPostId)) || null } : {}),
        createdAt: r.createdAt.toISOString(),
      });
    }
    return out;
  }

  /** History of a chat, newest first (the client shows it bottom-up). */
  async messages(userId: string, conversationId: string, cursor?: string, limit = 50): Promise<VibexPage<VibexMessageDto>> {
    await this.membership(userId, conversationId);
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      .where(and(eq(vibexMessages.conversationId, conversationId), olderThan(vibexMessages, c)))
      .orderBy(desc(vibexMessages.createdAt), desc(vibexMessages.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.messageDtos(userId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  async send(
    userId: string,
    conversationId: string,
    input: { text: string; fileIds: string[]; sharedPostId?: string; kind?: VibexMessageKind; durationMs?: number; replyToId?: string },
  ): Promise<VibexMessageDto> {
    const now = this.ctx.now();
    const kind = input.kind ?? "text";
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    if (!members.some((m) => m.userId === userId)) throw notFound("Chat");
    const others = members.filter((m) => m.userId !== userId).map((m) => m.userId);
    const settings = await this.settingsOf(others);
    for (const other of others) {
      if (!(await this.canMessage(userId, other, settings.get(other)))) throw fail(ErrorCode.Forbidden, "This person doesn't accept messages from you.", { status: 403 });
    }
    const row = await this.ctx.db.transaction(async (tx) => {
      let replyToId: string | null = null;
      if (input.replyToId) {
        const [to] = await tx
          .select({ id: vibexMessages.id })
          .from(vibexMessages)
          .where(and(eq(vibexMessages.id, input.replyToId), eq(vibexMessages.conversationId, conversationId)));
        if (!to) throw notFound("Message");
        replyToId = to.id;
      }
      const [m] = await tx
        .insert(vibexMessages)
        .values({
          conversationId,
          senderId: userId,
          text: kind === "text" ? input.text.trim() : "",
          sharedPostId: input.sharedPostId ?? null,
          sharedPost: !!input.sharedPostId,
          kind,
          durationMs: kind === "text" ? null : (input.durationMs ?? null),
          replyToId,
          createdAt: now,
        })
        .returning();
      await this.claimFiles(tx, userId, PURPOSE_OF_KIND[kind], input.fileIds, { messageId: m!.id });
      await tx.update(vibexConversations).set({ lastMessageAt: now }).where(eq(vibexConversations.id, conversationId));
      // Sending reads the chat up to here.
      await tx
        .update(vibexMembers)
        .set({ lastReadAt: now })
        .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      return m!;
    });
    const dto = (await this.messageDtos(userId, [row])).get(row.id)!;
    const sender = await this.person(userId);
    const snippet = kind === "voice" ? "🎤" : kind === "circle" ? "⏺" : row.text.slice(0, 140);
    for (const m of members) {
      this.ctx.events.toUser(m.userId, { type: "vibex.message", conversationId, messageId: row.id, senderId: userId, senderName: sender.name, snippet });
    }
    for (const other of others) {
      if (!settings.get(other)!.notifications.messages) continue;
      await this.notifications?.tryNotify({
        userId: other,
        app: "vibex",
        type: "vibex.message",
        title: sender.name,
        body: kind === "text" ? row.text.slice(0, 200) || (dto.files.length ? `📎 ${dto.files[0]!.filename}` : "") : "",
        actorId: userId,
        target: { chatId: conversationId, messageId: row.id, kind },
        collapseOn: "chatId",
      });
    }
    return dto;
  }

  /** Marks the chat read up to now; the other person gets read receipts. */
  async read(userId: string, conversationId: string) {
    await this.membership(userId, conversationId);
    await this.ctx.db
      .update(vibexMembers)
      .set({ lastReadAt: this.ctx.now() })
      .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const m of members) this.ctx.events.toUser(m.userId, { type: "vibex.chats", conversationId });
    // Opening the chat also reads its notifications.
    await this.notifications?.markTargetRead(userId, "chatId", conversationId);
    return { ok: true };
  }

  /** My pinned chats, in order (everything else becomes unpinned). */
  async setPins(userId: string, conversationIds: string[]) {
    const ids = [...new Set(conversationIds)];
    await this.ctx.db.transaction(async (tx) => {
      if (ids.length) {
        const mine = await tx
          .select({ id: vibexMembers.conversationId })
          .from(vibexMembers)
          .where(and(eq(vibexMembers.userId, userId), inArray(vibexMembers.conversationId, ids)));
        if (mine.length !== ids.length) throw notFound("Chat");
      }
      await tx.update(vibexMembers).set({ pinnedPosition: null }).where(and(eq(vibexMembers.userId, userId), isNotNull(vibexMembers.pinnedPosition)));
      for (const [i, id] of ids.entries()) {
        await tx
          .update(vibexMembers)
          .set({ pinnedPosition: i })
          .where(and(eq(vibexMembers.userId, userId), eq(vibexMembers.conversationId, id)));
      }
    });
    this.ctx.events.toUser(userId, { type: "vibex.chats" });
    return this.chats(userId);
  }

  /** "Share → send in a message" to one or more people (their direct chats). */
  async share(userId: string, postId: string, input: { userIds: string[]; text: string }) {
    const post = await this.target(postId);
    const conversations: string[] = [];
    for (const other of [...new Set(input.userIds)]) {
      const chat = await this.openDirect(userId, other);
      await this.send(userId, chat.id, { text: input.text, fileIds: [], sharedPostId: post.id });
      conversations.push(chat.id);
    }
    return { conversationIds: conversations };
  }
}
