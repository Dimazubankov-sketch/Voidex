import { useEffect, useMemo, useRef, useState } from "react";
import { FilesApp, serialize, type FilesHost, type OpenFile } from "@voidex/files";
import "@voidex/files/styles.css";
import { APP_REGISTRY } from "@voidex/shared";
import { FilesGlyph } from "@/brand/brand";
import { useFormFactor } from "@/lib/form-factor";
import { useI18n, useT } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { askUnsaved } from "@/os/close-guard";
import { useCloudDialog, useCloudStatus } from "@/os/cloud/cloud";
import { CloudOffNotice } from "@/os/cloud/notice";
import { sessionFiles } from "@/os/cloud/session";
import { VoidexShareDialog } from "@/os/share/share-dialog";
import { sendFiles } from "@/os/share/send-files";
import { WindowHeader, useWindow } from "@/os/window-context";
import { setBeforeClose } from "@/os/window-manager";
import { FileTypeIcon } from "./file-icon";

const MIME = { txt: "text/plain", prsn: "application/vnd.voidex.prsn+json" } as const;

/**
 * VOIDEX Files (Step 2.7): the portable Voidex Files module (packages/files)
 * in a VOIDEX window. Only .txt and .prsn; files arrive through
 * FilesAdapter.receive (a Vibex / Mail attachment "Открыть в Файлах"), no
 * manual creation. VOIDEX Cloud is not running yet, so the adapter keeps
 * them for this session and the app says so. Sharing goes through the
 * common VoidexShareDialog as a real attachment.
 */
export function FilesWindowApp() {
  const t = useT();
  const win = useWindow();
  const ff = useFormFactor();
  const language = useI18n((s) => s.language);
  const cloud = useCloudStatus();
  const showCloud = useCloudDialog((s) => s.show);
  const adapter = useMemo(() => sessionFiles(), []);
  const [sharing, setSharing] = useState<OpenFile | null>(null);
  const dirty = useRef(false);

  const host = useMemo<FilesHost>(
    () => ({
      cloud: { available: cloud.available },
      onOpenCloud: () => showCloud("files"),
      onShare: setSharing,
      onDirtyChange: (d) => {
        dirty.current = d;
      },
      notice: cloud.available ? undefined : <CloudOffNotice app="files" />,
      initialOpen: adapter.takePending(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter],
  );

  // Closing with unsaved text: the editor saves with its own button, so "save" keeps the window open.
  useEffect(() => {
    setBeforeClose(win.windowId, async () => {
      if (!dirty.current) return true;
      const answer = await askUnsaved(APP_REGISTRY.files.name[language]);
      if (answer === "discard") return true;
      if (answer === "save") toast({ title: t("files.saveFirst"), tone: "default" });
      return false;
    });
    return () => setBeforeClose(win.windowId, null);
  }, [win.windowId, language, t]);

  return (
    <div className="vx-files vx-app-bg flex min-h-0 flex-1 flex-col" data-testid="files-app">
      {ff === "desktop" && (
        <WindowHeader>
          <span className="flex min-w-0 items-center gap-2 pl-1.5">
            <FilesGlyph className="size-6 shrink-0" />
            <span className="truncate text-[15px] font-semibold">{APP_REGISTRY.files.name[language]}</span>
          </span>
        </WindowHeader>
      )}
      <div className="relative min-h-0 flex-1">
        <FilesApp adapter={adapter} host={host} embedded />
      </div>
      <VoidexShareDialog
        subject={
          sharing
            ? {
                key: sharing.file.id,
                icon: <FileTypeIcon kind={sharing.file.kind} />,
                title: sharing.file.name,
                hint: t("share.fileHint"),
              }
            : null
        }
        onClose={() => setSharing(null)}
        onSend={(input) => {
          const f = sharing!;
          const file = new File([serialize(f.file.kind, f.data)], f.file.name, { type: MIME[f.file.kind] });
          return sendFiles(input, [file]);
        }}
        testId="files-share"
      />
    </div>
  );
}
