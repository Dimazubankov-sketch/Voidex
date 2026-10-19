import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseBackendLayer,
  parseProject,
  type AgentClient,
  type AgentScope,
  type FormaAgentCreated,
  type FormaAgentDto,
  type FormaAuditDto,
  type FormaProjectDto,
  type FormaProjectSummary,
  type FormaRevisionDto,
  type FormaSaveResult,
  type Project,
} from "@voidex/forma";
import { api } from "@/lib/api";

/** Forma API (session): projects, the frontend layer, history, agent connections. */
export const formaApi = {
  list: () => api.get<FormaProjectSummary[]>("/api/forma/projects"),
  create: (name: string, template: "blank" | "sample") => api.post<FormaProjectDto>("/api/forma/projects", { name, template }),
  get: async (id: string) => {
    const dto = await api.get<FormaProjectDto>(`/api/forma/projects/${id}`);
    // Every project the editor opens is validated (and migrated) by the shared model.
    return { ...dto, project: parseProject(dto.project, parseBackendLayer) };
  },
  revision: (id: string) => api.get<{ frontendRevision: number; backendRevision: number }>(`/api/forma/projects/${id}/revision`),
  save: (p: Project, baseRevision: number, checkpoint: boolean) =>
    api.put<FormaSaveResult>(`/api/forma/projects/${p.id}/frontend`, { baseRevision, checkpoint, document: { name: p.name, settings: p.settings, frontend: p.frontend } }),
  remove: (id: string) => api.delete<{ ok: true }>(`/api/forma/projects/${id}`),
  history: (id: string) => api.get<FormaRevisionDto[]>(`/api/forma/projects/${id}/history`),
  restore: (id: string, revision: number, baseRevision: number) => api.post<FormaProjectDto>(`/api/forma/projects/${id}/restore`, { revision, baseRevision }),
  agents: (id: string) => api.get<FormaAgentDto[]>(`/api/forma/projects/${id}/agents`),
  connect: (id: string, input: { name: string; client: AgentClient; scopes: AgentScope[]; ttlHours: number }) => api.post<FormaAgentCreated>(`/api/forma/projects/${id}/agents`, input),
  revoke: (id: string, agentId: string) => api.delete<{ ok: true }>(`/api/forma/projects/${id}/agents/${agentId}`),
  audit: (id: string) => api.get<FormaAuditDto[]>(`/api/forma/projects/${id}/audit`),
};

export function useProjects() {
  return useQuery({ queryKey: ["forma", "projects"], queryFn: formaApi.list });
}

export function useInvalidateProjects() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["forma", "projects"] });
}

const EDITOR_KEY = (id: string) => `vx.forma.editor.${id}`;

/** What the editor remembers on this device per project (never part of the project itself). */
export interface EditorPrefs {
  device: "phone" | "desktop";
  screenId: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
}

export function readPrefs(id: string): EditorPrefs {
  const base: EditorPrefs = { device: "phone", screenId: null, leftOpen: true, rightOpen: true };
  try {
    const raw = localStorage.getItem(EDITOR_KEY(id));
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<EditorPrefs>) } : base;
  } catch {
    return base;
  }
}

export function writePrefs(id: string, prefs: EditorPrefs) {
  try {
    localStorage.setItem(EDITOR_KEY(id), JSON.stringify(prefs));
  } catch {
    /* not remembered on this device */
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
