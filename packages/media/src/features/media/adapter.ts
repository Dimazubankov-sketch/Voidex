import type { MediaLibrary } from "./model";
export interface MediaAdapter {
  /** Notify after Voidex downloads/imports have been persisted by its authenticated backend. */
  subscribe?(listener: () => void | Promise<void>): () => void;
  load(): Promise<{
    data: MediaLibrary;
    revision: number;
  }>;
  save(data: MediaLibrary, revision: number): Promise<number>;
  upload(file: Blob): Promise<string>;
}
async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || "Не удалось выполнить запрос");
  return d;
}
export const httpAdapter: MediaAdapter = {
  load: () => request("/api/library"),
  save: async (data, revision) =>
    (
      await request("/api/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, revision }),
      })
    ).revision,
  upload: async (file) => (await request("/api/assets", { method: "POST", headers: { "Content-Type": file.type }, body: file })).url,
};
