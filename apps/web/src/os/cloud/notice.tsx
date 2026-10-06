import { RiCloudOffLine } from "@remixicon/react";
import { useT } from "@/lib/i18n";
import { useCloudDialog, type CloudApp } from "./cloud";

/** The honest line at the top of Files and Media while VOIDEX Cloud is off. */
export function CloudOffNotice({ app }: { app: CloudApp }) {
  const t = useT();
  const show = useCloudDialog((s) => s.show);
  return (
    <div className="vx-cloud-notice" role="status" data-testid={`${app}-cloud-notice`}>
      <RiCloudOffLine className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1">{t("cloud.notSaved")}</span>
      <button type="button" onClick={() => show(app)} className="shrink-0 font-semibold text-primary" data-testid={`${app}-cloud-more`}>
        {t("cloud.more")}
      </button>
    </div>
  );
}
