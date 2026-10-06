import { RiCloudOffLine, RiFolder3Line, RiImage2Line } from "@remixicon/react";
import { useT } from "@/lib/i18n";
import { Sheet } from "@/ui/overlays";
import { useCloudDialog, useCloudStatus } from "./cloud";

/**
 * «Облако VOIDEX»: one dialog for the whole system. While the cloud is off it
 * says so plainly: no quota bar, no "synced", nothing uploaded.
 */
export function VoidexCloudDialog() {
  const t = useT();
  const { open, hide } = useCloudDialog();
  const status = useCloudStatus();
  const gb = Math.round(status.quotaBytes / 1024 ** 3);
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
        <p className="text-[14.5px] leading-relaxed text-text-secondary">{t("cloud.plan", { gb })}</p>
        <div className="grid grid-cols-2 gap-2">
          <span className="flex items-center gap-2 rounded-2xl border border-border px-3 py-2.5 text-[14px] text-text">
            <RiFolder3Line className="size-[18px] text-text-tertiary" />
            {t("cloud.files")}
          </span>
          <span className="flex items-center gap-2 rounded-2xl border border-border px-3 py-2.5 text-[14px] text-text">
            <RiImage2Line className="size-[18px] text-text-tertiary" />
            {t("cloud.media")}
          </span>
        </div>
        <p className="text-[13px] leading-snug text-text-tertiary">{t("cloud.session")}</p>
      </div>
    </Sheet>
  );
}
