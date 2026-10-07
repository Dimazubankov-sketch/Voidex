import { useEffect, useMemo, useState } from "react";
import { RiSmartphoneLine } from "@remixicon/react";
import { APP_REGISTRY, type AppId } from "@voidex/shared";
import { appBytes, deviceStorage, type DeviceStorage } from "@/lib/app-storage";
import { formatStorage } from "@/lib/bytes";
import { useLanguage, useT } from "@/lib/i18n";
import { Skeleton } from "@/ui/controls";
import { Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";
import { AppIcon, useAppSettingsTarget, useSortedApps } from "./apps";

/**
 * Step 2.8 — Settings → «Хранилище Voidex»: this device's storage, like
 * "iPhone Storage" (the cloud is ViCloud, a separate section). The total and
 * the used space are the browser's own figures for VOIDEX on this device;
 * the apps are listed by the space they take here, each opening its page
 * (with "Offload app").
 */
export function StorageSection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const { ids, isLoading } = useSortedApps();
  const open = useAppSettingsTarget((s) => s.set);
  const [device, setDevice] = useState<DeviceStorage | null>(null);
  useEffect(() => {
    void deviceStorage().then(setDevice);
  }, []);
  const apps = useMemo(() => ids.map((id) => ({ id, bytes: appBytes(id) })).sort((a, b) => b.bytes - a.bytes), [ids]);
  const appsTotal = apps.reduce((n, a) => n + a.bytes, 0);
  const used = device?.usage != null ? Math.max(device.usage, appsTotal) : null;
  const quota = device?.quota ?? null;
  const system = used != null ? Math.max(0, used - appsTotal) : null;
  const pct = (n: number) => (quota ? `${Math.max(n > 0 ? 1.5 : 0, (n / quota) * 100)}%` : "0%");

  return (
    <div data-testid="settings-storage">
      <SectionTitle subtitle={t("storage.subtitle")}>{t("settings.storage")}</SectionTitle>
      <section className="mb-6 rounded-[22px] border border-border/70 bg-surface p-4 shadow-tile" data-testid="storage-summary">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <span className="flex shrink-0 items-center gap-2 text-[16px] font-semibold text-text">
            <RiSmartphoneLine className="size-[18px] text-text-tertiary" />
            {t("storage.device")}
          </span>
          <span className="text-[13.5px] text-text-secondary sm:text-right" data-testid="storage-used">
            {!device
              ? "…"
              : used != null && quota != null
                ? t("storage.usedOf", { used: formatStorage(used, lang), total: formatStorage(quota, lang) })
                : t("storage.unknown")}
          </span>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-secondary" aria-hidden data-testid="storage-bar">
          <div className="h-full bg-primary" style={{ width: pct(appsTotal) }} />
          <div className="h-full bg-text-tertiary/60" style={{ width: pct(system ?? 0) }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-text-secondary">
          <Legend color="bg-primary" label={t("storage.apps")} value={formatStorage(appsTotal, lang)} />
          {system != null && <Legend color="bg-text-tertiary/60" label={t("storage.system")} value={formatStorage(system, lang)} />}
          {quota != null && used != null && <Legend color="bg-surface-secondary border border-border" label={t("storage.free")} value={formatStorage(Math.max(0, quota - used), lang)} />}
        </div>
      </section>

      <Group title={t("storage.byApp")} footer={t("storage.footer")}>
        {isLoading && <Skeleton className="m-4 h-24" />}
        {apps.map((a) => (
          <Row
            key={a.id}
            icon={<AppIcon id={a.id as AppId} />}
            label={APP_REGISTRY[a.id].name[lang]}
            value={formatStorage(a.bytes, lang)}
            onClick={() => {
              open(a.id);
              navigate("app");
            }}
            chevron
            testId={`storage-app-${a.id}`}
          />
        ))}
      </Group>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${color}`} />
      {label} <span className="font-medium tabular-nums text-text">{value}</span>
    </span>
  );
}
