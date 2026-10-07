import { useMemo, useState } from "react";
import { create } from "zustand";
import { RiDeleteBin6Line, RiHardDrive2Line, RiLock2Line, RiNotification3Line } from "@remixicon/react";
import { APP_REGISTRY, DEFAULT_APP_PREFS, NOTIFICATION_APPS, type AppId } from "@voidex/shared";
import { AppTile } from "@/brand/brand";
import { useUpdatePreferences } from "@/lib/account";
import { appBytes, canOffload, offloadApp } from "@/lib/app-storage";
import { formatStorage } from "@/lib/bytes";
import { useLanguage, useT } from "@/lib/i18n";
import { useSecurityStatus } from "@/lib/security";
import { useSession } from "@/lib/session";
import { CLIENT_APPS } from "@/os/app-registry";
import { useInstalledApps } from "@/os/home/layout";
import { Skeleton, Switch } from "@/ui/controls";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";

/*
 * Step 2.8 — Settings → Apps: every installed app, alphabetically in the
 * interface language; each opens its own settings. The page is one simple
 * frame for every app (access, notifications, storage): a new app gets it
 * by being installed, a new setting is a new row.
 */

export const APPS_ICON = "/brand/settings-apps.webp";

/** Which app's page is open (Settings pages are flat; the app is their parameter). */
export const useAppSettingsTarget = create<{ id: AppId | null; set: (id: AppId) => void }>((set) => ({ id: null, set: (id) => set({ id }) }));

export function AppIcon({ id, size = 36 }: { id: AppId; size?: number }) {
  const { Icon } = CLIENT_APPS[id];
  return (
    <AppTile size={size} className="shrink-0">
      <span className="flex items-center justify-center" style={{ width: "58%", height: "58%" }}>
        <Icon className="size-full" />
      </span>
    </AppTile>
  );
}

/** Installed apps sorted by their name in the interface language. */
export function useSortedApps() {
  const lang = useLanguage();
  const { apps, isLoading } = useInstalledApps();
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
    return apps.map((a) => a.id).sort((a, b) => collator.compare(APP_REGISTRY[a].name[lang], APP_REGISTRY[b].name[lang]));
  }, [apps, lang]);
  return { ids: sorted, isLoading };
}

export function AppsSection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const { ids, isLoading } = useSortedApps();
  const open = useAppSettingsTarget((s) => s.set);
  return (
    <div data-testid="settings-apps">
      <SectionTitle subtitle={t("apps.subtitle")}>{t("settings.apps")}</SectionTitle>
      <Group>
        {isLoading && <Skeleton className="m-4 h-24" />}
        {ids.map((id) => (
          <Row
            key={id}
            icon={<AppIcon id={id} />}
            label={APP_REGISTRY[id].name[lang]}
            onClick={() => {
              open(id);
              navigate("app");
            }}
            chevron
            testId={`settings-app-${id}`}
          />
        ))}
      </Group>
    </div>
  );
}

/** One app's settings. */
export function AppSettingsSection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const id = useAppSettingsTarget((s) => s.id);
  const prefs = useSession((s) => (id ? s.user!.preferences.apps?.[id] : undefined));
  const update = useUpdatePreferences();
  const security = useSecurityStatus();
  const [asking, setAsking] = useState(false);
  const [bytes, setBytes] = useState(() => (id ? appBytes(id) : 0));
  if (!id) return null;
  const manifest = APP_REGISTRY[id];
  const p = { ...DEFAULT_APP_PREFS, ...prefs };
  const set = (patch: Partial<typeof p>) => update.mutate({ apps: { [id]: patch } });
  const hasPasscode = security.data?.passcodeEnabled === true;
  const notifies = (NOTIFICATION_APPS as readonly string[]).includes(id);
  return (
    <div data-testid="settings-app-page" data-app={id}>
      <div className="mb-6 flex items-center gap-4 rounded-[24px] border border-border/70 bg-surface p-4 shadow-tile">
        <AppIcon id={id} size={64} />
        <span className="min-w-0">
          <span className="block truncate text-[20px] font-bold tracking-tight text-text" data-testid="settings-app-name">
            {manifest.name[lang]}
          </span>
          <span className="block text-[13px] text-text-secondary">
            {t(manifest.kind === "system" ? "apps.system" : "apps.market")} · {t("apps.version", { version: manifest.version })}
          </span>
        </span>
      </div>

      <Group title={t("apps.access")} footer={hasPasscode ? t("apps.lockHint") : t("apps.lockNeedsCode")}>
        <Row
          icon={<RiLock2Line className="size-[18px]" />}
          label={t("apps.lock")}
          right={<Switch checked={p.lock && hasPasscode} disabled={!hasPasscode} onChange={(v) => set({ lock: v })} label={t("apps.lock")} />}
          testId="settings-app-lock"
        />
        {!hasPasscode && <Row label={t("apps.setCode")} onClick={() => navigate("lock")} chevron testId="settings-app-set-code" />}
      </Group>

      <Group title={t("settings.notifications")} footer={notifies ? t("apps.notificationsHint") : undefined}>
        {notifies ? (
          <Row
            icon={<RiNotification3Line className="size-[18px]" />}
            label={t("apps.notifications")}
            right={<Switch checked={p.notifications} onChange={(v) => set({ notifications: v })} label={t("apps.notifications")} />}
            testId="settings-app-notifications"
          />
        ) : (
          <Row icon={<RiNotification3Line className="size-[18px]" />} label={t("apps.noNotifications")} testId="settings-app-no-notifications" />
        )}
      </Group>

      <Group title={t("apps.storage")} footer={canOffload(id) ? t("apps.offloadHint") : t("apps.offloadSystem")}>
        <Row icon={<RiHardDrive2Line className="size-[18px]" />} label={t("apps.onDevice")} value={formatStorage(bytes, lang)} testId="settings-app-bytes" />
        {canOffload(id) && <Row icon={<RiDeleteBin6Line className="size-[18px]" />} label={t("apps.offload")} danger onClick={() => setAsking(true)} testId="settings-app-offload" />}
      </Group>

      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void offloadApp(id).then((done) => {
            setBytes(appBytes(id));
            if (done) toast({ title: t("apps.offloaded", { name: manifest.name[lang] }) });
          });
        }}
        title={t("apps.offloadTitle", { name: manifest.name[lang] })}
        message={t("apps.offloadBody")}
        confirmLabel={t("apps.offloadConfirm")}
        danger
      />
    </div>
  );
}
