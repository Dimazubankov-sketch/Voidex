import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RiLockLine } from "@remixicon/react";
import type { NotesShareInfoDto } from "@voidex/shared";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { Button, Spinner } from "@/ui/controls";
import { toast } from "@/ui/overlays";
import { invalidateNotes, nk, notesApi } from "./data";
import { FileIcon, MoreMenu, NotesHeader } from "./kit";
import { useNav } from "./route";

/**
 * A shared .txt / .prsn card was opened (Vibex, Mail, a link). A copy link
 * adds the recipient's own copy; an access link opens the original (the
 * first time it adds them as Editor / Viewer). A revoked link or a deleted
 * original says so instead.
 */
export function ShareLanding({ token }: { token: string }) {
  const t = useT();
  const nav = useNav();
  const q = useQuery({ queryKey: nk.share(token), queryFn: () => notesApi.shareInfo(token), retry: false });
  const [busy, setBusy] = useState<"open" | "copy" | null>(null);

  // A document shared on its own (not its project): Back leads to "Доступно мне", not to a project I can't open.
  const go = (r: { projectId: string; documentId?: string }, docOnly = false) =>
    r.documentId
      ? nav.go({ screen: "doc", docId: r.documentId, back: docOnly ? { screen: "shared" } : { screen: "project", projectId: r.projectId } })
      : nav.go({ screen: "project", projectId: r.projectId });

  const accept = async (info: NotesShareInfoDto, copy: boolean) => {
    setBusy(copy ? "copy" : "open");
    try {
      if (!copy && info.access !== "none" && info.projectId) {
        go({ projectId: info.projectId, documentId: info.documentId }, info.kind !== "project" && info.access !== "owner" && info.mode === "access");
        return;
      }
      const r = await notesApi.accept(token, copy);
      await invalidateNotes();
      if (copy) toast({ title: t("notes.copyAdded"), tone: "success" });
      go(r, !copy && info.kind !== "project");
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
      void q.refetch();
    } finally {
      setBusy(null);
    }
  };

  const info = q.data;
  const denied = q.isError || info?.gone;
  return (
    <>
      <NotesHeader onBack={() => nav.go({ screen: "projects" })} right={<MoreMenu items={[]} label={t("notes.more")} win />} />
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto px-6 pb-10" data-testid="notes-share-landing" data-state={q.isLoading ? "loading" : denied ? "denied" : (info?.mode ?? "")}>
        {q.isLoading ? (
          <Spinner />
        ) : denied || !info ? (
          <div className="flex max-w-[340px] flex-col items-center gap-3 text-center" data-testid="notes-share-denied">
            <span className="grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
              <RiLockLine className="size-7" />
            </span>
            <h2 className="text-[19px] font-semibold text-text">{t("notes.revoked.title")}</h2>
            <p className="text-[14.5px] text-text-secondary">{t("notes.share.gone")}</p>
            <Button variant="secondary" className="mt-2" onClick={() => nav.go({ screen: "projects" })}>
              {t("notes.toProjects")}
            </Button>
          </div>
        ) : (
          <div className="flex w-full max-w-[360px] flex-col items-center gap-4 text-center">
            <FileIcon ext={info.ext} className="size-[132px] rounded-[28px] shadow-tile" />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="break-words text-[20px] font-semibold text-text" data-testid="notes-share-title">
                {info.name}
                {info.ext}
              </h2>
              <p className="text-[14px] text-text-secondary">
                {t("notes.share.from", { name: info.owner.name })}
                {info.mode === "access" && ` · ${t(`notes.role.${info.role}`)}`}
              </p>
            </div>
            <div className="mt-1 flex w-full flex-col gap-2">
              {(info.mode === "access" || info.access !== "none") && (
                <Button onClick={() => void accept(info, false)} loading={busy === "open"} disabled={busy !== null} data-testid="notes-share-open">
                  {t("notes.share.open")}
                </Button>
              )}
              {info.mode === "copy" && (
                <Button variant={info.access !== "none" ? "secondary" : "primary"} onClick={() => void accept(info, true)} loading={busy === "copy"} disabled={busy !== null} data-testid="notes-share-add">
                  {t("notes.share.addCopy")}
                </Button>
              )}
            </div>
            <p className="text-[12.5px] text-text-tertiary">{info.mode === "copy" ? t("notes.share.copyHint") : t("notes.share.accessHint")}</p>
          </div>
        )}
      </div>
    </>
  );
}
