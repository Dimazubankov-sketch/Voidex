import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  RiCameraLine,
  RiChat1Line,
  RiCloseLine,
  RiEditLine,
  RiImageEditLine,
  RiLink,
  RiMapPin2Line,
  RiMore2Fill,
  RiUserAddLine,
  RiUserFollowLine,
  RiUserForbidLine,
  RiUserSearchLine,
} from "@remixicon/react";
import { VIBEX_BIO_MAX, VIBEX_CITY_MAX, VIBEX_WEBSITE_MAX, type VibexFileDto, type VibexPersonDto, type VibexProfileDto } from "@voidex/shared";
import { Avatar } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Button, EmptyState, Skeleton, Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import {
  openDirect,
  useCoverUrl,
  useFollow,
  useFollowList,
  usePersonMedia,
  usePersonPosts,
  useProfile,
  useUpdateProfile,
  useUpdateSettings,
  useVibexMe,
  uploadAvatar,
  uploadCover,
} from "./data";
import { Lightbox, VibexImage, VibexVideoTile } from "./media";
import { PhotoEditor, type PhotoShape } from "./photo-editor";
import { ComposerPrompt, FeedEmpty, PostList } from "./posts";
import { useVibex } from "./store";

/** Soft VOIDEX cover when the person has none (no stock photos): milk and two violets. */
const COVER = "radial-gradient(80% 120% at 85% 0%, #cbbffb 0%, rgba(203,191,251,0) 60%), radial-gradient(60% 90% at 10% 100%, #e6dffb 0%, rgba(230,223,251,0) 70%), #f6f4fc";

function Cover({ person, version, className }: { person: VibexPersonDto; version: number; className?: string }) {
  const { data: src } = useCoverUrl(person.id, version);
  return (
    <div className={cx("relative w-full overflow-hidden", className)} style={src ? undefined : { background: COVER }} data-testid="profile-cover" data-cover={version || undefined}>
      {src && <img src={src} alt="" className="size-full object-cover" draggable={false} />}
    </div>
  );
}

function siteHref(v: string) {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function Pill({ icon, children, onClick, tone = "outline", testId, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; tone?: "outline" | "primary"; testId: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition disabled:opacity-60",
        tone === "primary" ? "bg-primary text-white hover:bg-primary/90" : "border border-border bg-surface text-text hover:bg-surface-hover",
      )}
      data-testid={testId}
    >
      {icon}
      {children}
    </button>
  );
}

/** Voyzen profile: cover, avatar over it, actions; name, email, bio, site, city; counters. */
function ProfileHeader({ profile, onEdit }: { profile: VibexProfileDto; onEdit: () => void }) {
  const t = useT();
  const { person } = profile;
  const openChat = useVibex((s) => s.openChat);
  const follow = useFollow(person.id);
  const me = useVibexMe().data;
  const settings = useUpdateSettings();
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [menu, setMenu] = useState(false);
  const blocked = !!me?.settings.privacy.blocked.includes(person.id);

  const write = async () => {
    setBusy(true);
    try {
      const chat = await openDirect(person.id);
      openChat(chat.id);
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-tile" data-testid="profile-header">
      <Cover person={person} version={profile.coverVersion} className="h-32 sm:h-40" />
      <div className="px-5 pb-4">
        <div className="relative -mt-10 flex flex-wrap items-end justify-between gap-2">
          <span className="inline-flex rounded-full border-4 border-surface bg-surface">
            <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={84} />
          </span>
          <div className="mb-1 flex flex-wrap gap-2">
            {profile.me ? (
              <Pill icon={<RiEditLine className="size-4" />} onClick={onEdit} testId="profile-edit">
                {t("vibex.profile.edit")}
              </Pill>
            ) : (
              <>
                {profile.followed ? (
                  <Pill icon={<RiUserFollowLine className="size-4" />} onClick={() => follow.mutate(false)} testId="profile-unfollow">
                    {t("vibex.profile.following")}
                  </Pill>
                ) : (
                  <Pill tone="primary" icon={<RiUserAddLine className="size-4" />} onClick={() => follow.mutate(true)} disabled={blocked} testId="profile-follow">
                    {t("vibex.profile.follow")}
                  </Pill>
                )}
                {profile.canMessage && (
                  <Pill icon={busy ? <Spinner size={14} /> : <RiChat1Line className="size-4" />} onClick={() => void write()} testId="person-write">
                    {t("vibex.person.write")}
                  </Pill>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenu((m) => !m)}
                    aria-label={t("vibex.profile.more")}
                    className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:bg-surface-hover"
                    data-testid="profile-more"
                  >
                    <RiMore2Fill className="size-4" />
                  </button>
                  {menu && (
                    <div className="vx-glass-strong absolute right-0 top-11 z-10 w-48 rounded-2xl p-1.5" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          const ids = me?.settings.privacy.blocked ?? [];
                          settings.mutate({ privacy: { blocked: blocked ? ids.filter((x) => x !== person.id) : [...ids, person.id] } });
                          if (!blocked && profile.followed) follow.mutate(false);
                        }}
                        className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[14px] text-danger hover:bg-danger-soft"
                        data-testid="profile-block"
                      >
                        <RiUserForbidLine className="size-4" />
                        {blocked ? t("vibex.settings.unblock") : t("vibex.profile.block")}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-3">
          <h1 className="text-[20px] font-bold text-text" data-testid="profile-name">
            {person.name}
          </h1>
          <p className="text-[14px] text-text-secondary" data-selectable data-testid="profile-email">
            {person.address}
          </p>
          {profile.followsMe && <span className="mt-1 inline-block rounded-full bg-surface-secondary px-2 py-0.5 text-[12px] text-text-secondary">{t("vibex.profile.followsYou")}</span>}
        </div>
        {profile.bio && (
          <p className="mt-2.5 whitespace-pre-wrap break-words text-[14.5px] text-text" data-selectable data-testid="profile-bio">
            {profile.bio}
          </p>
        )}
        {(profile.website || profile.city) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-text-secondary">
            {profile.city && (
              <span className="flex items-center gap-1" data-testid="profile-city">
                <RiMapPin2Line className="size-4" /> {profile.city}
              </span>
            )}
            {profile.website && (
              <a href={siteHref(profile.website)} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline" data-testid="profile-website">
                <RiLink className="size-4" /> {profile.website.replace(/^https?:\/\//i, "")}
              </a>
            )}
          </div>
        )}
        <div className="mt-3 flex gap-5 text-[14px] text-text-secondary">
          <span>
            <span className="font-bold text-text" data-testid="profile-posts-count">{profile.posts}</span> {t("vibex.profile.postsCount")}
          </span>
          <button type="button" onClick={() => setList("followers")} className="hover:text-text" data-testid="profile-followers">
            <span className="font-bold text-text" data-testid="profile-followers-count">{profile.followers}</span> {t("vibex.profile.followers")}
          </button>
          <button type="button" onClick={() => setList("following")} className="hover:text-text" data-testid="profile-following">
            <span className="font-bold text-text">{profile.following}</span> {t("vibex.profile.followingCount")}
          </button>
        </div>
      </div>
      <FollowSheet userId={person.id} which={list} onClose={() => setList(null)} />
    </div>
  );
}

function FollowSheet({ userId, which, onClose }: { userId: string; which: "followers" | "following" | null; onClose: () => void }) {
  const t = useT();
  const push = useVibex((s) => s.push);
  const q = useFollowList(userId, which ?? "followers", !!which);
  return (
    <Sheet open={!!which} onClose={onClose} title={which === "following" ? t("vibex.profile.followingCount") : t("vibex.profile.followers")} testId="follow-sheet">
      {q.isPending ? (
        <Spinner className="mx-auto text-text-tertiary" />
      ) : !q.data?.length ? (
        <p className="py-6 text-center text-[14px] text-text-tertiary">{t("vibex.profile.nobody")}</p>
      ) : (
        <div className="flex flex-col">
          {q.data.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onClose();
                push({ kind: "person", id: p.id });
              }}
              className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-hover"
            >
              <Avatar name={p.name} userId={p.id} version={p.avatarVersion} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                <span className="block truncate text-[12.5px] text-text-tertiary">{p.address}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ editor

/**
 * "Edit profile" (Voyzen reference): cover with a picture button, avatar with
 * a camera badge, first / last name, about, website, city. A picked picture
 * first goes through the "Adjust photo" editor; nothing is saved until "Save".
 */
export function ProfileEditor({ profile, open, onClose }: { profile: VibexProfileDto; open: boolean; onClose: () => void }) {
  const t = useT();
  const update = useUpdateProfile();
  const { person } = profile;
  const [form, setForm] = useState({ firstName: person.firstName, lastName: person.lastName, bio: profile.bio, website: profile.website, city: profile.city });
  const [avatar, setAvatar] = useState<{ blob: Blob; url: string } | null>(null);
  const [cover, setCover] = useState<{ blob: Blob; url: string } | null>(null);
  const [editing, setEditing] = useState<{ file: File; shape: PhotoShape } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverUrl = useCoverUrl(person.id, profile.coverVersion).data;

  useEffect(() => {
    if (!open) return;
    setForm({ firstName: person.firstName, lastName: person.lastName, bio: profile.bio, website: profile.website, city: profile.city });
    setAvatar(null);
    setCover(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && !editing && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, editing, onClose]);

  const pick = (shape: PhotoShape) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) {
      toast({ title: t("error.attachment_type_not_allowed"), tone: "danger" });
      return;
    }
    setEditing({ file, shape });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (avatar) await uploadAvatar(avatar.blob);
      if (cover) await uploadCover(cover.blob);
      await update.mutateAsync({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        bio: form.bio,
        website: form.website.trim(),
        city: form.city,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  const field = "h-11 w-full rounded-xl border border-border bg-surface-secondary/60 px-3.5 text-[15px] outline-none transition focus:border-primary/50 focus:bg-surface";

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[220] flex items-end justify-center sm:items-center" data-testid="profile-editor">
            <motion.div className="absolute inset-0 bg-[rgba(20,20,30,0.38)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pe-title"
              className="relative flex max-h-[min(92dvh,760px)] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-window sm:max-w-[440px] sm:rounded-[26px]"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <header className="flex h-14 shrink-0 items-center justify-between px-4">
                <h2 id="pe-title" className="text-[16px] font-semibold">
                  {t("vibex.profile.editTitle")}
                </h2>
                <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-9 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover" data-testid="pe-close">
                  <RiCloseLine className="size-5" />
                </button>
              </header>
              <div className="scroll-area min-h-0 flex-1">
                <div className="relative h-32 bg-primary" style={cover || coverUrl ? undefined : { background: "linear-gradient(135deg, #6c5cff, #5b4ff0)" }}>
                  {(cover?.url ?? coverUrl) && <img src={cover?.url ?? coverUrl} alt="" className="size-full object-cover" draggable={false} />}
                  <button
                    type="button"
                    onClick={() => coverInput.current?.click()}
                    aria-label={t("vibex.profile.changeCover")}
                    title={t("vibex.profile.changeCover")}
                    className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full bg-[rgba(20,20,40,0.55)] text-white backdrop-blur hover:bg-[rgba(20,20,40,0.7)]"
                    data-testid="pe-cover"
                  >
                    <RiImageEditLine className="size-5" />
                  </button>
                </div>
                <div className="px-5 pb-5">
                  <div className="relative -mt-11 mb-4 inline-flex">
                    <span className="inline-flex size-[88px] overflow-hidden rounded-full border-4 border-surface bg-surface shadow-tile">
                      {avatar ? <img src={avatar.url} alt="" className="size-full object-cover" /> : <Avatar name={person.name} userId={person.id} version={person.avatarVersion} size={80} />}
                    </span>
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      aria-label={t("vibex.profile.changeAvatar")}
                      title={t("vibex.profile.changeAvatar")}
                      className="absolute bottom-0.5 right-0.5 flex size-7 items-center justify-center rounded-full border-2 border-surface bg-primary text-white"
                      data-testid="pe-avatar"
                    >
                      <RiCameraLine className="size-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-medium">{t("vibex.profile.firstName")}</span>
                      <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={50} className={field} data-testid="pe-first" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-medium">{t("vibex.profile.lastName")}</span>
                      <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={50} className={field} data-testid="pe-last" />
                    </label>
                  </div>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="flex justify-between text-[13px] font-medium">
                      {t("vibex.profile.bio")}
                      <span className="font-normal text-text-tertiary">
                        {form.bio.length}/{VIBEX_BIO_MAX}
                      </span>
                    </span>
                    <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value.slice(0, VIBEX_BIO_MAX) })} rows={3} className={cx(field, "h-auto resize-none py-2.5")} data-testid="pe-bio" />
                  </label>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium">{t("vibex.profile.website")}</span>
                    <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} maxLength={VIBEX_WEBSITE_MAX} inputMode="url" className={field} placeholder="example.com" data-testid="pe-website" />
                  </label>
                  <label className="mt-3 flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium">{t("vibex.profile.city")}</span>
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={VIBEX_CITY_MAX} className={field} data-testid="pe-city" />
                  </label>
                  {error && (
                    <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              </div>
              <footer className="grid shrink-0 grid-cols-2 gap-3 border-t p-4 pb-[max(1rem,var(--safe-bottom))]">
                <Button variant="secondary" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={() => void save()} loading={saving} disabled={!form.firstName.trim()} data-testid="pe-save">
                  {t("common.save")}
                </Button>
              </footer>
              <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={pick("circle")} data-testid="pe-avatar-file" />
              <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={pick("wide")} data-testid="pe-cover-file" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editing && (
          <PhotoEditor
            key="photo"
            file={editing.file}
            shape={editing.shape}
            onCancel={() => setEditing(null)}
            onConfirm={(blob) => {
              const v = { blob, url: URL.createObjectURL(blob) };
              if (editing.shape === "circle") setAvatar(v);
              else setCover(v);
              setEditing(null);
            }}
          />
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

// ------------------------------------------------------------------- media

/** Profile "Photo / Video": every picture / video from the person's posts — no uploads of its own. */
function MediaTab({ userId }: { userId: string }) {
  const t = useT();
  const [kind, setKind] = useState<"photo" | "video">("photo");
  const q = usePersonMedia(userId, kind);
  const [open, setOpen] = useState<number | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const files: VibexFileDto[] = items.map((i) => i.file);
  return (
    <div className="flex flex-col gap-3" data-testid="profile-media">
      <div className="mx-auto flex rounded-full bg-surface p-1 shadow-tile" role="tablist">
        {(["photo", "video"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              setOpen(null);
            }}
            className={cx("h-8 rounded-full px-5 text-[13.5px] font-semibold transition", kind === k ? "bg-primary text-white" : "text-text-secondary hover:text-text")}
            data-testid={`media-kind-${k}`}
          >
            {t(k === "photo" ? "vibex.profile.photos" : "vibex.profile.videos")}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !items.length ? (
        <EmptyState icon={<RiImageEditLine className="size-7" />} title={t(kind === "photo" ? "vibex.profile.noPhotos" : "vibex.profile.noVideos")} />
      ) : (
        <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-2xl" data-testid="profile-media-grid">
          {items.map((i, n) =>
            i.file.kind === "video" ? (
              <VibexVideoTile key={i.file.id} file={i.file} className="aspect-square w-full" onClick={() => setOpen(n)} />
            ) : (
              <VibexImage key={i.file.id} file={i.file} className="aspect-square w-full" onClick={() => setOpen(n)} />
            ),
          )}
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="ghost" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t("vibex.feed.more")}
        </Button>
      )}
      <Lightbox files={files} index={open} onIndex={setOpen} />
    </div>
  );
}

// ------------------------------------------------------------------- pages

type Tab = "posts" | "reposts" | "media";

export function PersonPage({ id }: { id: string }) {
  const t = useT();
  const profile = useProfile(id);
  const posts = usePersonPosts(id);
  const [tab, setTab] = useState<Tab>("posts");
  const [editing, setEditing] = useState(false);
  if (profile.isError) return <EmptyState icon={<RiUserSearchLine className="size-7" />} title={t("vibex.person.unavailable")} />;
  const all = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const shown = all.filter((p) => (tab === "posts" ? p.kind === "post" : p.kind === "repost"));
  const filtered = posts.data ? { ...posts, data: { ...posts.data, pages: [{ items: shown, next: null }] } } : posts;
  const tabs: [Tab, Parameters<typeof t>[0]][] = [
    ["posts", "vibex.profile.posts"],
    ["reposts", "vibex.profile.reposts"],
    ["media", "vibex.profile.media"],
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="person-page">
      {profile.data ? <ProfileHeader profile={profile.data} onEdit={() => setEditing(true)} /> : <Skeleton className="h-[280px] rounded-2xl" />}
      <div className="sticky top-0 z-10 flex rounded-2xl border border-border bg-surface/95 backdrop-blur" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx("relative flex-1 py-3 text-[14px] font-semibold transition", tab === k ? "text-text" : "text-text-secondary hover:text-text")}
            data-testid={`profile-tab-${k}`}
          >
            {t(label)}
            {tab === k && <span className="absolute inset-x-6 bottom-0 h-1 rounded-full bg-primary" />}
          </button>
        ))}
      </div>
      {profile.data && !profile.data.visible && !profile.data.me ? (
        <EmptyState icon={<RiUserForbidLine className="size-7" />} title={t("vibex.profile.private")} />
      ) : tab === "media" ? (
        <MediaTab userId={id} />
      ) : (
        <>
          {profile.data?.me && tab === "posts" && <ComposerPrompt />}
          <PostList
            query={{ ...filtered, hasNextPage: posts.hasNextPage, isFetchingNextPage: posts.isFetchingNextPage, fetchNextPage: posts.fetchNextPage }}
            empty={<FeedEmpty mine={profile.data?.me} reposts={tab === "reposts"} />}
          />
        </>
      )}
      {profile.data?.me && <ProfileEditor profile={profile.data} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function MePage() {
  const me = useSession((s) => s.user)!;
  return <PersonPage id={me.id} />;
}
