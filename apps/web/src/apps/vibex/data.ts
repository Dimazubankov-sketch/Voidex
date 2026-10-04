import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from "@tanstack/react-query";
import {
  VIBEX_FILE_MAX_BYTES,
  VIBEX_MEDIA_MAX_BYTES,
  VIBEX_POST_IMAGE_TYPES,
  VIBEX_POST_VIDEO_TYPES,
  attachmentMimeType,
  type MeDto,
  type VibexMediaItemDto,
  type VibexSettings,
  type VibexUploadPurpose,
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
import { api, qs } from "@/lib/api";
import { applyMe } from "@/lib/account";
import { queryClient } from "@/lib/query";

/** Query keys: everything under ["vibex"] so a reconnect / sign-out refreshes it all. */
export const vk = {
  all: ["vibex"] as const,
  chats: ["vibex", "chats"] as const,
  chat: (id: string) => ["vibex", "chat", id] as const,
  messages: (id: string) => ["vibex", "messages", id] as const,
  feed: ["vibex", "feed"] as const,
  posts: ["vibex", "posts"] as const,
  personPosts: (id: string) => ["vibex", "posts", "person", id] as const,
  post: (id: string) => ["vibex", "post", id] as const,
  profile: (id: string) => ["vibex", "profile", id] as const,
  people: (q: string) => ["vibex", "people", q] as const,
  history: (kind: HistoryKind) => ["vibex", "history", kind] as const,
  file: (id: string) => ["vibex", "file", id] as const,
  me: ["vibex", "me"] as const,
  comments: (id: string) => ["vibex", "comments", id] as const,
  media: (id: string, kind: "photo" | "video") => ["vibex", "media", id, kind] as const,
  cover: (id: string, version: number) => ["vibex", "cover", id, version] as const,
  follows: (id: string, which: "followers" | "following") => ["vibex", "follows", id, which] as const,
};

// ------------------------------------------------------- me and settings

/** My Vibex profile and settings — the VOIDEX session is the identity (no Vibex sign-in). */
export function useVibexMe() {
  return useQuery({ queryKey: vk.me, queryFn: () => api.get<VibexMeDto>("/api/vibex/me"), staleTime: 60_000 });
}

type SettingsPatch = { [K in keyof VibexSettings]?: Partial<VibexSettings[K]> };

export function useUpdateSettings() {
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<VibexSettings>("/api/vibex/settings", patch),
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<VibexMeDto>(vk.me);
      if (prev) {
        const s = prev.settings;
        queryClient.setQueryData<VibexMeDto>(vk.me, {
          ...prev,
          settings: { privacy: { ...s.privacy, ...patch.privacy }, notifications: { ...s.notifications, ...patch.notifications }, media: { ...s.media, ...patch.media } },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(vk.me, ctx.prev),
    onSuccess: (settings) => queryClient.setQueryData<VibexMeDto>(vk.me, (m) => m && { ...m, settings }),
  });
}

// ---------------------------------------------------------------- profile

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (v: { firstName?: string; lastName?: string; bio?: string; website?: string; city?: string }) => api.patch<VibexProfileDto>("/api/vibex/profile", v),
    onSuccess: (p) => {
      queryClient.setQueryData(vk.profile(p.person.id), p);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: vk.me });
    },
  });
}

/** Avatar = the VOIDEX account's avatar (one identity); the editor uploads the cropped picture. */
export async function uploadAvatar(blob: Blob) {
  const me = await api.put<MeDto>("/api/account/avatar", blob, { headers: { "Content-Type": "image/jpeg" } });
  applyMe(me);
  void queryClient.invalidateQueries({ queryKey: ["vibex", "profile"] });
  return me;
}

export async function uploadCover(blob: Blob) {
  const p = await api.put<VibexProfileDto>("/api/vibex/profile/cover", blob, { headers: { "Content-Type": "application/octet-stream" } });
  queryClient.setQueryData(vk.profile(p.person.id), p);
  return p;
}

export async function removeCover() {
  const p = await api.delete<VibexProfileDto>("/api/vibex/profile/cover");
  queryClient.setQueryData(vk.profile(p.person.id), p);
  return p;
}

/** A profile cover picture (blob URL), only when the profile has one. */
export function useCoverUrl(userId: string, version: number) {
  return useQuery({
    queryKey: vk.cover(userId, version),
    enabled: version > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    queryFn: async () => URL.createObjectURL(await api.get<Blob>(`/api/vibex/people/${userId}/cover`)),
  });
}

export function useFollow(userId: string) {
  return useMutation({
    mutationFn: (on: boolean) => (on ? api.post<VibexProfileDto>(`/api/vibex/people/${userId}/follow`) : api.delete<VibexProfileDto>(`/api/vibex/people/${userId}/follow`)),
    onMutate: (on) => {
      const prev = queryClient.getQueryData<VibexProfileDto>(vk.profile(userId));
      if (prev && prev.followed !== on) queryClient.setQueryData(vk.profile(userId), { ...prev, followed: on, followers: Math.max(0, prev.followers + (on ? 1 : -1)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(vk.profile(userId), ctx.prev),
    onSuccess: (p) => {
      queryClient.setQueryData(vk.profile(userId), p);
      void queryClient.invalidateQueries({ queryKey: ["vibex", "follows"] });
      void queryClient.invalidateQueries({ queryKey: vk.posts });
    },
  });
}

export function useFollowList(userId: string, which: "followers" | "following", enabled: boolean) {
  return useQuery({ queryKey: vk.follows(userId, which), enabled, queryFn: () => api.get<VibexPersonDto[]>(`/api/vibex/people/${userId}/${which}`) });
}

/** Photos / videos of a person's posts (profile "Photo / Video"). */
export function usePersonMedia(userId: string, kind: "photo" | "video", enabled = true) {
  return useInfiniteQuery({
    queryKey: vk.media(userId, kind),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<VibexPage<VibexMediaItemDto>>(`/api/vibex/people/${userId}/media${qs({ kind, before: pageParam })}`),
    getNextPageParam: (last) => last.next,
    staleTime: 0,
  });
}

export type HistoryKind = "liked" | "bookmarks";

// ---------------------------------------------------------------- people

export function usePeople(q: string) {
  return useQuery({
    queryKey: vk.people(q),
    queryFn: () => api.get<VibexPersonDto[]>(`/api/vibex/people${qs({ q })}`),
    staleTime: 30_000,
  });
}

export function useProfile(id: string | null) {
  return useQuery({
    queryKey: vk.profile(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<VibexProfileDto>(`/api/vibex/people/${id}`),
  });
}

// ----------------------------------------------------------------- chats

export function useChats() {
  return useQuery({ queryKey: vk.chats, queryFn: () => api.get<VibexChatDto[]>("/api/vibex/chats"), staleTime: 15_000 });
}

export function useChat(id: string | null) {
  return useQuery({
    queryKey: vk.chat(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<VibexChatDto>(`/api/vibex/chats/${id}`),
    // Prefill from the list so the header shows instantly.
    initialData: () => queryClient.getQueryData<VibexChatDto[]>(vk.chats)?.find((c) => c.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(vk.chats)?.dataUpdatedAt,
  });
}

export function useMessages(id: string) {
  return useInfiniteQuery({
    queryKey: vk.messages(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<VibexPage<VibexMessageDto>>(`/api/vibex/chats/${id}/messages${qs({ before: pageParam, limit: 50 })}`),
    getNextPageParam: (last) => last.next,
    staleTime: 10_000,
  });
}

export const openDirect = (userId: string) => api.post<VibexChatDto>("/api/vibex/chats/direct", { userId });

type MessagesData = InfiniteData<VibexPage<VibexMessageDto>>;

export function useSendMessage(chatId: string) {
  return useMutation({
    mutationFn: (v: { text: string; fileIds: string[]; kind?: "text" | "voice" | "circle"; durationMs?: number; replyToId?: string }) =>
      api.post<VibexMessageDto>(`/api/vibex/chats/${chatId}/messages`, v),
    onSuccess: (msg) => {
      // Show it right away; the server event then refreshes every device.
      queryClient.setQueryData<MessagesData>(vk.messages(chatId), (d) => {
        if (!d || d.pages[0]?.items.some((m) => m.id === msg.id)) return d;
        const [first, ...rest] = d.pages;
        return { ...d, pages: [{ ...first!, items: [msg, ...first!.items] }, ...rest] };
      });
      void queryClient.invalidateQueries({ queryKey: vk.chats });
    },
  });
}

/** Step 2.5: the sender deletes their message for everyone (a placeholder stays). */
export function useDeleteMessage(chatId: string) {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/vibex/messages/${id}`),
    onSuccess: (_r, id) => {
      queryClient.setQueryData<MessagesData>(vk.messages(chatId), (d) =>
        d
          ? {
              ...d,
              pages: d.pages.map((p) => ({
                ...p,
                items: p.items.map((m) => (m.id === id ? { ...m, deleted: true, text: "", files: [], durationMs: null, replyTo: null, sharedPost: undefined } : m)),
              })),
            }
          : d,
      );
      void queryClient.invalidateQueries({ queryKey: vk.messages(chatId) });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "chats"] });
    },
  });
}

export function markRead(chatId: string) {
  return api.post(`/api/vibex/chats/${chatId}/read`).then(() => {
    queryClient.setQueryData<VibexChatDto[]>(vk.chats, (list) => list?.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
  });
}

export function useSetPins() {
  return useMutation({
    mutationFn: (conversationIds: string[]) => api.put<VibexChatDto[]>("/api/vibex/chats/pins", { conversationIds }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: vk.chats });
      const prev = queryClient.getQueryData<VibexChatDto[]>(vk.chats);
      if (prev) queryClient.setQueryData(vk.chats, applyPins(prev, ids));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(vk.chats, ctx.prev),
    onSuccess: (list) => queryClient.setQueryData(vk.chats, list),
  });
}

/** The list as the server will return it after `PUT /chats/pins` (pinned in my order, then by activity). */
export function applyPins(list: VibexChatDto[], pinnedIds: string[]): VibexChatDto[] {
  const pos = new Map(pinnedIds.map((id, i) => [id, i]));
  return list
    .map((c) => ({ ...c, pinnedPosition: pos.get(c.id) ?? null }))
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

// ----------------------------------------------------------------- files

export const filesApi = {
  upload: (file: File, purpose: VibexUploadPurpose) =>
    api.post<VibexFileDto>(`/api/vibex/files${qs({ purpose })}`, file, {
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    }),
  discard: (id: string) => api.delete(`/api/vibex/files/${id}`),
  blob: (id: string) => api.get<Blob>(`/api/vibex/files/${id}`),
};

/** Client-side check (the server re-validates everything). Returns an error code or null. */
export function checkVibexFile(file: File, purpose: "message" | "post"): "attachment_type_not_allowed" | "attachment_too_large" | null {
  const mime = attachmentMimeType(file.name);
  if (!mime || (purpose === "post" && !VIBEX_POST_IMAGE_TYPES.includes(mime) && !VIBEX_POST_VIDEO_TYPES.includes(mime))) return "attachment_type_not_allowed";
  if (file.size > (purpose === "post" ? VIBEX_MEDIA_MAX_BYTES : VIBEX_FILE_MAX_BYTES)) return "attachment_too_large";
  return null;
}

/** Image previews: fetched with the access token, shown from a blob URL. */
export function useFileUrl(id: string | null) {
  return useQuery({
    queryKey: vk.file(id ?? ""),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    queryFn: async () => URL.createObjectURL(await filesApi.blob(id!)),
  });
}

export async function saveFile(f: VibexFileDto) {
  const url = URL.createObjectURL(await filesApi.blob(f.id));
  const link = document.createElement("a");
  link.href = url;
  link.download = f.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ------------------------------------------------------------------ posts

function postPages(key: readonly unknown[], url: (cursor: string | null) => string, enabled = true) {
  return {
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) => api.get<VibexPage<VibexPostDto>>(url(pageParam)),
    getNextPageParam: (last: VibexPage<VibexPostDto>) => last.next,
    // Other people's changes (deleted posts, new reposts) don't arrive as events: refresh on every visit.
    staleTime: 0,
  };
}

export function useFeed() {
  return useInfiniteQuery(postPages(vk.feed, (before) => `/api/vibex/feed${qs({ before })}`));
}

export function usePersonPosts(id: string | null) {
  return useInfiniteQuery(postPages(vk.personPosts(id ?? ""), (before) => `/api/vibex/people/${id}/posts${qs({ before })}`, !!id));
}

export function usePost(id: string | null) {
  return useQuery({ queryKey: vk.post(id ?? ""), enabled: !!id, queryFn: () => api.get<VibexPostDto>(`/api/vibex/posts/${id}`), retry: false });
}

export function useHistory(kind: HistoryKind) {
  return useInfiniteQuery({
    queryKey: vk.history(kind),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<VibexPage<VibexHistoryItemDto>>(`/api/vibex/history${qs({ kind, before: pageParam })}`),
    getNextPageParam: (last) => last.next,
    staleTime: 0,
  });
}

type PostsData = InfiniteData<VibexPage<VibexPostDto>>;

/** Applies a fresh copy of an original post everywhere it is shown (cards, repost cards, history, chats). */
function patchPost(updated: VibexPostDto) {
  const fix = (p: VibexPostDto): VibexPostDto => {
    if (p.id === updated.id) return { ...updated, repostOf: p.repostOf };
    if (p.repostOf?.id === updated.id) return { ...p, repostOf: { ...updated } };
    return p;
  };
  for (const [key, data] of queryClient.getQueriesData<PostsData>({ queryKey: vk.posts })) {
    if (data?.pages) queryClient.setQueryData<PostsData>(key, { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map(fix) })) });
  }
  queryClient.setQueryData<PostsData>(vk.feed, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(fix) })) });
  queryClient.setQueryData<VibexPostDto>(vk.post(updated.id), (p) => p && fix(p));
}

export function usePostAction() {
  return useMutation({
    mutationFn: async (v: { post: VibexPostDto; action: "like" | "unlike" | "bookmark" | "unbookmark" }) => {
      const id = v.post.repostOf?.id ?? v.post.id;
      const path = v.action.endsWith("like") ? "like" : "bookmark";
      return v.action.startsWith("un") ? api.delete<VibexPostDto>(`/api/vibex/posts/${id}/${path}`) : api.post<VibexPostDto>(`/api/vibex/posts/${id}/${path}`);
    },
    onMutate: ({ post, action }) => {
      const orig = post.kind === "repost" ? post.repostOf : post;
      if (!orig) return;
      const next = { ...orig };
      if (action === "like") Object.assign(next, { liked: true, likes: orig.likes + (orig.liked ? 0 : 1) });
      if (action === "unlike") Object.assign(next, { liked: false, likes: Math.max(0, orig.likes - (orig.liked ? 1 : 0)) });
      if (action === "bookmark") next.bookmarked = true;
      if (action === "unbookmark") next.bookmarked = false;
      patchPost(next);
    },
    onSuccess: (p) => patchPost(p),
    onSettled: (_d, _e, v) => {
      void queryClient.invalidateQueries({ queryKey: vk.history(v.action.endsWith("like") ? "liked" : "bookmarks") });
    },
  });
}

export function useCreatePost() {
  return useMutation({
    mutationFn: (v: { text: string; mediaIds: string[] }) => api.post<VibexPostDto>("/api/vibex/posts", v),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vk.feed });
      void queryClient.invalidateQueries({ queryKey: vk.posts });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "profile"] });
    },
  });
}

function refreshPosts() {
  void queryClient.invalidateQueries({ queryKey: vk.feed });
  void queryClient.invalidateQueries({ queryKey: vk.posts });
  void queryClient.invalidateQueries({ queryKey: ["vibex", "history"] });
  void queryClient.invalidateQueries({ queryKey: ["vibex", "profile"] });
}

export function useEditPost() {
  return useMutation({
    mutationFn: (v: { id: string; text: string }) => api.patch<VibexPostDto>(`/api/vibex/posts/${v.id}`, { text: v.text }),
    onSuccess: (p) => patchPost(p),
  });
}

/** "Not interested": gone from my feed right away. */
export function useHidePost() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/vibex/posts/${id}/hide`),
    onSuccess: (_r, id) => {
      queryClient.setQueryData<PostsData>(vk.feed, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.filter((p) => p.id !== id && p.repostOf?.id !== id) })) });
    },
  });
}

export const reportPost = (id: string, reason: "spam" | "abuse" | "other") => api.post(`/api/vibex/posts/${id}/report`, { reason });

export const translatePost = (id: string) => api.post<VibexTranslationDto>(`/api/vibex/posts/${id}/translate`);

// --------------------------------------------------------------- comments

export function useComments(postId: string) {
  return useQuery({ queryKey: vk.comments(postId), queryFn: () => api.get<VibexCommentDto[]>(`/api/vibex/posts/${postId}/comments`), staleTime: 0 });
}

function bumpComments(postId: string, by: number) {
  const fix = (p: VibexPostDto): VibexPostDto =>
    p.id === postId ? { ...p, comments: Math.max(0, p.comments + by) } : p.repostOf?.id === postId ? { ...p, repostOf: { ...p.repostOf, comments: Math.max(0, p.repostOf.comments + by) } } : p;
  for (const [key, data] of queryClient.getQueriesData<PostsData>({ queryKey: vk.all })) {
    // Only post lists: other Vibex queries hold blob URLs (strings), people, chats…
    if (data && typeof data === "object" && "pages" in data && Array.isArray(data.pages) && data.pages[0] && typeof data.pages[0] === "object" && "items" in data.pages[0]) {
      queryClient.setQueryData<PostsData>(key, { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map((x) => (x && "kind" in x ? fix(x) : x)) })) });
    }
  }
  queryClient.setQueryData<VibexPostDto>(vk.post(postId), (p) => p && fix(p));
}

export function useAddComment(postId: string) {
  return useMutation({
    mutationFn: (v: { text: string; replyToId?: string }) => api.post<VibexCommentDto>(`/api/vibex/posts/${postId}/comments`, v),
    onSuccess: (c) => {
      queryClient.setQueryData<VibexCommentDto[]>(vk.comments(postId), (list) => {
        if (list?.some((x) => x.id === c.id)) return list;
        const next = [...(list ?? []), c];
        // A reply bumps its thread's counter.
        return c.rootId ? next.map((x) => (x.id === c.rootId ? { ...x, replies: x.replies + 1 } : x)) : next;
      });
      bumpComments(postId, 1);
    },
  });
}

export function useDeleteComment(postId: string) {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/vibex/comments/${id}`),
    onSuccess: (_r, id) => {
      // A removed top-level comment takes its replies with it.
      queryClient.setQueryData<VibexCommentDto[]>(vk.comments(postId), (list) => {
        const gone = list?.find((c) => c.id === id);
        return list?.filter((c) => c.id !== id && c.rootId !== id).map((c) => (gone?.rootId && c.id === gone.rootId ? { ...c, replies: Math.max(0, c.replies - 1) } : c));
      });
      void queryClient.invalidateQueries({ queryKey: ["vibex", "post", postId] });
      bumpComments(postId, -1);
    },
  });
}

export function useDeletePost() {
  return useMutation({ mutationFn: (id: string) => api.delete(`/api/vibex/posts/${id}`), onSuccess: refreshPosts });
}

export function useRepost() {
  return useMutation({
    mutationFn: (v: { id: string; on: boolean }) =>
      v.on ? api.post<VibexPostDto>(`/api/vibex/posts/${v.id}/repost`) : api.delete<VibexPostDto>(`/api/vibex/posts/${v.id}/repost`),
    onSuccess: refreshPosts,
  });
}

export function sharePost(postId: string, userIds: string[], text: string) {
  return api.post<{ conversationIds: string[] }>(`/api/vibex/posts/${postId}/share`, { userIds, text });
}

/** A link to a post that opens it inside VOIDEX (requires being signed in). */
export function postLink(id: string) {
  return `${window.location.origin}/#vibex/post/${id}`;
}
