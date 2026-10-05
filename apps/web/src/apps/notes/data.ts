import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  NotesBody,
  NotesDocKind,
  NotesDocMetaDto,
  NotesDocumentDto,
  NotesMemberDto,
  NotesPrefsDto,
  NotesProjectDetailDto,
  NotesProjectDto,
  NotesShareDto,
  NotesShareInfoDto,
  NotesShareKind,
  NotesShareMode,
} from "@voidex/shared";
import { DEFAULT_NOTES_PREFS } from "@voidex/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";

/** Query keys: everything under ["notes"] (server events invalidate the whole family). */
export const nk = {
  all: ["notes"] as const,
  projects: ["notes", "projects"] as const,
  project: (id: string) => ["notes", "project", id] as const,
  members: (type: string, id: string) => ["notes", "members", type, id] as const,
  links: (type: string, id: string) => ["notes", "links", type, id] as const,
  prefs: ["notes", "prefs"] as const,
  share: (token: string) => ["notes", "share", token] as const,
};

export type ResourceType = "project" | "document";

export const notesApi = {
  projects: () => api.get<{ projects: NotesProjectDto[]; sharedDocuments: NotesDocMetaDto[] }>("/api/notes/projects"),
  project: (id: string) => api.get<NotesProjectDetailDto>(`/api/notes/projects/${id}`),
  createProject: (name: string) => api.post<NotesProjectDto>("/api/notes/projects", { name }),
  updateProject: (id: string, patch: { name?: string; cover?: string | null; position?: number }) => api.patch(`/api/notes/projects/${id}`, patch),
  deleteProject: (id: string) => api.delete(`/api/notes/projects/${id}`),
  createDocument: (projectId: string, input: { kind: NotesDocKind; name: string; format?: string; data?: NotesBody }) =>
    api.post<NotesDocumentDto>(`/api/notes/projects/${projectId}/documents`, input),
  document: (id: string) => api.get<NotesDocumentDto>(`/api/notes/documents/${id}`),
  save: (id: string, data: NotesBody, revision: number) => api.put<{ revision: number; updatedAt: string }>(`/api/notes/documents/${id}`, { data, revision }),
  updateDocument: (id: string, patch: { name?: string; cover?: string | null; position?: number }) => api.patch(`/api/notes/documents/${id}`, patch),
  deleteDocument: (id: string) => api.delete(`/api/notes/documents/${id}`),
  members: (type: ResourceType, id: string) => api.get<NotesMemberDto[]>(`/api/notes/access/${type}/${id}`),
  setRole: (type: ResourceType, id: string, userId: string, role: "editor" | "viewer") => api.patch(`/api/notes/access/${type}/${id}/${userId}`, { role }),
  removeMember: (type: ResourceType, id: string, userId: string) => api.delete(`/api/notes/access/${type}/${id}/${userId}`),
  createShare: (input: { resourceType: ResourceType; resourceId: string; mode: NotesShareMode; role?: "editor" | "viewer"; recipientIds?: string[] }) =>
    api.post<{ token: string; card: { token: string; title: string; ext: ".txt" | ".prsn"; kind: NotesShareKind } }>("/api/notes/shares", input),
  links: (type: ResourceType, id: string) => api.get<NotesShareDto[]>(`/api/notes/access/${type}/${id}/links`),
  revokeShare: (token: string) => api.delete(`/api/notes/shares/${encodeURIComponent(token)}`),
  shareInfo: (token: string) => api.get<NotesShareInfoDto>(`/api/notes/shares/${encodeURIComponent(token)}`),
  accept: (token: string, copy = false) => api.post<{ projectId: string; documentId?: string }>(`/api/notes/shares/${encodeURIComponent(token)}/accept`, { copy }),
  upload: (file: Blob) => api.post<{ url: string }>("/api/notes/media", file, { headers: { "Content-Type": file.type || "application/octet-stream" } }).then((r) => r.url),
  prefs: () => api.get<NotesPrefsDto>("/api/notes/prefs"),
  setPrefs: (patch: Partial<NotesPrefsDto>) => api.put<NotesPrefsDto>("/api/notes/prefs", patch),
};

export function useProjects() {
  return useQuery({ queryKey: nk.projects, queryFn: notesApi.projects, staleTime: 10_000 });
}

export function useProject(id: string | null) {
  return useQuery({ queryKey: nk.project(id ?? ""), queryFn: () => notesApi.project(id!), enabled: !!id, staleTime: 5_000 });
}

export function useMembers(type: ResourceType, id: string | null) {
  return useQuery({ queryKey: nk.members(type, id ?? ""), queryFn: () => notesApi.members(type, id!), enabled: !!id });
}

export function useLinks(type: ResourceType, id: string | null, enabled: boolean) {
  return useQuery({ queryKey: nk.links(type, id ?? ""), queryFn: () => notesApi.links(type, id!), enabled: !!id && enabled });
}

/** The link that opens a share inside VOIDEX (signing in first when needed). */
export const shareLink = (token: string) => `${window.location.origin}/#notes/share/${token}`;

export function usePrefs() {
  const q = useQuery({ queryKey: nk.prefs, queryFn: notesApi.prefs, staleTime: 60_000 });
  const m = useMutation({
    mutationFn: notesApi.setPrefs,
    onMutate: (patch) => queryClient.setQueryData<NotesPrefsDto>(nk.prefs, (p) => ({ ...(p ?? DEFAULT_NOTES_PREFS), ...patch })),
  });
  return { prefs: q.data ?? DEFAULT_NOTES_PREFS, set: (patch: Partial<NotesPrefsDto>) => m.mutate(patch) };
}

export const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: nk.all });

/**
 * Notes images are private (the session decides who may read them), so an
 * <img src> can't load them directly: they are read with the session once and
 * shown from local object URLs.
 */
const mediaUrls = new Map<string, Promise<string>>();
export function useMediaUrl(src?: string | null): string | undefined {
  const own = !!src && src.startsWith("/api/notes/media");
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!src || !own) {
      setUrl(src ?? undefined);
      return;
    }
    let live = true;
    let p = mediaUrls.get(src);
    if (!p) {
      p = api.get<Blob>(src).then((b) => URL.createObjectURL(b));
      mediaUrls.set(src, p);
      p.catch(() => mediaUrls.delete(src));
    }
    p.then((u) => live && setUrl(u)).catch(() => live && setUrl(undefined));
    return () => {
      live = false;
    };
  }, [src, own]);
  return url;
}

/** A downscaled copy for covers / list thumbnails (never the full picture in lists). */
export async function downscale(file: File, max = 1600): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (k >= 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.86));
  } catch {
    return file;
  }
}
