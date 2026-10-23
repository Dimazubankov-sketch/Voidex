import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  DEFAULT_VIBEX_SETTINGS,
  ErrorCode,
  VIBEX_AUDIO_TYPES,
  VIBEX_CIRCLE_TYPES,
  VIBEX_FILES_MAX,
  VIBEX_COVER_MAX_BYTES,
  VIBEX_GROUP_MEMBERS_MAX,
  VIBEX_FILE_MAX_BYTES,
  VIBEX_MEDIA_MAX_BYTES,
  VIBEX_POST_IMAGE_TYPES,
  VIBEX_POST_VIDEO_TYPES,
  VibexSettingsSchema,
  type VibexFeedMode,
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
  type NotesCardDto,
  VIBEX_STORY_TTL_MS,
  VIBEX_STORY_TYPES,
  canDeleteChatForAll,
  type VibexChatSearchDto,
  type VibexStoryDto,
  type VibexStoryGroupDto,
  type VibexStoryViewerDto,
  type VibexActivityDto,
  type VibexActivityPageDto,
  type VibexActivityType,
  type VibexSearchDto,
  VIBEX_PINS_MAX,
  type VibexChatMediaKind,
  type VibexPinDto,
  type VibexPresenceDto,
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
  vibexPostViews,
  vibexPosts,
  vibexProfiles,
  vibexReports,
  vibexStories,
  vibexStoryViews,
  vibexMessageHides,
  vibexActivity,
  vibexPins,
} from "../db/schema.js";
import { looksLike } from "../lib/file-types.js";
import { fail, notFound } from "../lib/errors.js";
import type { Ctx } from "./context.js";
import type { NotificationService } from "./notifications.js";

type FileRow = typeof vibexFiles.$inferSelect;
type PostRow = typeof vibexPosts.$inferSelect;
type MessageRow = typeof vibexMessages.$inferSelect;
type StoryRow = typeof vibexStories.$inferSelect;

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
  // Step 2.4: a group chat's picture.
  group: { types: ["image/jpeg", "image/png", "image/webp"], max: VIBEX_COVER_MAX_BYTES },
  // Step 2.9: a story's photo / video, and a Files attachment on a post (any accepted type).
  story: { types: VIBEX_STORY_TYPES, max: VIBEX_MEDIA_MAX_BYTES },
  postfile: { types: null, max: VIBEX_FILE_MAX_BYTES },
};
/** An uploaded file is still "pending" (cleanable) unless a group uses it as its picture or a story shows it. */
const notAGroupPicture = sql`NOT EXISTS (SELECT 1 FROM vibex_conversations c WHERE c.avatar_file_id = ${vibexFiles.id}) AND NOT EXISTS (SELECT 1 FROM vibex_stories s WHERE s.file_id = ${vibexFiles.id})`;
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
  ) {
    // Update 2 · C3: presence follows the account's live connections.
    ctx.events.onPresence?.((userId, online) => void this.presenceChanged(userId, online).catch(() => undefined));
  }

  // ---------------------------------------------------------------- presence (Update 2 · C3)

  /** Saves "last seen" when the last device goes, and tells the people who may see it. */
  private async presenceChanged(userId: string, online: boolean) {
    if (!online) await this.ctx.db.update(users).set({ lastSeenAt: this.ctx.now() }).where(eq(users.id, userId));
    const settings = await this.settings(userId);
    // Hidden presence: nobody is told anything (not even that something changed).
    if (settings.privacy.presence === "nobody") return;
    for (const peer of await this.directPeers(userId)) {
      if (settings.privacy.blocked.includes(peer)) continue;
      this.ctx.events.toUser(peer, { type: "vibex.presence", userId });
    }
  }

  /**
   * What `viewerId` may see of these people's presence: their own is always real; someone who hides it
   * (or blocked the viewer) is "hidden" — the server never sends more than that.
   */
  private async presenceOf(viewerId: string, ids: string[]): Promise<Map<string, VibexPresenceDto>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, VibexPresenceDto>();
    if (!unique.length) return out;
    const [settings, rows] = await Promise.all([
      this.settingsOf(unique),
      this.ctx.db.select({ id: users.id, lastSeenAt: users.lastSeenAt }).from(users).where(inArray(users.id, unique)),
    ]);
    const seen = new Map(rows.map((r) => [r.id, r.lastSeenAt]));
    for (const id of unique) {
      const s = settings.get(id)!;
      if (id !== viewerId && (s.privacy.presence === "nobody" || s.privacy.blocked.includes(viewerId))) {
        out.set(id, { state: "hidden" });
        continue;
      }
      out.set(id, this.ctx.events.isOnline?.(id) ? { state: "online" } : { state: "offline", lastSeenAt: seen.get(id)?.toISOString() ?? null });
    }
    return out;
  }

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

  async updateSettings(
    userId: string,
    patch: {
      privacy?: Partial<VibexSettings["privacy"]>;
      notifications?: Partial<VibexSettings["notifications"]>;
      media?: Partial<VibexSettings["media"]>;
      chats?: Partial<VibexSettings["chats"]>;
      feed?: Partial<VibexSettings["feed"]>;
    },
  ): Promise<VibexSettings> {
    await this.ensureProfile(userId);
    const cur = await this.settings(userId);
    const next = readSettings({
      privacy: { ...cur.privacy, ...patch.privacy },
      notifications: { ...cur.notifications, ...patch.notifications },
      media: { ...cur.media, ...patch.media },
      chats: { ...cur.chats, ...patch.chats },
      feed: { ...cur.feed, ...patch.feed },
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
      if (added.length) await this.recordActivity(otherId, userId, "follow");
      if (added.length && s.notifications.follows) {
        const me = await this.person(userId);
        await this.notifications?.tryNotify({ userId: otherId, app: "vibex", type: "vibex.follow", title: me.name, body: "", actorId: userId, target: { userId } });
      }
    } else {
      await this.ctx.db.delete(vibexFollows).where(and(eq(vibexFollows.followerId, userId), eq(vibexFollows.followeeId, otherId)));
      await this.dropActivity(otherId, userId, "follow");
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

  /**
   * Step 2.16: people to follow, for «Подписки» when it has nothing to show:
   * active accounts I don't follow yet (people I followed never come back
   * here), those who post most recently and are followed most first.
   */
  async suggested(viewerId: string, limit = 12): Promise<VibexPersonDto[]> {
    const lastPost = sql<Date | null>`(select max(${vibexPosts.createdAt}) from ${vibexPosts} where ${vibexPosts.authorId} = ${users.id} and ${vibexPosts.deletedAt} is null)`;
    const followers = sql<number>`(select count(*) from ${vibexFollows} where ${vibexFollows.followeeId} = ${users.id})`;
    const rows = await this.ctx.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          ne(users.id, viewerId),
          eq(users.status, "active"),
          sql`not exists (select 1 from ${vibexFollows} where ${vibexFollows.followerId} = ${viewerId} and ${vibexFollows.followeeId} = ${users.id})`,
        ),
      )
      .orderBy(sql`${lastPost} desc nulls last`, sql`${followers} desc`, desc(users.createdAt))
      .limit(Math.max(1, Math.min(30, limit)));
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
    const presence = (await this.presenceOf(viewerId, [userId])).get(userId);
    return {
      person: { ...person, presence },
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
  /**
   * Step 2.11: uploads the client may still cancel, by a key of its own
   * (X-Upload-Key). A cancel that arrives before the upload is processed
   * marks the key: that upload is then refused; one that arrives after
   * deletes the file. Kept 10 minutes (files never sent are swept anyway).
   */
  private readonly uploadKeys = new Map<string, { fileId: string | null; cancelled: boolean; at: number }>();
  private keyOf(ownerId: string, key: string) {
    const now = Date.now();
    for (const [k, v] of this.uploadKeys) if (now - v.at > 10 * 60_000) this.uploadKeys.delete(k);
    return `${ownerId}:${key}`;
  }

  /** Step 2.11: the client cancelled the upload with this key (before or after it reached the server). */
  async cancelUpload(ownerId: string, key: string) {
    const k = this.keyOf(ownerId, key);
    const entry = this.uploadKeys.get(k);
    this.uploadKeys.set(k, { fileId: null, cancelled: true, at: Date.now() });
    if (entry?.fileId) await this.discardUpload(ownerId, entry.fileId).catch(() => undefined);
    return { ok: true };
  }

  async upload(ownerId: string, purpose: VibexUploadPurpose, input: { filename: string; data: Buffer; uploadKey?: string }): Promise<VibexFileDto> {
    const cancelled = () => !!input.uploadKey && !!this.uploadKeys.get(this.keyOf(ownerId, input.uploadKey))?.cancelled;
    if (cancelled()) throw fail(ErrorCode.ValidationFailed, "The upload was cancelled.", { status: 409 });
    const dto = await this.store(ownerId, purpose, input);
    if (input.uploadKey) {
      if (cancelled()) {
        // Cancelled while it was being stored: nothing stays.
        await this.discardUpload(ownerId, dto.id).catch(() => undefined);
        throw fail(ErrorCode.ValidationFailed, "The upload was cancelled.", { status: 409 });
      }
      this.uploadKeys.set(this.keyOf(ownerId, input.uploadKey), { fileId: dto.id, cancelled: false, at: Date.now() });
    }
    return dto;
  }

  private async store(ownerId: string, purpose: VibexUploadPurpose, input: { filename: string; data: Buffer }): Promise<VibexFileDto> {
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
            notAGroupPicture,
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
      .where(and(eq(vibexFiles.id, fileId), eq(vibexFiles.ownerId, ownerId), isNull(vibexFiles.messageId), isNull(vibexFiles.postId), notAGroupPicture))
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
    } else if (row.purpose === "group") {
      // A group picture: every member of a group that uses it (and its uploader).
      const [g] = await this.ctx.db
        .select({ id: vibexMembers.userId })
        .from(vibexConversations)
        .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexConversations.id), eq(vibexMembers.userId, viewerId)))
        .where(eq(vibexConversations.avatarFileId, row.id));
      allowed = !!g || row.ownerId === viewerId;
    } else if (row.postId) {
      const [p] = await this.ctx.db.select().from(vibexPosts).where(eq(vibexPosts.id, row.postId));
      allowed = !!p && (p.authorId === viewerId || (!p.deletedAt && (await this.canSee(viewerId, p.authorId, "posts"))));
    } else if (row.purpose === "story") {
      // Step 2.9: its author always (the archive); others while the story is live and they may see the author's posts.
      const [st] = await this.ctx.db.select().from(vibexStories).where(eq(vibexStories.fileId, row.id));
      allowed =
        row.ownerId === viewerId ||
        (!!st && !st.deletedAt && st.expiresAt > this.ctx.now() && (await this.canSee(viewerId, st.ownerId, "posts")));
    } else {
      allowed = row.ownerId === viewerId;
    }
    if (!allowed) throw notFound("File");
    const blob = await this.ctx.blobs.get(row.storageKey);
    if (!blob) throw notFound("File");
    return { filename: row.filename, mimeType: row.mimeType, data: blob.data };
  }

  /** Claims uploaded files for a message / post (owner, purpose and "not yet sent" are enforced). */
  private async claimFiles(tx: Tx, ownerId: string, purpose: VibexUploadPurpose, ids: string[], target: { messageId: string } | { postId: string }, offset = 0) {
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
        .set({ ...target, position: offset + i })
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
    const [people, media, likeCounts, repostCounts, myLikes, myMarks, myReposts, commentCounts, viewCounts, sendCounts] = await Promise.all([
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
      // Step 2.5: unique signed-in viewers (never the author) …
      this.ctx.db
        .select({ id: vibexPostViews.postId, n: sql<number>`count(*)::int` })
        .from(vibexPostViews)
        .where(inArray(vibexPostViews.postId, ids))
        .groupBy(vibexPostViews.postId),
      // … and how often it was sent into chats ("Share → send in a message").
      this.ctx.db
        .select({ id: vibexMessages.sharedPostId, n: sql<number>`count(*)::int` })
        .from(vibexMessages)
        .where(and(inArray(vibexMessages.sharedPostId, ids), isNull(vibexMessages.deletedAt)))
        .groupBy(vibexMessages.sharedPostId),
    ]);
    const views = new Map(viewCounts.map((r) => [r.id, r.n]));
    const sends = new Map(sendCounts.map((r) => [r.id!, r.n]));
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
      views: views.get(r.id) ?? 0,
      shares: (reposts.get(r.id) ?? 0) + (sends.get(r.id) ?? 0),
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

  /**
   * Главная, newest first, minus what I marked "not interested".
   *   recommended  posts and reposts picked for me: for now everyone's I may
   *                see (the place where ranking by interests and ads will go)
   *   following    Step 2.15: only the posts and reposts of the people I follow
   */
  feed(viewerId: string, cursor?: string, limit = 30, mode: VibexFeedMode = "recommended") {
    const hidden = this.ctx.db.select({ id: vibexHiddenPosts.postId }).from(vibexHiddenPosts).where(eq(vibexHiddenPosts.userId, viewerId));
    const followed = this.ctx.db.select({ id: vibexFollows.followeeId }).from(vibexFollows).where(eq(vibexFollows.followerId, viewerId));
    return this.page(
      viewerId,
      and(
        sql`${vibexPosts.id} NOT IN (${hidden})`,
        or(isNull(vibexPosts.repostOfId), sql`${vibexPosts.repostOfId} NOT IN (${hidden})`),
        mode === "following" ? sql`${vibexPosts.authorId} IN (${followed})` : undefined,
      ),
      cursor,
      limit,
    );
  }

  personPosts(viewerId: string, userId: string, cursor?: string, limit = 30) {
    return this.page(viewerId, eq(vibexPosts.authorId, userId), cursor, limit);
  }

  /**
   * Step 2.9 "Публикации": the person's own posts that carry a photo or a
   * video — the same posts as in "Посты", shown media first (no copies).
   */
  publications(viewerId: string, userId: string, cursor?: string, limit = 30) {
    const types = [...VIBEX_POST_IMAGE_TYPES, ...VIBEX_POST_VIDEO_TYPES];
    const withMedia = sql`EXISTS (SELECT 1 FROM vibex_files f WHERE f.post_id = ${vibexPosts.id} AND f.mime_type IN (${sql.join(
      types.map((t) => sql`${t}`),
      sql`, `,
    )}))`;
    return this.page(viewerId, and(eq(vibexPosts.authorId, userId), eq(vibexPosts.kind, "post"), withMedia), cursor, limit);
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

  async createPost(authorId: string, input: { text: string; mediaIds: string[]; fileIds?: string[] }): Promise<VibexPostDto> {
    const row = await this.ctx.db.transaction(async (tx) => {
      const [p] = await tx.insert(vibexPosts).values({ authorId, kind: "post", text: input.text.trim() }).returning();
      await this.claimFiles(tx, authorId, "post", input.mediaIds, { postId: p!.id });
      // Step 2.9: Files attachments (only my own "postfile" uploads) come after the pictures / videos.
      await this.claimFiles(tx, authorId, "postfile", input.fileIds ?? [], { postId: p!.id }, input.mediaIds.length);
      return p!;
    });
    this.feedChanged(row.id);
    // Step 2.10: the author's followers see the new post in their activity.
    await this.activityToFollowers(authorId, "post", { postId: row.id });
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
    await this.recordActivity(recipient, authorId, parent ? "reply" : "comment", { postId: post.id, commentId: row!.id });
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
      if (added.length) await this.recordActivity(post.authorId, userId, "like", { postId: post.id });
      if (added.length && post.authorId !== userId && (await this.settings(post.authorId)).notifications.likes) {
        const me = await this.person(userId);
        await this.notifications?.tryNotify({ userId: post.authorId, app: "vibex", type: "vibex.like", title: me.name, body: post.text.slice(0, 140), actorId: userId, target: { postId: post.id } });
      }
    } else {
      await this.ctx.db.delete(vibexLikes).where(and(eq(vibexLikes.postId, post.id), eq(vibexLikes.userId, userId)));
      await this.dropActivity(post.authorId, userId, "like", post.id);
    }
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
    const added = await this.ctx.db.insert(vibexPosts).values({ authorId: userId, kind: "repost", repostOfId: original.id }).onConflictDoNothing().returning({ id: vibexPosts.id });
    if (added.length) await this.recordActivity(original.authorId, userId, "repost", { postId: original.id });
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
    await this.dropActivity(original.authorId, userId, "repost", original.id);
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
      // Step 2.9: opening a chat I deleted for myself puts it back (with an empty history).
      await tx.update(vibexMembers).set({ hidden: false }).where(and(eq(vibexMembers.conversationId, conv!.id), eq(vibexMembers.userId, userId)));
      return conv!.id;
    });
    return this.chat(userId, id);
  }

  // ---------------------------------------------------------------- groups (Step 2.4)

  /** A new group chat: me (owner) and the people I pick, each of whom accepts messages from me. */
  async createGroup(creatorId: string, input: { title: string; memberIds: string[]; avatarFileId?: string }): Promise<VibexChatDto> {
    const memberIds = [...new Set(input.memberIds)].filter((id) => id !== creatorId);
    if (!memberIds.length) throw fail(ErrorCode.ValidationFailed, "Add at least one person.");
    if (memberIds.length > VIBEX_GROUP_MEMBERS_MAX) throw fail(ErrorCode.ValidationFailed, "Too many people.", { details: { max: VIBEX_GROUP_MEMBERS_MAX } });
    const found = await this.ctx.db.select({ id: users.id }).from(users).where(and(inArray(users.id, memberIds), eq(users.status, "active")));
    if (found.length !== memberIds.length) throw notFound("User");
    const settings = await this.settingsOf(memberIds);
    for (const id of memberIds) {
      if (!(await this.canMessage(creatorId, id, settings.get(id)))) {
        const p = await this.person(id);
        throw fail(ErrorCode.Forbidden, `${p.name} doesn't accept messages from you.`, { status: 403, details: { userId: id } });
      }
    }
    await this.ensureProfile(creatorId);
    for (const id of memberIds) await this.ensureProfile(id);
    const now = this.ctx.now();
    const id = await this.ctx.db.transaction(async (tx) => {
      if (input.avatarFileId) await this.checkGroupPicture(tx, creatorId, input.avatarFileId);
      const [conv] = await tx
        .insert(vibexConversations)
        .values({ kind: "group", title: input.title.trim(), avatarFileId: input.avatarFileId ?? null, createdBy: creatorId, createdAt: now, lastMessageAt: now })
        .returning();
      await tx.insert(vibexMembers).values([
        { conversationId: conv!.id, userId: creatorId, role: "owner" as const, lastReadAt: now },
        ...memberIds.map((u) => ({ conversationId: conv!.id, userId: u, role: "member" as const })),
      ]);
      return conv!.id;
    });
    const creator = await this.person(creatorId);
    for (const u of [creatorId, ...memberIds]) this.ctx.events.toUser(u, { type: "vibex.chats", conversationId: id });
    for (const u of memberIds) {
      await this.recordActivity(u, creatorId, "group", { conversationId: id });
      await this.notifications?.tryNotify({
        userId: u,
        app: "vibex",
        type: "vibex.group",
        title: input.title.trim(),
        body: creator.name,
        actorId: creatorId,
        target: { chatId: id },
        collapseOn: "chatId",
      });
    }
    return this.chat(creatorId, id);
  }

  /** Renames the group or changes its picture (its creator only). */
  async updateGroup(userId: string, conversationId: string, input: { title?: string; avatarFileId?: string | null }): Promise<VibexChatDto> {
    const me = await this.membership(userId, conversationId);
    const [conv] = await this.ctx.db.select().from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    if (!conv || conv.kind !== "group") throw notFound("Chat");
    if (me.role !== "owner") throw fail(ErrorCode.Forbidden, "Only the group's creator can change it.", { status: 403 });
    await this.ctx.db.transaction(async (tx) => {
      if (input.avatarFileId) await this.checkGroupPicture(tx, userId, input.avatarFileId);
      await tx
        .update(vibexConversations)
        .set({ ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.avatarFileId !== undefined ? { avatarFileId: input.avatarFileId } : {}) })
        .where(eq(vibexConversations.id, conversationId));
    });
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const m of members) this.ctx.events.toUser(m.userId, { type: "vibex.chats", conversationId });
    return this.chat(userId, conversationId);
  }

  /** Leaves a group; the creator's role passes to the longest-standing member; an empty group is removed. */
  async leaveGroup(userId: string, conversationId: string) {
    const me = await this.membership(userId, conversationId);
    const [conv] = await this.ctx.db.select({ kind: vibexConversations.kind }).from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    if (!conv || conv.kind !== "group") throw notFound("Chat");
    const rest = await this.ctx.db.transaction(async (tx) => {
      await tx.delete(vibexMembers).where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      const left = await tx.select().from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId)).orderBy(asc(vibexMembers.joinedAt));
      if (!left.length) {
        await tx.delete(vibexConversations).where(eq(vibexConversations.id, conversationId));
      } else if (me.role === "owner") {
        await tx.update(vibexMembers).set({ role: "owner" }).where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, left[0]!.userId)));
      }
      return left.map((m) => m.userId);
    });
    for (const u of [userId, ...rest]) this.ctx.events.toUser(u, { type: "vibex.chats", conversationId });
    return { ok: true };
  }

  /** A group picture: an image I uploaded for this purpose. */
  private async checkGroupPicture(tx: Tx, ownerId: string, fileId: string) {
    const [f] = await tx.select({ id: vibexFiles.id }).from(vibexFiles).where(and(eq(vibexFiles.id, fileId), eq(vibexFiles.ownerId, ownerId), eq(vibexFiles.purpose, "group")));
    if (!f) throw notFound("File");
  }

  async chat(userId: string, conversationId: string): Promise<VibexChatDto> {
    await this.membership(userId, conversationId);
    const [c] = await this.chatDtos(userId, [conversationId]);
    if (!c) throw notFound("Chat");
    return c;
  }

  /** My chats: pinned first (my order), then by last activity. Empty chats are listed only once pinned. */
  async chats(userId: string): Promise<VibexChatDto[]> {
    // Step 2.9: a chat I deleted for myself stays out of my list until a new message arrives.
    const mine = await this.ctx.db
      .select({ id: vibexMembers.conversationId, clearedAt: vibexMembers.clearedAt })
      .from(vibexMembers)
      .where(and(eq(vibexMembers.userId, userId), eq(vibexMembers.hidden, false)));
    // Update 2 · C4: a chat whose history I cleared stays in my list, empty.
    const cleared = new Set(mine.filter((m) => m.clearedAt).map((m) => m.id));
    const list = await this.chatDtos(userId, mine.map((m) => m.id));
    return list
      .filter((c) => c.lastMessage || c.pinnedPosition !== null || c.kind === "group" || cleared.has(c.id))
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
        )}) AND deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM vibex_message_hides h WHERE h.message_id = vibex_messages.id AND h.user_id = ${userId}::uuid)
         ORDER BY conversation_id, created_at DESC, id DESC`,
      ),
    ]);
    const lastRows = lastIds.rows.length ? await this.ctx.db.select().from(vibexMessages).where(inArray(vibexMessages.id, lastIds.rows.map((r) => r.id))) : [];
    const lastDtos = await this.messageDtos(userId, lastRows);
    const mineByConv = new Map(members.filter((m) => m.userId === userId).map((m) => [m.conversationId, m]));
    // Step 2.9: what I deleted for myself is not my "last message" any more.
    const lastByConv = new Map(
      lastRows.filter((m) => !mineByConv.get(m.conversationId)?.clearedAt || m.createdAt > mineByConv.get(m.conversationId)!.clearedAt!).map((m) => [m.conversationId, lastDtos.get(m.id)!]),
    );
    const peerByConv = new Map(members.filter((m) => m.userId !== userId).map((m) => [m.conversationId, m]));
    const people = await this.persons([...new Set(members.map((m) => m.userId))]);
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
          isNull(vibexMessages.deletedAt),
          or(isNull(vibexMembers.lastReadAt), gt(vibexMessages.createdAt, vibexMembers.lastReadAt)),
          or(isNull(vibexMembers.clearedAt), gt(vibexMessages.createdAt, vibexMembers.clearedAt)),
          this.notHiddenFor(userId),
        ),
      )
      .groupBy(vibexMessages.conversationId);
    const unreadBy = new Map(unread.map((u) => [u.id, u.n]));
    // Update 2 · C1: each chat's pinned messages (not deleted, not deleted for me, not before my "delete for me").
    const pinRows = await this.ctx.db
      .select({ conv: vibexPins.conversationId, pinnedAt: vibexPins.pinnedAt, m: vibexMessages })
      .from(vibexPins)
      .innerJoin(vibexMessages, eq(vibexMessages.id, vibexPins.messageId))
      .where(and(inArray(vibexPins.conversationId, ids), isNull(vibexMessages.deletedAt), this.notHiddenFor(userId)));
    const pinsOf = (c: (typeof convs)[number]): VibexPinDto[] => {
      const cleared = mineByConv.get(c.id)?.clearedAt;
      return pinRows
        .filter((r) => r.conv === c.id && (!cleared || r.m.createdAt > cleared))
        .sort((a, b) => a.m.createdAt.getTime() - b.m.createdAt.getTime() || a.m.id.localeCompare(b.m.id))
        .map((r) => ({ id: r.m.id, senderId: r.m.senderId, text: r.m.text.slice(0, 160), kind: r.m.kind, createdAt: r.m.createdAt.toISOString(), pinnedAt: r.pinnedAt.toISOString() }));
    };
    /** For older apps: the most recently pinned one. */
    const pinnedOf = (pins: VibexPinDto[]) => {
      const last = [...pins].sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt))[0];
      return last ? { id: last.id, senderId: last.senderId, text: last.text, kind: last.kind } : null;
    };
    const presence = await this.presenceOf(userId, [...peerByConv.values()].filter((m) => convs.find((c) => c.id === m.conversationId)?.kind === "direct").map((m) => m.userId));
    const out: VibexChatDto[] = [];
    for (const c of convs) {
      const me = mineByConv.get(c.id);
      if (!me) continue;
      if (c.kind === "group") {
        const inGroup = members.filter((m) => m.conversationId === c.id);
        out.push({
          id: c.id,
          kind: "group",
          peer: null,
          group: {
            title: c.title ?? "",
            avatarFileId: c.avatarFileId,
            // The creator first, then by joining time.
            members: inGroup
              .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.joinedAt.getTime() - b.joinedAt.getTime()))
              .map((m) => people.get(m.userId))
              .filter((p): p is VibexPersonDto => !!p),
            role: me.role,
          },
          lastMessage: lastByConv.get(c.id) ?? null,
          lastMessageAt: c.lastMessageAt.toISOString(),
          unread: unreadBy.get(c.id) ?? 0,
          pinnedPosition: me.pinnedPosition,
          peerReadAt: null,
          muted: me.muted,
          canDeleteForAll: me.role === "owner",
          pinnedMessage: pinnedOf(pinsOf(c)),
          pins: pinsOf(c),
          canPin: me.role === "owner",
        });
        continue;
      }
      const peer = peerByConv.get(c.id);
      if (!peer || !people.get(peer.userId)) continue;
      out.push({
        id: c.id,
        kind: "direct",
        group: null,
        peer: { ...people.get(peer.userId)!, presence: presence.get(peer.userId) },
        lastMessage: lastByConv.get(c.id) ?? null,
        lastMessageAt: c.lastMessageAt.toISOString(),
        unread: unreadBy.get(c.id) ?? 0,
        pinnedPosition: me.pinnedPosition,
        // Read receipts only when both people share them.
        peerReadAt: myReceipts && settings.get(peer.userId)!.privacy.readReceipts ? (peer.lastReadAt?.toISOString() ?? null) : null,
        muted: me.muted,
        canDeleteForAll: true,
        pinnedMessage: pinnedOf(pinsOf(c)),
        pins: pinsOf(c),
        canPin: true,
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
    // A reply to a deleted message keeps no quote of it.
    const replied = replyIds.length ? await this.ctx.db.select().from(vibexMessages).where(and(inArray(vibexMessages.id, replyIds), isNull(vibexMessages.deletedAt))) : [];
    const repliedBy = new Map(replied.map((m) => [m.id, m]));
    // Step 2.10: forwarded copies name the original's author.
    const fwdIds = [...new Set(rows.map((r) => r.forwardedFromId).filter((x): x is string => !!x))];
    const fwd = fwdIds.length ? await this.persons(fwdIds) : new Map<string, VibexPersonDto>();
    // Step 2.11: replies to stories show the story while it is there (its author always sees it, others for its 24 hours).
    const storyIds = [...new Set(rows.map((r) => r.storyId).filter((x): x is string => !!x))];
    const stories = storyIds.length ? await this.ctx.db.select().from(vibexStories).where(inArray(vibexStories.id, storyIds)) : [];
    const storyFiles = stories.length ? await this.ctx.db.select().from(vibexFiles).where(inArray(vibexFiles.id, stories.map((x) => x.fileId))) : [];
    const storyBy = new Map(stories.map((x) => [x.id, x]));
    const storyFileBy = new Map(storyFiles.map((f) => [f.id, fileDto(f)]));
    const now = this.ctx.now();
    const storyRef = (id: string | null) => {
      const st = id ? storyBy.get(id) : undefined;
      if (!st) return null;
      const shown = !st.deletedAt && (st.ownerId === viewerId || st.expiresAt > now);
      return { id: st.id, ownerId: st.ownerId, kind: st.kind, file: shown ? (storyFileBy.get(st.fileId) ?? null) : null };
    };
    for (const r of rows) {
      const to = r.replyToId ? repliedBy.get(r.replyToId) : undefined;
      out.set(r.id, {
        id: r.id,
        conversationId: r.conversationId,
        senderId: r.senderId,
        mine: r.senderId === viewerId,
        kind: r.kind,
        durationMs: r.durationMs,
        replyTo:
          to && to.conversationId === r.conversationId
            ? { id: to.id, senderId: to.senderId, text: to.text.slice(0, 160), kind: to.kind }
            : null,
        text: r.text,
        files: files.get(r.id) ?? [],
        ...(r.sharedPost ? { sharedPost: (r.sharedPostId && posts.get(r.sharedPostId)) || null } : {}),
        ...(r.notesCard && !r.deletedAt ? { notesCard: r.notesCard } : {}),
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        forwardedFrom: r.forwardedFromId ? { id: r.forwardedFromId, name: fwd.get(r.forwardedFromId)?.name ?? "" } : null,
        ...(r.storyId ? { story: storyRef(r.storyId) } : {}),
      });
    }
    return out;
  }

  /** SQL: messages this person has not deleted "for me" (Step 2.10). */
  private notHiddenFor(userId: string): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM vibex_message_hides h WHERE h.message_id = ${vibexMessages.id} AND h.user_id = ${userId}::uuid)`;
  }

  /**
   * History of a chat, newest first (the client shows it bottom-up).
   * Step 2.9: reading the history never marks anything read (that is
   * `read()` alone), so a long-press preview leaves unread counts, read
   * receipts and notifications exactly as they were.
   */
  async messages(userId: string, conversationId: string, cursor?: string, limit = 50): Promise<VibexPage<VibexMessageDto>> {
    const me = await this.membership(userId, conversationId);
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      // Step 2.8: a deleted message is gone from the history, nothing is left in its place.
      // Step 2.9: nor is what I deleted for myself (the chat's history up to `clearedAt`).
      .where(
        and(
          eq(vibexMessages.conversationId, conversationId),
          isNull(vibexMessages.deletedAt),
          me.clearedAt ? gt(vibexMessages.createdAt, me.clearedAt) : undefined,
          this.notHiddenFor(userId),
          olderThan(vibexMessages, c),
        ),
      )
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
    input: {
      text: string;
      fileIds: string[];
      sharedPostId?: string;
      kind?: VibexMessageKind;
      durationMs?: number;
      replyToId?: string;
      notesCard?: NotesCardDto;
      /** Step 2.10: a forwarded copy of this message (its text, files, post, card; the original author). */
      forwardOf?: MessageRow;
      /** Step 2.11: a reply to this story. */
      storyId?: string;
    },
  ): Promise<VibexMessageDto> {
    const now = this.ctx.now();
    const kind = input.kind ?? "text";
    const members = await this.ctx.db.select({ userId: vibexMembers.userId, muted: vibexMembers.muted }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    if (!members.some((m) => m.userId === userId)) throw notFound("Chat");
    const muted = new Set(members.filter((m) => m.muted).map((m) => m.userId));
    const [conv] = await this.ctx.db.select({ kind: vibexConversations.kind, title: vibexConversations.title }).from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    const isGroup = conv?.kind === "group";
    const others = members.filter((m) => m.userId !== userId).map((m) => m.userId);
    const settings = await this.settingsOf(others);
    // Direct chats follow the other person's "who can message me"; in a group it was checked when they were added.
    if (!isGroup) {
      for (const other of others) {
        if (!(await this.canMessage(userId, other, settings.get(other)))) throw fail(ErrorCode.Forbidden, "This person doesn't accept messages from you.", { status: 403 });
      }
    }
    const row = await this.ctx.db.transaction(async (tx) => {
      let replyToId: string | null = null;
      if (input.replyToId) {
        const [to] = await tx
          .select({ id: vibexMessages.id })
          .from(vibexMessages)
          .where(and(eq(vibexMessages.id, input.replyToId), eq(vibexMessages.conversationId, conversationId), isNull(vibexMessages.deletedAt)));
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
          notesCard: kind === "text" ? (input.notesCard ?? null) : null,
          forwardedFromId: input.forwardOf ? (input.forwardOf.forwardedFromId ?? input.forwardOf.senderId) : null,
          storyId: input.storyId ?? null,
          createdAt: now,
        })
        .returning();
      await this.claimFiles(tx, userId, PURPOSE_OF_KIND[kind], input.fileIds, { messageId: m!.id });
      if (input.forwardOf) {
        // The copy owns its own files (deleting the original never breaks it).
        const files = await tx.select().from(vibexFiles).where(eq(vibexFiles.messageId, input.forwardOf.id));
        for (const f of files) {
          const key = await this.ctx.blobs.copy(f.storageKey, userId, tx);
          if (!key) continue;
          await tx.insert(vibexFiles).values({
            ownerId: userId,
            purpose: f.purpose,
            messageId: m!.id,
            position: f.position,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            storageKey: key,
          });
        }
      }
      await tx.update(vibexConversations).set({ lastMessageAt: now }).where(eq(vibexConversations.id, conversationId));
      // Step 2.9: a chat someone deleted for themselves comes back to their list with the new message.
      await tx.update(vibexMembers).set({ hidden: false }).where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.hidden, true)));
      // Sending reads the chat up to here.
      await tx
        .update(vibexMembers)
        .set({ lastReadAt: now })
        .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      return m!;
    });
    const dto = (await this.messageDtos(userId, [row])).get(row.id)!;
    const sender = await this.person(userId);
    const card = row.notesCard ? `📄 ${row.notesCard.title}${row.notesCard.ext}` : "";
    const snippet = kind === "voice" ? "🎤" : kind === "circle" ? "⏺" : row.text.slice(0, 140) || card;
    for (const m of members) {
      this.ctx.events.toUser(m.userId, { type: "vibex.message", conversationId, messageId: row.id, senderId: userId, senderName: sender.name, snippet });
    }
    for (const other of others) {
      // Step 2.9: notifications off for this chat (or for all messages): no notification.
      if (!settings.get(other)!.notifications.messages || muted.has(other)) continue;
      await this.notifications?.tryNotify({
        userId: other,
        app: "vibex",
        type: "vibex.message",
        title: isGroup ? conv!.title ?? sender.name : sender.name,
        body: (isGroup ? `${sender.firstName}: ` : "") + (kind === "text" ? row.text.slice(0, 200) || card || (dto.files.length ? `📎 ${dto.files[0]!.filename}` : "") : kind === "voice" ? "🎤" : kind === "circle" ? "⏺" : ""),
        actorId: userId,
        target: { chatId: conversationId, messageId: row.id, kind },
        collapseOn: "chatId",
      });
    }
    return dto;
  }

  /**
   * Step 2.5: the sender deletes their own message (text, files, voice, circle)
   * for everyone. Its text and files are removed for good, and since Step 2.8
   * nothing is left in the chat: no placeholder, no quote in replies. Only
   * the sender can do this — anyone else gets 403.
   */
  async deleteMessage(userId: string, messageId: string) {
    const [m] = await this.ctx.db.select().from(vibexMessages).where(eq(vibexMessages.id, messageId));
    if (!m) throw notFound("Message");
    await this.membership(userId, m.conversationId);
    if (m.senderId !== userId) throw fail(ErrorCode.Forbidden, "Only the sender can delete a message.", { status: 403 });
    if (m.deletedAt) return { ok: true };
    await this.ctx.db.transaction(async (tx) => {
      await tx
        .update(vibexMessages)
        .set({ deletedAt: this.ctx.now(), text: "", sharedPostId: null, sharedPost: false, durationMs: null, notesCard: null })
        .where(eq(vibexMessages.id, m.id));
      const files = await tx.delete(vibexFiles).where(eq(vibexFiles.messageId, m.id)).returning({ key: vibexFiles.storageKey });
      await this.ctx.blobs.delete(files.map((f) => f.key), tx);
    });
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, m.conversationId));
    for (const u of members) {
      this.ctx.events.toUser(u.userId, { type: "vibex.message.deleted", conversationId: m.conversationId, messageId: m.id });
      this.ctx.events.toUser(u.userId, { type: "vibex.chats", conversationId: m.conversationId });
    }
    await this.notifications?.removeTarget("messageId", m.id);
    return { ok: true };
  }

  /**
   * Step 2.10: the sender edits the text of their own text message (not a
   * forwarded copy). Everyone in the chat sees the new text and "edited".
   */
  async editMessage(userId: string, messageId: string, text: string): Promise<VibexMessageDto> {
    const [m] = await this.ctx.db.select().from(vibexMessages).where(and(eq(vibexMessages.id, messageId), isNull(vibexMessages.deletedAt)));
    if (!m) throw notFound("Message");
    await this.membership(userId, m.conversationId);
    if (m.senderId !== userId) throw fail(ErrorCode.Forbidden, "Only the sender can edit a message.", { status: 403 });
    if (m.kind !== "text" || m.forwardedFromId) throw fail(ErrorCode.ValidationFailed, "This message can't be edited.");
    const [row] = await this.ctx.db.update(vibexMessages).set({ text: text.trim(), editedAt: this.ctx.now() }).where(eq(vibexMessages.id, m.id)).returning();
    await this.messageChanged(m.conversationId, m.id);
    return (await this.messageDtos(userId, [row!])).get(row!.id)!;
  }

  private async messageChanged(conversationId: string, messageId: string) {
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const u of members) {
      this.ctx.events.toUser(u.userId, { type: "vibex.message.updated", conversationId, messageId });
      this.ctx.events.toUser(u.userId, { type: "vibex.chats", conversationId });
    }
  }

  /**
   * Step 2.10: delete several messages at once. "me": any message of my chats
   * leaves my history only; "all": every one must be my own (checked per
   * message; one that isn't refuses the whole request).
   */
  async deleteMessages(userId: string, ids: string[], scope: "me" | "all") {
    const unique = [...new Set(ids)];
    const rows = await this.ctx.db.select().from(vibexMessages).where(and(inArray(vibexMessages.id, unique), isNull(vibexMessages.deletedAt)));
    const convs = [...new Set(rows.map((r) => r.conversationId))];
    for (const c of convs) await this.membership(userId, c);
    if (scope === "all") {
      if (rows.some((r) => r.senderId !== userId)) throw fail(ErrorCode.Forbidden, "Only the sender can delete a message for everyone.", { status: 403 });
      for (const r of rows) await this.deleteMessage(userId, r.id);
      return { ok: true, deleted: rows.length };
    }
    if (rows.length) {
      await this.ctx.db
        .insert(vibexMessageHides)
        .values(rows.map((r) => ({ messageId: r.id, userId })))
        .onConflictDoNothing();
    }
    for (const r of rows) this.ctx.events.toUser(userId, { type: "vibex.message.deleted", conversationId: r.conversationId, messageId: r.id });
    for (const c of convs) this.ctx.events.toUser(userId, { type: "vibex.chats", conversationId: c });
    return { ok: true, deleted: rows.length };
  }

  /**
   * Step 2.10: forward messages (oldest first) to one or more chats. Each copy
   * keeps its text, files, shared post or Notes card and shows who wrote the
   * original; the usual "who can message me" rules apply in every chat.
   */
  async forward(userId: string, messageIds: string[], conversationIds: string[]) {
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      .where(and(inArray(vibexMessages.id, [...new Set(messageIds)]), isNull(vibexMessages.deletedAt), this.notHiddenFor(userId)))
      .orderBy(asc(vibexMessages.createdAt), asc(vibexMessages.id));
    if (!rows.length) throw notFound("Message");
    for (const c of new Set(rows.map((r) => r.conversationId))) {
      const me = await this.membership(userId, c);
      if (rows.some((r) => r.conversationId === c && me.clearedAt && r.createdAt <= me.clearedAt)) throw notFound("Message");
    }
    const targets = [...new Set(conversationIds)];
    for (const t of targets) await this.membership(userId, t);
    let sent = 0;
    for (const t of targets) {
      for (const r of rows) {
        await this.send(userId, t, {
          text: r.text,
          fileIds: [],
          kind: r.kind,
          durationMs: r.durationMs ?? undefined,
          sharedPostId: r.sharedPost && r.sharedPostId ? r.sharedPostId : undefined,
          notesCard: r.notesCard ?? undefined,
          forwardOf: r,
        });
        sent++;
      }
    }
    return { ok: true, sent };
  }

  /** Who may pin in this chat (direct: either person; groups: the owner). */
  private async pinRights(userId: string, conversationId: string) {
    const me = await this.membership(userId, conversationId);
    const [conv] = await this.ctx.db.select({ kind: vibexConversations.kind }).from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    if (!conv) throw notFound("Chat");
    if (conv.kind === "group" && me.role !== "owner") throw fail(ErrorCode.Forbidden, "Only the group's creator can pin messages.", { status: 403 });
  }

  /** The conversation keeps its newest pin in `pinned_message_id` (older apps show that one). */
  private async syncNewestPin(conversationId: string, db: Db | Tx = this.ctx.db) {
    const [last] = await db
      .select({ id: vibexPins.messageId })
      .from(vibexPins)
      .innerJoin(vibexMessages, eq(vibexMessages.id, vibexPins.messageId))
      .where(and(eq(vibexPins.conversationId, conversationId), isNull(vibexMessages.deletedAt)))
      .orderBy(desc(vibexPins.pinnedAt))
      .limit(1);
    await db.update(vibexConversations).set({ pinnedMessageId: last?.id ?? null }).where(eq(vibexConversations.id, conversationId));
  }

  private async pinsChanged(conversationId: string) {
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const u of members) this.ctx.events.toUser(u.userId, { type: "vibex.chats", conversationId });
  }

  /** Update 2 · C1: pins one more message in the chat (at most 100; pinning a pinned one changes nothing). */
  async addPin(userId: string, conversationId: string, messageId: string): Promise<VibexChatDto> {
    await this.pinRights(userId, conversationId);
    const [m] = await this.ctx.db
      .select({ id: vibexMessages.id })
      .from(vibexMessages)
      .where(and(eq(vibexMessages.id, messageId), eq(vibexMessages.conversationId, conversationId), isNull(vibexMessages.deletedAt)));
    if (!m) throw notFound("Message");
    await this.ctx.db.transaction(async (tx) => {
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(vibexPins).where(eq(vibexPins.conversationId, conversationId));
      const n = count?.n ?? 0;
      const exists = await tx.select({ id: vibexPins.messageId }).from(vibexPins).where(and(eq(vibexPins.conversationId, conversationId), eq(vibexPins.messageId, messageId)));
      if (exists.length) return;
      if (n >= VIBEX_PINS_MAX) throw fail(ErrorCode.ValidationFailed, `At most ${VIBEX_PINS_MAX} pinned messages in a chat.`);
      await tx.insert(vibexPins).values({ conversationId, messageId, pinnedBy: userId, pinnedAt: this.ctx.now() }).onConflictDoNothing();
      await this.syncNewestPin(conversationId, tx);
    });
    await this.pinsChanged(conversationId);
    return this.chat(userId, conversationId);
  }

  /** Update 2 · C1: unpins one message. */
  async removePin(userId: string, conversationId: string, messageId: string): Promise<VibexChatDto> {
    await this.pinRights(userId, conversationId);
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(vibexPins).where(and(eq(vibexPins.conversationId, conversationId), eq(vibexPins.messageId, messageId)));
      await this.syncNewestPin(conversationId, tx);
    });
    await this.pinsChanged(conversationId);
    return this.chat(userId, conversationId);
  }

  /** Step 2.10 (older apps): a message adds a pin; null unpins every one. */
  async pinMessage(userId: string, conversationId: string, messageId: string | null): Promise<VibexChatDto> {
    if (messageId) return this.addPin(userId, conversationId, messageId);
    await this.pinRights(userId, conversationId);
    await this.ctx.db.transaction(async (tx) => {
      await tx.delete(vibexPins).where(eq(vibexPins.conversationId, conversationId));
      await tx.update(vibexConversations).set({ pinnedMessageId: null }).where(eq(vibexConversations.id, conversationId));
    });
    await this.pinsChanged(conversationId);
    return this.chat(userId, conversationId);
  }

  /**
   * Update 2 · C4: clear a chat's history. "me": it is gone for me only (the chat stays in my list);
   * "all" (direct: either person; groups: the owner): every message and its files are deleted for
   * everyone, the chat itself stays.
   */
  async clearChat(userId: string, conversationId: string, scope: "me" | "all") {
    const me = await this.membership(userId, conversationId);
    const now = this.ctx.now();
    if (scope === "me") {
      await this.ctx.db.update(vibexMembers).set({ clearedAt: now, lastReadAt: now }).where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      this.ctx.events.toUser(userId, { type: "vibex.chats", conversationId });
      await this.notifications?.markTargetRead(userId, "chatId", conversationId);
      return { ok: true };
    }
    const [conv] = await this.ctx.db.select().from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    if (!conv) throw notFound("Chat");
    if (!canDeleteChatForAll({ kind: conv.kind, group: conv.kind === "group" ? ({ role: me.role } as VibexChatDto["group"]) : null })) {
      throw fail(ErrorCode.Forbidden, "Only the group's owner can clear it for everyone.", { status: 403 });
    }
    await this.ctx.db.transaction(async (tx) => {
      const files = await tx
        .select({ key: vibexFiles.storageKey })
        .from(vibexFiles)
        .innerJoin(vibexMessages, eq(vibexMessages.id, vibexFiles.messageId))
        .where(eq(vibexMessages.conversationId, conversationId));
      await tx.update(vibexConversations).set({ pinnedMessageId: null }).where(eq(vibexConversations.id, conversationId));
      // Files, pins and hides of these messages go with them (ON DELETE cascade).
      await tx.delete(vibexMessages).where(eq(vibexMessages.conversationId, conversationId));
      await this.ctx.blobs.delete(files.map((f) => f.key), tx);
    });
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    for (const m of members) this.ctx.events.toUser(m.userId, { type: "vibex.chats", conversationId });
    await this.notifications?.removeTarget("chatId", conversationId);
    return { ok: true };
  }

  /** What of a chat's history I can see (not deleted, not deleted for me, after my "delete for me"). */
  private async visibleIn(userId: string, conversationId: string): Promise<SQL> {
    const me = await this.membership(userId, conversationId);
    return and(eq(vibexMessages.conversationId, conversationId), isNull(vibexMessages.deletedAt), me.clearedAt ? gt(vibexMessages.createdAt, me.clearedAt) : undefined, this.notHiddenFor(userId))!;
  }

  /** Update 2 · C4: messages of one chat whose text contains `q`, newest first. */
  async searchInChat(userId: string, conversationId: string, q: string, cursor?: string, limit = 30): Promise<VibexPage<VibexMessageDto>> {
    const where = await this.visibleIn(userId, conversationId);
    const c = decodeCursor(cursor);
    const needle = `%${q.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      .where(and(where, ilike(vibexMessages.text, needle), olderThan(vibexMessages, c)))
      .orderBy(desc(vibexMessages.createdAt), desc(vibexMessages.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.messageDtos(userId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  /**
   * Update 2 · C5: one page of a chat info tab, newest first — the messages carrying that kind of
   * content (pictures and videos, files, music, voice and video circles, links, GIFs).
   */
  async chatMedia(userId: string, conversationId: string, kind: VibexChatMediaKind, cursor?: string, limit = 30): Promise<VibexPage<VibexMessageDto>> {
    const where = await this.visibleIn(userId, conversationId);
    const c = decodeCursor(cursor);
    const hasFile = (cond: SQL) => sql`EXISTS (SELECT 1 FROM vibex_files f WHERE f.message_id = ${vibexMessages.id} AND ${cond})`;
    const filter: SQL =
      // Update 3 · E1: a video circle carries a video file too; «Медиа» is photos and video files sent as
      // ordinary messages only (circles and voice are in «Голосовые и видео»).
      kind === "media"
        ? and(eq(vibexMessages.kind, "text"), hasFile(sql`(f.mime_type LIKE 'image/%' OR f.mime_type LIKE 'video/%') AND f.mime_type <> 'image/gif'`))!
        : kind === "gifs"
          ? and(eq(vibexMessages.kind, "text"), hasFile(sql`f.mime_type = 'image/gif'`))!
          : kind === "music"
            ? and(eq(vibexMessages.kind, "text"), hasFile(sql`f.mime_type LIKE 'audio/%'`))!
            : kind === "voice"
              ? inArray(vibexMessages.kind, ["voice", "circle"])
              : kind === "links"
                ? sql`${vibexMessages.text} ~* 'https?://[^[:space:]]+'`
                : and(eq(vibexMessages.kind, "text"), hasFile(sql`f.mime_type NOT LIKE 'image/%' AND f.mime_type NOT LIKE 'video/%' AND f.mime_type NOT LIKE 'audio/%'`))!;
    const rows = await this.ctx.db
      .select()
      .from(vibexMessages)
      .where(and(where, filter, olderThan(vibexMessages, c)))
      .orderBy(desc(vibexMessages.createdAt), desc(vibexMessages.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const dtos = await this.messageDtos(userId, items);
    return { items: items.map((r) => dtos.get(r.id)!), next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
  }

  /** Update 2 · C6: the person behind a profile link (@handle); someone who blocked the viewer is not found. */
  async personByHandle(viewerId: string, handle: string): Promise<VibexPersonDto> {
    const local = handle.replace(/^@/, "").trim().toLowerCase();
    const [row] = await this.ctx.db
      .select({ id: mailAccounts.userId })
      .from(mailAccounts)
      .innerJoin(users, eq(users.id, mailAccounts.userId))
      .where(and(eq(mailAccounts.localPart, local), eq(mailAccounts.isPrimary, true), eq(users.status, "active")));
    if (!row) throw notFound("User");
    if (row.id !== viewerId && (await this.settings(row.id)).privacy.blocked.includes(viewerId)) throw notFound("User");
    return this.person(row.id);
  }

  /**
   * Step 2.5: the viewer saw these posts. Counted once per person and post;
   * the author's own views and posts the viewer can't see are ignored.
   */
  async view(viewerId: string, postIds: string[]) {
    const ids = [...new Set(postIds)];
    if (!ids.length) return { ok: true };
    const rows = await this.ctx.db
      .select({ id: vibexPosts.id, authorId: vibexPosts.authorId })
      .from(vibexPosts)
      .where(and(inArray(vibexPosts.id, ids), isNull(vibexPosts.deletedAt), ne(vibexPosts.authorId, viewerId)));
    const allowed: string[] = [];
    for (const r of rows) if (await this.canSee(viewerId, r.authorId, "posts")) allowed.push(r.id);
    if (allowed.length) {
      await this.ctx.db
        .insert(vibexPostViews)
        .values(allowed.map((postId) => ({ postId, viewerId })))
        .onConflictDoNothing();
    }
    return { ok: true };
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

  // ------------------------------------------------------- Step 2.9: chats

  /** My settings of one chat: notifications on / off. */
  async updateChat(userId: string, conversationId: string, input: { muted: boolean }): Promise<VibexChatDto> {
    await this.membership(userId, conversationId);
    await this.ctx.db
      .update(vibexMembers)
      .set({ muted: input.muted })
      .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
    this.ctx.events.toUser(userId, { type: "vibex.chats", conversationId });
    return this.chat(userId, conversationId);
  }

  /**
   * "Удалить у себя": the history up to now disappears for me only and the
   * chat leaves my list (a new message brings it back, from that message on).
   * "Удалить у всех": the chat and everything in it is removed for every
   * member — either person of a direct chat, or a group's owner; anyone else
   * gets 403.
   */
  async deleteChat(userId: string, conversationId: string, scope: "me" | "all") {
    const me = await this.membership(userId, conversationId);
    const [conv] = await this.ctx.db.select().from(vibexConversations).where(eq(vibexConversations.id, conversationId));
    if (!conv) throw notFound("Chat");
    const members = await this.ctx.db.select({ userId: vibexMembers.userId }).from(vibexMembers).where(eq(vibexMembers.conversationId, conversationId));
    if (scope === "me") {
      await this.ctx.db
        .update(vibexMembers)
        .set({ clearedAt: this.ctx.now(), hidden: true, pinnedPosition: null, lastReadAt: this.ctx.now() })
        .where(and(eq(vibexMembers.conversationId, conversationId), eq(vibexMembers.userId, userId)));
      this.ctx.events.toUser(userId, { type: "vibex.chats", conversationId });
      await this.notifications?.markTargetRead(userId, "chatId", conversationId);
      return { ok: true };
    }
    if (!canDeleteChatForAll({ kind: conv.kind, group: conv.kind === "group" ? { role: me.role } as VibexChatDto["group"] : null })) {
      throw fail(ErrorCode.Forbidden, "Only the group's owner can delete it for everyone.", { status: 403 });
    }
    await this.ctx.db.transaction(async (tx) => {
      const files = await tx
        .select({ key: vibexFiles.storageKey })
        .from(vibexFiles)
        .innerJoin(vibexMessages, eq(vibexMessages.id, vibexFiles.messageId))
        .where(eq(vibexMessages.conversationId, conversationId));
      // Members, messages and their files go with the conversation (ON DELETE cascade).
      await tx.delete(vibexConversations).where(eq(vibexConversations.id, conversationId));
      await this.ctx.blobs.delete(files.map((f) => f.key), tx);
    });
    for (const m of members) this.ctx.events.toUser(m.userId, { type: "vibex.chats", conversationId });
    await this.notifications?.removeTarget("chatId", conversationId);
    return { ok: true };
  }

  /**
   * Search in my chats: people by name or @voidops address, groups by title,
   * and messages by their text (what I can still see of each chat).
   */
  async searchChats(userId: string, q: string): Promise<VibexChatSearchDto> {
    const query = q.replace(/^@/, "").trim().toLowerCase();
    if (!query) return { chats: [], messages: [] };
    const all = await this.chats(userId);
    const has = (v: string | undefined | null) => !!v && v.toLowerCase().includes(query);
    // A chat named like the query (person or group title) comes before a group that only has such a member.
    const rank = (c: VibexChatDto) =>
      c.group
        ? has(c.group.title)
          ? 0
          : c.group.members.some((m) => m.id !== userId && (has(m.name) || has(m.address)))
            ? 1
            : -1
        : has(c.peer?.name) || has(c.peer?.handle) || has(c.peer?.address)
          ? 0
          : -1;
    const chats = all
      .map((c) => ({ c, r: rank(c) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.c);
    const ids = all.map((c) => c.id);
    let messages: VibexChatSearchDto["messages"] = [];
    if (ids.length) {
      const rows = await this.ctx.db
        .select({ m: vibexMessages })
        .from(vibexMessages)
        .innerJoin(vibexMembers, and(eq(vibexMembers.conversationId, vibexMessages.conversationId), eq(vibexMembers.userId, userId)))
        .where(
          and(
            inArray(vibexMessages.conversationId, ids),
            isNull(vibexMessages.deletedAt),
            eq(vibexMessages.kind, "text"),
            or(isNull(vibexMembers.clearedAt), gt(vibexMessages.createdAt, vibexMembers.clearedAt)),
            ilike(vibexMessages.text, `%${escapeLike(query)}%`),
          ),
        )
        .orderBy(desc(vibexMessages.createdAt))
        .limit(20);
      const dtos = await this.messageDtos(userId, rows.map((r) => r.m));
      const byId = new Map(all.map((c) => [c.id, c]));
      messages = rows.map((r) => ({ chat: byId.get(r.m.conversationId)!, message: dtos.get(r.m.id)! })).filter((x) => x.chat && x.message);
    }
    return { chats, messages };
  }

  // ----------------------------------------------------- Step 2.9: stories

  private async storyDtos(viewerId: string, rows: StoryRow[]): Promise<VibexStoryDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [people, files, seen, counts] = await Promise.all([
      this.persons(rows.map((r) => r.ownerId)),
      this.ctx.db.select().from(vibexFiles).where(inArray(vibexFiles.id, rows.map((r) => r.fileId))),
      this.ctx.db
        .select({ id: vibexStoryViews.storyId, reaction: vibexStoryViews.reaction })
        .from(vibexStoryViews)
        .where(and(inArray(vibexStoryViews.storyId, ids), eq(vibexStoryViews.viewerId, viewerId))),
      // Step 2.12: the author's own view (kept for their seen / unseen ring) is never counted.
      this.ctx.db
        .select({ id: vibexStoryViews.storyId, n: sql<number>`count(*)::int`, r: sql<number>`count(${vibexStoryViews.reaction})::int` })
        .from(vibexStoryViews)
        .innerJoin(vibexStories, eq(vibexStories.id, vibexStoryViews.storyId))
        .where(and(inArray(vibexStoryViews.storyId, ids), ne(vibexStoryViews.viewerId, vibexStories.ownerId)))
        .groupBy(vibexStoryViews.storyId),
    ]);
    const fileBy = new Map(files.map((f) => [f.id, fileDto(f)]));
    const seenSet = new Set(seen.map((r) => r.id));
    const reactionBy = new Map(seen.map((r) => [r.id, r.reaction]));
    const countBy = new Map(counts.map((r) => [r.id, r.n]));
    const reactedBy = new Map(counts.map((r) => [r.id, r.r]));
    const now = this.ctx.now();
    return rows
      .filter((r) => people.has(r.ownerId) && fileBy.has(r.fileId))
      .map((r) => {
        const mine = r.ownerId === viewerId;
        return {
          id: r.id,
          owner: people.get(r.ownerId)!,
          file: fileBy.get(r.fileId)!,
          kind: r.kind,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          archived: r.expiresAt <= now,
          // Step 2.12: my own story too is "seen" only once I watched it (its ring turns grey).
          seen: seenSet.has(r.id),
          views: mine ? (countBy.get(r.id) ?? 0) : 0,
          mine,
          myReaction: mine ? null : (reactionBy.get(r.id) ?? null),
          reactions: mine ? (reactedBy.get(r.id) ?? 0) : 0,
        };
      });
  }

  /** Publishes a story from my uploaded photo / video (purpose "story"); it lives 24 hours. */
  async createStory(ownerId: string, fileId: string): Promise<VibexStoryDto> {
    await this.ensureProfile(ownerId);
    const now = this.ctx.now();
    const row = await this.ctx.db.transaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(vibexFiles)
        .where(and(eq(vibexFiles.id, fileId), eq(vibexFiles.ownerId, ownerId), eq(vibexFiles.purpose, "story"), isNull(vibexFiles.messageId), isNull(vibexFiles.postId)));
      if (!f) throw notFound("File");
      const [taken] = await tx.select({ id: vibexStories.id }).from(vibexStories).where(eq(vibexStories.fileId, f.id));
      if (taken) throw fail(ErrorCode.ValidationFailed, "This file is already a story.");
      const kind = VIBEX_POST_VIDEO_TYPES.includes(f.mimeType) ? ("video" as const) : ("photo" as const);
      const [st] = await tx
        .insert(vibexStories)
        .values({ ownerId, fileId: f.id, kind, createdAt: now, expiresAt: new Date(now.getTime() + VIBEX_STORY_TTL_MS) })
        .returning();
      return st!;
    });
    for (const u of await this.storyAudience(ownerId)) this.ctx.events.toUser(u, { type: "vibex.stories", userId: ownerId });
    await this.activityToFollowers(ownerId, "story", { storyId: row.id });
    return (await this.storyDtos(ownerId, [row]))[0]!;
  }

  /** Who gets my story in their header: me, my followers and the people I have a direct chat with. */
  private async storyAudience(ownerId: string): Promise<string[]> {
    const [followers, peers] = await Promise.all([
      this.ctx.db.select({ id: vibexFollows.followerId }).from(vibexFollows).where(eq(vibexFollows.followeeId, ownerId)),
      this.directPeers(ownerId),
    ]);
    return [...new Set([ownerId, ...followers.map((f) => f.id), ...peers])];
  }

  // ------------------------------------------------------- Step 2.10 activity

  /**
   * Records one item of someone's Vibex activity and tells their devices. A
   * like / follow / repost by the same person replaces the earlier one (it
   * moves to the top); nothing about yourself or from someone you blocked.
   */
  private async recordActivity(
    userId: string,
    actorId: string,
    type: VibexActivityType,
    refs: { postId?: string; conversationId?: string; storyId?: string; commentId?: string } = {},
  ) {
    if (userId === actorId) return;
    if ((await this.settings(userId)).privacy.blocked.includes(actorId)) return;
    if (type === "follow" || type === "like" || type === "repost") await this.dropActivity(userId, actorId, type, refs.postId, false);
    await this.ctx.db.insert(vibexActivity).values({
      userId,
      actorId,
      type,
      postId: refs.postId ?? null,
      conversationId: refs.conversationId ?? null,
      storyId: refs.storyId ?? null,
      commentId: refs.commentId ?? null,
      createdAt: this.ctx.now(),
    });
    await this.activityChanged(userId);
  }

  /** An undone like / follow / repost leaves the activity too. */
  private async dropActivity(userId: string, actorId: string, type: VibexActivityType, postId?: string, notify = true) {
    const gone = await this.ctx.db
      .delete(vibexActivity)
      .where(and(eq(vibexActivity.userId, userId), eq(vibexActivity.actorId, actorId), eq(vibexActivity.type, type), postId ? eq(vibexActivity.postId, postId) : undefined))
      .returning({ id: vibexActivity.id });
    if (gone.length && notify) await this.activityChanged(userId);
  }

  /** A new post or story: one item for each follower. */
  private async activityToFollowers(authorId: string, type: "post" | "story", refs: { postId?: string; storyId?: string }) {
    const followers = await this.ctx.db.select({ id: vibexFollows.followerId }).from(vibexFollows).where(eq(vibexFollows.followeeId, authorId));
    for (const f of followers) await this.recordActivity(f.id, authorId, type, refs);
  }

  private async activityUnread(userId: string): Promise<number> {
    const [{ n }] = (await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(vibexActivity)
      .where(and(eq(vibexActivity.userId, userId), isNull(vibexActivity.readAt)))) as [{ n: number }];
    return n;
  }

  private async activityChanged(userId: string) {
    this.ctx.events.toUser(userId, { type: "vibex.activity", unread: await this.activityUnread(userId) });
  }

  /** The activity tab, newest first (the client groups it: today, yesterday, this week, earlier). */
  async activity(userId: string, cursor?: string, limit = 40): Promise<VibexActivityPageDto> {
    const c = decodeCursor(cursor);
    const rows = await this.ctx.db
      .select()
      .from(vibexActivity)
      .where(
        and(
          eq(vibexActivity.userId, userId),
          c ? or(lt(vibexActivity.createdAt, c.at), and(eq(vibexActivity.createdAt, c.at), lt(vibexActivity.id, c.id))) : undefined,
        ),
      )
      .orderBy(desc(vibexActivity.createdAt), desc(vibexActivity.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const actors = await this.persons([...new Set(items.map((r) => r.actorId))]);
    const postIds = [...new Set(items.map((r) => r.postId).filter((x): x is string => !!x))];
    const posts = postIds.length ? await this.ctx.db.select().from(vibexPosts).where(and(inArray(vibexPosts.id, postIds), isNull(vibexPosts.deletedAt))) : [];
    const postBy = new Map(posts.map((p) => [p.id, p]));
    const media = await this.filesOf("postId", postIds);
    const convIds = [...new Set(items.map((r) => r.conversationId).filter((x): x is string => !!x))];
    const convs = convIds.length ? await this.ctx.db.select({ id: vibexConversations.id, title: vibexConversations.title }).from(vibexConversations).where(inArray(vibexConversations.id, convIds)) : [];
    const convBy = new Map(convs.map((c) => [c.id, c.title]));
    const followed = new Set(
      (
        await this.ctx.db
          .select({ id: vibexFollows.followeeId })
          .from(vibexFollows)
          .where(and(eq(vibexFollows.followerId, userId), inArray(vibexFollows.followeeId, [...actors.keys(), userId])))
      ).map((f) => f.id),
    );
    const out: VibexActivityDto[] = [];
    for (const r of items) {
      const actor = actors.get(r.actorId);
      if (!actor) continue;
      const post = r.postId ? postBy.get(r.postId) : undefined;
      // A post that is gone (or a story / chat that is) leaves nothing to show.
      if (r.postId && !post) continue;
      const first = r.postId ? (media.get(r.postId) ?? []).find((f) => f.kind === "image" || f.kind === "video") : undefined;
      out.push({
        id: r.id,
        type: r.type,
        actor,
        createdAt: r.createdAt.toISOString(),
        read: !!r.readAt,
        following: followed.has(r.actorId),
        postId: r.postId,
        postMedia: first ? { fileId: first.id, kind: first.kind as "image" | "video" } : null,
        postText: post?.text.slice(0, 140) ?? "",
        chatId: r.conversationId,
        chatTitle: r.conversationId ? (convBy.get(r.conversationId) ?? null) : null,
        storyId: r.storyId,
        commentId: r.commentId,
      });
    }
    return { items: out, next: more ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null, unread: await this.activityUnread(userId) };
  }

  /** The tab was opened: everything in it is read (on every device). */
  async readActivity(userId: string) {
    await this.ctx.db.update(vibexActivity).set({ readAt: this.ctx.now() }).where(and(eq(vibexActivity.userId, userId), isNull(vibexActivity.readAt)));
    await this.activityChanged(userId);
    return { ok: true, unread: 0 };
  }

  async activityCount(userId: string) {
    return { unread: await this.activityUnread(userId) };
  }

  // --------------------------------------------------------- Step 2.10 search

  /**
   * The Search tab: people (an exact @username / address first, then names
   * that start with the query, then the rest), then posts whose text has it
   * (a "#tag" finds posts with that tag).
   */
  async search(viewerId: string, q: string): Promise<VibexSearchDto> {
    const query = q.trim();
    if (!query) return { people: [], posts: [] };
    const bare = query.replace(/^@/, "").toLowerCase();
    const found = query.startsWith("#") ? [] : await this.people(viewerId, query);
    const rank = (p: VibexPersonDto) => {
      const handle = p.handle.toLowerCase();
      if (handle === bare || p.address.toLowerCase() === bare) return 0;
      if (handle.startsWith(bare)) return 1;
      const name = p.name.toLowerCase();
      if (name === bare || name.startsWith(bare) || p.lastName.toLowerCase().startsWith(bare)) return 2;
      return 3;
    };
    const people = found.map((p, i) => ({ p, r: rank(p), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
    const posts = await this.page(viewerId, and(eq(vibexPosts.kind, "post"), ilike(vibexPosts.text, `%${escapeLike(query)}%`)), undefined, 30);
    const following = people.length
      ? (
          await this.ctx.db
            .select({ id: vibexFollows.followeeId })
            .from(vibexFollows)
            .where(and(eq(vibexFollows.followerId, viewerId), inArray(vibexFollows.followeeId, people.map((p) => p.id))))
        ).map((r) => r.id)
      : [];
    return { people, posts: posts.items, following };
  }

  /** The Search tab's grid: everyone's public posts with a picture or a video, newest first (not mine). */
  explore(viewerId: string, cursor?: string, limit = 30) {
    const types = [...VIBEX_POST_IMAGE_TYPES, ...VIBEX_POST_VIDEO_TYPES];
    const withMedia = sql`EXISTS (SELECT 1 FROM vibex_files f WHERE f.post_id = ${vibexPosts.id} AND f.mime_type IN (${sql.join(
      types.map((t) => sql`${t}`),
      sql`, `,
    )}))`;
    return this.page(viewerId, and(eq(vibexPosts.kind, "post"), ne(vibexPosts.authorId, viewerId), withMedia), cursor, limit);
  }

  private async directPeers(userId: string): Promise<string[]> {
    const rows = await this.ctx.db.execute<{ id: string }>(sql`
      SELECT DISTINCT peer.user_id AS id
        FROM vibex_members me
        JOIN vibex_conversations c ON c.id = me.conversation_id AND c.kind = 'direct'
        JOIN vibex_members peer ON peer.conversation_id = c.id AND peer.user_id <> me.user_id
       WHERE me.user_id = ${userId}`);
    return rows.rows.map((r) => r.id);
  }

  /**
   * The stories header of "Чаты": live stories of the people I follow or
   * chat with (and mine, always first), each person's unseen ones first in
   * the row. Stories past their 24 hours are not here.
   */
  async storyFeed(viewerId: string): Promise<VibexStoryGroupDto[]> {
    const [follows, peers] = await Promise.all([
      this.ctx.db.select({ id: vibexFollows.followeeId }).from(vibexFollows).where(eq(vibexFollows.followerId, viewerId)),
      this.directPeers(viewerId),
    ]);
    const owners = [...new Set([viewerId, ...follows.map((f) => f.id), ...peers])];
    const now = this.ctx.now();
    const rows = await this.ctx.db
      .select()
      .from(vibexStories)
      .where(and(inArray(vibexStories.ownerId, owners), isNull(vibexStories.deletedAt), gt(vibexStories.expiresAt, now)))
      .orderBy(asc(vibexStories.createdAt))
      .limit(500);
    const settings = await this.settingsOf(owners);
    const visible: StoryRow[] = [];
    for (const r of rows) if (r.ownerId === viewerId || (await this.canSee(viewerId, r.ownerId, "posts", settings.get(r.ownerId)))) visible.push(r);
    const dtos = await this.storyDtos(viewerId, visible);
    const groups = new Map<string, VibexStoryGroupDto>();
    for (const d of dtos) {
      const g = groups.get(d.owner.id) ?? { person: d.owner, stories: [], seen: true, mine: d.mine };
      g.stories.push(d);
      g.seen = g.seen && d.seen;
      groups.set(d.owner.id, g);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (a.seen !== b.seen) return a.seen ? 1 : -1;
      return b.stories.at(-1)!.createdAt.localeCompare(a.stories.at(-1)!.createdAt);
    });
  }

  /** My stories that are past their 24 hours (the archive), newest first. */
  async storyArchive(ownerId: string): Promise<VibexStoryDto[]> {
    const rows = await this.ctx.db
      .select()
      .from(vibexStories)
      .where(and(eq(vibexStories.ownerId, ownerId), isNull(vibexStories.deletedAt), lt(vibexStories.expiresAt, this.ctx.now())))
      .orderBy(desc(vibexStories.createdAt))
      .limit(200);
    return this.storyDtos(ownerId, rows);
  }

  /**
   * "Seen": once per person; stories I can't see are refused. Step 2.12: the
   * author's own view is kept too (their ring goes from violet to grey on
   * every device) but never counted as a view nor listed among the viewers.
   */
  async viewStory(viewerId: string, storyId: string) {
    const [st] = await this.ctx.db.select().from(vibexStories).where(eq(vibexStories.id, storyId));
    if (!st || st.deletedAt || (st.ownerId !== viewerId && (st.expiresAt <= this.ctx.now() || !(await this.canSee(viewerId, st.ownerId, "posts"))))) throw notFound("Story");
    const inserted = await this.ctx.db.insert(vibexStoryViews).values({ storyId, viewerId }).onConflictDoNothing().returning();
    if (inserted.length) this.ctx.events.toUser(st.ownerId, { type: "vibex.stories", userId: st.ownerId });
    return { ok: true };
  }

  /** Who saw my story (its author only). */
  async storyViewers(ownerId: string, storyId: string): Promise<VibexStoryViewerDto[]> {
    const [st] = await this.ctx.db.select().from(vibexStories).where(and(eq(vibexStories.id, storyId), eq(vibexStories.ownerId, ownerId)));
    if (!st) throw notFound("Story");
    const rows = await this.ctx.db
      .select()
      .from(vibexStoryViews)
      .where(and(eq(vibexStoryViews.storyId, storyId), ne(vibexStoryViews.viewerId, ownerId)))
      .orderBy(desc(vibexStoryViews.viewedAt));
    const people = await this.persons(rows.map((r) => r.viewerId));
    return rows
      .filter((r) => people.has(r.viewerId))
      .map((r) => ({ person: people.get(r.viewerId)!, viewedAt: r.viewedAt.toISOString(), reaction: r.reaction ?? null, reactedAt: r.reactedAt?.toISOString() ?? null }));
  }

  /** A story someone else posted that I may see right now (live, not deleted, allowed by its author). */
  private async visibleStory(viewerId: string, storyId: string) {
    const [st] = await this.ctx.db.select().from(vibexStories).where(eq(vibexStories.id, storyId));
    if (!st || st.deletedAt || st.ownerId === viewerId || st.expiresAt <= this.ctx.now() || !(await this.canSee(viewerId, st.ownerId, "posts"))) throw notFound("Story");
    return st;
  }

  /**
   * Step 2.11: my reaction to a story (one per person: a new one replaces the
   * old, null takes it back). A reaction counts as a view; the author sees it
   * in the viewers list. No message and no duplicate events.
   */
  async reactStory(viewerId: string, storyId: string, reaction: string | null) {
    const st = await this.visibleStory(viewerId, storyId);
    const now = this.ctx.now();
    const [before] = await this.ctx.db.select({ reaction: vibexStoryViews.reaction }).from(vibexStoryViews).where(and(eq(vibexStoryViews.storyId, st.id), eq(vibexStoryViews.viewerId, viewerId)));
    await this.ctx.db
      .insert(vibexStoryViews)
      .values({ storyId: st.id, viewerId, reaction, reactedAt: reaction ? now : null })
      .onConflictDoUpdate({ target: [vibexStoryViews.storyId, vibexStoryViews.viewerId], set: { reaction, reactedAt: reaction ? now : null } });
    if ((before?.reaction ?? null) !== reaction || !before) this.ctx.events.toUser(st.ownerId, { type: "vibex.stories", userId: st.ownerId });
    return { reaction };
  }

  /**
   * Step 2.11: a reply to a story is a direct message to its author that
   * refers to the story (the chat is created if there is none yet). Replying
   * also counts as a view.
   */
  async replyStory(viewerId: string, storyId: string, text: string): Promise<{ chatId: string; message: VibexMessageDto }> {
    const st = await this.visibleStory(viewerId, storyId);
    await this.ctx.db.insert(vibexStoryViews).values({ storyId: st.id, viewerId }).onConflictDoNothing();
    const chat = await this.openDirect(viewerId, st.ownerId);
    const message = await this.send(viewerId, chat.id, { text, fileIds: [], storyId: st.id });
    return { chatId: chat.id, message };
  }

  /** The author removes a story (live or archived); its file goes with it. */
  async deleteStory(ownerId: string, storyId: string) {
    const [st] = await this.ctx.db
      .update(vibexStories)
      .set({ deletedAt: this.ctx.now() })
      .where(and(eq(vibexStories.id, storyId), eq(vibexStories.ownerId, ownerId), isNull(vibexStories.deletedAt)))
      .returning();
    if (!st) throw notFound("Story");
    const files = await this.ctx.db.select({ key: vibexFiles.storageKey }).from(vibexFiles).where(eq(vibexFiles.id, st.fileId));
    // The row keeps its id for views already counted; the picture itself is gone.
    await this.ctx.blobs.delete(files.map((f) => f.key));
    for (const u of await this.storyAudience(ownerId)) this.ctx.events.toUser(u, { type: "vibex.stories", userId: ownerId });
    return { ok: true };
  }
}
