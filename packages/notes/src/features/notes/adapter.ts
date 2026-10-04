import type { Workspace, Space, Project } from "./model";
export interface NotesAdapter {
  load(): Promise<{
    data: Workspace;
    revision: number;
  }>;
  save(data: Workspace, revision: number): Promise<number>;
  upload(file: Blob): Promise<string>;
  createShare(data: Space | Project): Promise<string>;
  revokeShare(token: string): Promise<void>;
  readShare(token: string): Promise<Space | Project>;
  listShares?(): Promise<
    {
      token: string;
      name: string;
      created: number;
    }[]
  >;
}
async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || "Не удалось выполнить запрос");
  return d;
}
export const httpAdapter: NotesAdapter = {
  listShares: () => request("/api/share?list=1"),
  load: () => request("/api/notes"),
  save: async (data, revision) =>
    (
      await request("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, revision }),
      })
    ).revision,
  upload: async (file) => (await request("/api/media", { method: "POST", headers: { "Content-Type": file.type }, body: file })).url,
  createShare: async (data) =>
    (await request("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }))
      .token,
  revokeShare: async (token) => {
    await request("/api/share?token=" + encodeURIComponent(token), { method: "DELETE" });
  },
  readShare: (token) => request("/api/share?token=" + encodeURIComponent(token)),
};
