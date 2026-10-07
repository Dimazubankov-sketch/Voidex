import { RiCloudOffLine, RiFolder3Line, RiImage2Line } from "@remixicon/react";
import { formatStorage } from "@/lib/bytes";
import { useLanguage, useT } from "@/lib/i18n";
import { Button } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { useWM } from "@/os/window-manager";
import { useCloudDialog, useCloudStatus } from "./cloud";

/**
 * ViCloud (Step 2.8; «Облако VOIDEX» in Step 2.7): one dialog for the whole
 * system, opened from Files, Media and the attach chooser. It shows the
 * account's ViCloud space (nothing is stored there yet: 0 B used of 5 GB)
 * and leads to Settings → ViCloud. While ViCloud is off it says so plainly.
 */
export function VoidexCloudDialog() {
  const t = useT();
  const lang = useLanguage();
  const { open, hide } = useCloudDialog();
  const status = useCloudStatus();
  const used = status.usedBytes ?? 0;
  const free = Math.max(0, status.quotaBytes - used);
  const openViCloud = () => {
    hide();
    useWM.getState().open("settings", { params: { section: "vicloud" } });
  };
  return (
    <Sheet open={open} onClose={hide} title={t("cloud.title")} width={440} testId="cloud-dialog" centered>
      <div className="flex flex-col gap-4" data-testid="cloud-dialog-body" data-available={status.available}>
        <div className="flex items-center gap-3 rounded-[20px] bg-surface-secondary p-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-text-secondary">
            <RiCloudOffLine className="size-6" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[16px] font-semibold text-text" data-testid="cloud-dialog-status">
              {t("cloud.unavailable")}
            </span>
            <span className="text-[13.5px] leading-snug text-text-secondary">{t("cloud.unavailableHint")}</span>
          </span>
        </div>
        <div className="rounded-[20px] border border-border p-4" data-testid="cloud-dialog-space">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-text">{t("cloud.free", { free: formatStorage(free, lang) })}</span>
            <span className="text-[13px] text-text-secondary">{t("vicloud.usedOf", { used: formatStorage(used, lang), total: formatStorage(status.quotaBytes, lang) })}</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-secondary" aria-hidden>
            {used > 0 && <div className="h-full rounded-full bg-primary" style={{ width: `${(used / status.quotaBytes) * 100}%` }} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <span className="flex items-center gap-2 text-[13.5px] text-text-secondary">
              <RiFolder3Line className="size-[17px] text-text-tertiary" />
              {t("cloud.files")}
            </span>
            <span className="flex items-center gap-2 text-[13.5px] text-text-secondary">
              <RiImage2Line className="size-[17px] text-text-tertiary" />
              {t("cloud.media")}
            </span>
          </div>
        </div>
        <p className="text-[13px] leading-snug text-text-tertiary">{t("cloud.session")}</p>
        <Button block onClick={openViCloud} data-testid="cloud-dialog-open-vicloud">
          {t("cloud.openViCloud")}
        </Button>
      </div>
    </Sheet>
  );
}
