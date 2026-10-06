import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaApp, fileName, itemBlob, type MediaItem } from "@voidex/media";
import "@voidex/media/styles.css";
import { APP_REGISTRY } from "@voidex/shared";
import { MediaGlyph } from "@/brand/brand";
import { useFormFactor } from "@/lib/form-factor";
import { useI18n, useT } from "@/lib/i18n";
import { toast } from "@/ui/overlays";
import { useCloudDialog, useCloudStatus } from "@/os/cloud/cloud";
import { CloudOffNotice } from "@/os/cloud/notice";
import { sessionMedia } from "@/os/cloud/session";
import { useWallpapers } from "@/os/home/wallpapers";
import { VoidexShareDialog } from "@/os/share/share-dialog";
import { sendFiles } from "@/os/share/send-files";
import { WindowHeader, useWindow } from "@/os/window-context";
import { setBeforeClose } from "@/os/window-manager";

const ASSETS = `${import.meta.env.BASE_URL}apps/media`.replace(/\/$/, "");

/**
 * VOIDEX Media (Step 2.7): the Voidex Media module (packages/media) in a
 * VOIDEX window: gallery, collections, viewer, photo and video editors,
 * gestures. VOIDEX Cloud is not running yet, so photos and videos added in an
 * album are previewed for this session only (the app says so). Sharing goes
 * through the common VoidexShareDialog as real attachments.
 */
export function MediaWindowApp() {
  const t = useT();
  const win = useWindow();
  const ff = useFormFactor();
  const language = useI18n((s) => s.language);
  const cloud = useCloudStatus();
  const showCloud = useCloudDialog((s) => s.show);
  const wallpapers = useWallpapers();
  const adapter = useMemo(() => sessionMedia(), []);
  const [sharing, setSharing] = useState<MediaItem[] | null>(null);
  const dirty = useRef(false);

  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  // Pending changes are written to the session store a moment later: wait for them, then close.
  useEffect(() => {
    setBeforeClose(win.windowId, async () => {
      for (let i = 0; i < 20 && dirty.current; i++) await new Promise((r) => setTimeout(r, 100));
      return true;
    });
    return () => setBeforeClose(win.windowId, null);
  }, [win.windowId]);

  const onWallpaper = async (blob: Blob) => {
    const w = await wallpapers.upload(new File([blob], "wallpaper.jpg", { type: blob.type || "image/jpeg" }), "desktop");
    wallpapers.setWallpaper(w);
    toast({ title: t("wallpapers.applied"), tone: "success" });
  };

  return (
    <div className="vx-media flex min-h-0 flex-1 flex-col bg-[#fbfaff]" data-testid="media-app">
      {ff === "desktop" && (
        <WindowHeader>
          <span className="flex min-w-0 items-center gap-2 pl-1.5">
            <MediaGlyph className="size-6 shrink-0" />
            <span className="truncate text-[15px] font-semibold">{APP_REGISTRY.media.name[language]}</span>
          </span>
        </WindowHeader>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MediaApp
          adapter={adapter}
          embedded
          assetBase={ASSETS}
          cloudAvailable={cloud.available}
          onOpenCloud={() => showCloud("media")}
          onShare={setSharing}
          onWallpaper={onWallpaper}
          onDirtyChange={onDirtyChange}
          notice={cloud.available ? undefined : <CloudOffNotice app="media" />}
        />
      </div>
      <VoidexShareDialog
        subject={
          sharing
            ? {
                key: sharing.map((m) => m.id).join(","),
                icon: (
                  <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-surface-secondary">
                    <MediaGlyph className="size-8" />
                  </span>
                ),
                title: sharing.length === 1 ? fileName(sharing[0]!) : t("share.mediaHint", { n: sharing.length }),
                hint: t("share.fileHint"),
              }
            : null
        }
        onClose={() => setSharing(null)}
        onSend={async (input) => {
          const files = await Promise.all(sharing!.map(async (m) => new File([await itemBlob(m)], fileName(m), { type: m.mime })));
          await sendFiles(input, files);
        }}
        testId="media-share"
      />
    </div>
  );
}
