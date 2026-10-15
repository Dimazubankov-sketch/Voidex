import { sessionFiles } from "@/os/cloud/session";
import { useWM } from "@/os/window-manager";

/** .txt / .prsn (Step 2.7) and .book (Step 2.13) attachments open in Files. */
export const opensInFiles = (filename: string) => /\.(txt|prsn|book)$/i.test(filename);

/**
 * A .txt / .prsn attachment from Vibex or Mail goes into Files through
 * FilesAdapter.receive (parsed and validated there) and opens in its editor.
 * While VOIDEX Cloud is off it stays in this session only, and Files says so.
 */
export async function openInFiles(filename: string, blob: Blob) {
  await sessionFiles().importFile(filename, await blob.text());
  useWM.getState().open("files");
}
