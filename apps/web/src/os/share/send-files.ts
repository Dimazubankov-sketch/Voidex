import { MAIL_ATTACHMENTS_MAX, VIBEX_FILES_MAX, type VibexMessageDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { attachmentsApi, checkFile } from "@/apps/mail/attachments";
import { draftsApi } from "@/apps/mail/data";
import { checkVibexFile, filesApi, openDirect, vk } from "@/apps/vibex/data";
import type { ShareSendInput } from "./share-dialog";

/** A file the server refused before anything was sent (type / size), with the key of the reason. */
export class AttachmentRejected extends Error {
  constructor(
    public code: "attachment_type_not_allowed" | "attachment_too_large" | "attachment_limit",
    public filename?: string,
  ) {
    super(code);
    this.name = "AttachmentRejected";
  }
}

/**
 * Files and Media share real files (Step 2.7): they go out as attachments
 * through the same safe upload paths as the paperclip in Vibex and Mail
 * (type allow-list, size limits, content sniffing on the server). Every file
 * is checked first, so nothing is half-sent.
 */
export async function sendFiles({ dest, picked, text }: ShareSendInput, files: File[]) {
  const max = dest === "vibex" ? VIBEX_FILES_MAX : MAIL_ATTACHMENTS_MAX;
  if (files.length > max) throw new AttachmentRejected("attachment_limit");
  for (const f of files) {
    const bad = dest === "vibex" ? checkVibexFile(f, "message") : checkFile(f);
    if (bad) throw new AttachmentRejected(bad, f.name);
  }
  if (dest === "vibex") {
    for (const p of picked) {
      const chatId = p.chatId ?? (await openDirect(p.userId!)).id;
      // One upload per chat: a sent file belongs to its message.
      const ids: string[] = [];
      for (const f of files) ids.push((await filesApi.upload(f, "message")).id);
      await api.post<VibexMessageDto>(`/api/vibex/chats/${chatId}/messages`, { text, fileIds: ids });
    }
    void queryClient.invalidateQueries({ queryKey: vk.chats });
    return;
  }
  const draft = await draftsApi.create({
    to: picked.map((p) => p.address!),
    subject: files.length === 1 ? files[0]!.name : files.map((f) => f.name).join(", ").slice(0, 180),
    body: text,
  } as Parameters<typeof draftsApi.create>[0]);
  try {
    for (const f of files) await attachmentsApi.upload(draft.id, f);
    await draftsApi.send(draft.id);
  } catch (e) {
    await draftsApi.remove(draft.id).catch(() => undefined);
    throw e;
  }
  void queryClient.invalidateQueries({ queryKey: ["mail"] });
}
