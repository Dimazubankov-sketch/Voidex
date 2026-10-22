import { deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";

/** A solid PNG of the given size (for pictures with known proportions). */
export function pngOf(w: number, h: number, rgb: [number, number, number] = [124, 108, 255]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** API call as the signed-in page (a fresh access token from the refresh cookie). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notesApiCall(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "X-Voidex-Client": "web", "Content-Type": "application/json" }, body: "{}" });
      const { accessToken } = await r.json();
      const res = await fetch(url, { method, headers: { "X-Voidex-Client": "web", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

export async function seedNotes(page: Page, project: string, docs: { name: string; kind?: "note" | "presentation"; data?: unknown }[] = []) {
  const p = (await notesApiCall(page, "POST", "/api/notes/projects", { name: project })).body;
  const out: { id: string; revision: number }[] = [];
  for (const d of docs) out.push((await notesApiCall(page, "POST", `/api/notes/projects/${p.id}/documents`, { kind: d.kind ?? "note", name: d.name, ...(d.data ? { data: d.data } : {}) })).body);
  return { project: p.id as string, docs: out };
}

export async function openNotesDoc(page: Page, project: string, doc: string) {
  await page.getByTestId("notes-project-list").getByTestId("notes-card-name").getByText(project, { exact: true }).first().click();
  await expect(page.getByTestId("notes-project")).toBeVisible();
  await page.getByTestId("notes-doc-list").getByTestId("notes-card-name").getByText(doc, { exact: true }).first().click();
  await expect(page.getByTestId("notes-doc")).toBeVisible();
}

export async function notesDocMenu(page: Page, item: string) {
  await page.getByTestId("notes-doc").getByTestId(/^(window-menu|notes-more)$/).click();
  await page.getByTestId(`notes-menu-${item}`).click();
}

export const notesSaved = (page: Page) => expect(page.getByTestId("notes-save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
