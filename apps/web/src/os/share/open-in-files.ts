import { sessionFiles } from "@/os/cloud/session";
import { useWM } from "@/os/window-manager";

/** .txt / .prsn attachments open in Files (Step 2.7). */
export const opensInFiles = (filename: string) => /\.(txt|prsn)$/i.test(filename);

/**
 * A .txt / .prsn attachment from Vibex or Mail goes into Files through
 * FilesAdapter.receive (parsed and validated there) and opens in its editor.
 * While VOIDEX Cloud is off it stays in this session only, and Files says so.
 */
export async function openInFiles(filename: string, blob: Blob) {
  await sessionFiles().importFile(filename, await blob.text());
  useWM.getState().open("files");
}
