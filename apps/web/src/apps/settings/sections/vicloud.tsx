import { useState, type ComponentType, type ReactNode } from "react";
import {
  RiCheckLine,
  RiCloudLine,
  RiCloudOffLine,
  RiDatabase2Line,
  RiDownload2Line,
  RiHistoryLine,
  RiImage2Line,
  RiLock2Line,
  RiRefreshLine,
  RiShieldCheckLine,
  RiShieldKeyholeLine,
  RiSignalTowerLine,
  RiUploadCloud2Line,
  RiVipDiamondLine,
} from "@remixicon/react";
import { APP_REGISTRY, type ViCloudPrefs } from "@voidex/shared";
import { Avatar, FilesGlyph, MediaGlyph } from "@/brand/brand";
import { useUpdatePreferences } from "@/lib/account";
import { formatStorage, GB } from "@/lib/bytes";
import { cx } from "@/lib/cx";
import { useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useCloudStatus } from "@/os/cloud/cloud";
import { Button, Switch } from "@/ui/controls";
import { Badge, Group, Row } from "../kit";
import type { SectionProps } from "../settings-app";

/*
 * Step 2.8 — ViCloud, the cloud of VOIDEX, inside Settings (not an app).
 * Its logic is iCloud's: one account storage for Files, Media and backups,
 * plans, sync per app, backup, privacy. ViCloud is not running yet, so every
 * screen says so and shows only true numbers: nothing is stored there (0 B
 * of the free 5 GB), no payments, no uploads. The choices people make here
 * are kept with the account and take effect when ViCloud starts.
 */

export const VICLOUD_ICON = "/brand/vicloud.webp";

/** ViCloud+ plans (no prices: payment is not available). */
const PLANS = [
  { id: "50", bytes: 50 * GB, hint: "vicloud.plan.50" },
  { id: "200", bytes: 200 * GB, hint: "vicloud.plan.200" },
  { id: "1tb", bytes: 1024 * GB, hint: "vicloud.plan.1tb" },
] as const;

/** The ViCloud logo the user sent, as a small app-like tile. */
export function ViCloudIcon({ className }: { className?: string }) {
  return <img src={VICLOUD_ICON} alt="" draggable={false} className={cx("shrink-0 select-none rounded-[22%] shadow-[0_2px_8px_rgba(80,60,200,0.18)]", className)} data-system-asset />;
}

function Hero({ title, subtitle, art }: { title: ReactNode; subtitle: ReactNode; art?: ReactNode }) {
  return (
    <div className="relative mb-5 px-1 pt-1">
      {art && <div className="pointer-events-none absolute -top-1 right-0">{art}</div>}
      <h2 className="relative max-w-[70%] text-[30px] font-bold leading-tight tracking-tight text-text">{title}</h2>
      <p className="relative mt-1 max-w-[68%] text-[14px] leading-snug text-text-secondary">{subtitle}</p>
    </div>
  );
}

function TileIcon({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) {
  return <Icon className="size-[18px]" />;
}

/** The honest state line: ViCloud is not running yet. */
function NotRunning({ testId }: { testId?: string }) {
  const t = useT();
  return (
    <div className="mb-6 flex items-start gap-3 rounded-[22px] border border-border/70 bg-surface p-4 shadow-tile" role="status" data-testid={testId ?? "vicloud-status"}>
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface-secondary text-text-secondary">
        <RiCloudOffLine className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-text">{t("vicloud.notRunning")}</span>
        <span className="block text-[13px] leading-snug text-text-secondary">{t("vicloud.notRunningHint")}</span>
      </span>
    </div>
  );
}

/** Used of total with the categories (all zero today: nothing is stored in ViCloud). */
export function ViCloudUsage({ compact }: { compact?: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const status = useCloudStatus();
  const used = status.usedBytes ?? 0;
  const total = status.quotaBytes;
  const parts = [
    { key: "files", label: t("vicloud.cat.files"), bytes: 0, color: "#6c5cff" },
    { key: "media", label: t("vicloud.cat.media"), bytes: 0, color: "#a58bff" },
    { key: "backups", label: t("vicloud.cat.backups"), bytes: 0, color: "#d16cf0" },
  ];
  return (
    <div className={cx("rounded-[18px] bg-surface-secondary/70", compact ? "p-3" : "p-3.5")} data-testid="vicloud-usage">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-text" data-testid="vicloud-usage-text">
          {t("vicloud.usedOf", { used: formatStorage(used, lang), total: formatStorage(total, lang) })}
        </span>
        <span className="text-[13px] font-semibold tabular-nums text-primary">{Math.round((used / total) * 100)}%</span>
      </div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-border/80" aria-hidden>
        {used > 0 && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (used / total) * 100)}%` }} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {parts.map((p) => (
          <span key={p.key} className="flex min-w-0 items-start gap-1.5">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-text-secondary">{p.label}</span>
              <span className="block text-[12.5px] font-medium tabular-nums text-text">{formatStorage(p.bytes, lang)}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Settings → ViCloud: the account's cloud, its storage and every ViCloud screen. */
export function ViCloudSection({ navigate }: SectionProps) {
  const t = useT();
  const user = useSession((s) => s.user)!;
  const name = `${user.firstName} ${user.lastName}`;
  return (
    <div data-testid="settings-vicloud">
      <Hero title="ViCloud" subtitle={t("vicloud.subtitle")} art={<ViCloudIcon className="size-[84px] rotate-[8deg] opacity-95" />} />
      <section className="mb-6 overflow-hidden rounded-[24px] border border-border/70 bg-surface p-3.5 shadow-tile">
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={name} userId={user.id} version={user.avatarVersion} size={48} />
          <span className="min-w-0">
            <span className="block truncate text-[16.5px] font-semibold text-text">{name}</span>
            <span className="block truncate text-[12.5px] text-text-secondary">{user.mailAddress}</span>
          </span>
        </div>
        <ViCloudUsage />
      </section>
      <NotRunning />
      <Group title="ViCloud">
        <Row icon={<TileIcon icon={RiDatabase2Line} />} label={t("vicloud.manage")} hint={t("vicloud.manageHint")} onClick={() => navigate("vicloud-storage")} chevron testId="vicloud-open-storage" />
        <Row icon={<TileIcon icon={RiRefreshLine} />} label={t("vicloud.sync")} hint={t("vicloud.syncHint")} onClick={() => navigate("vicloud-sync")} chevron testId="vicloud-open-sync" />
        <Row icon={<TileIcon icon={RiUploadCloud2Line} />} label={t("vicloud.backup")} hint={t("vicloud.backupHint")} onClick={() => navigate("vicloud-backup")} chevron testId="vicloud-open-backup" />
        <Row icon={<TileIcon icon={RiShieldCheckLine} />} label={t("vicloud.privacy")} hint={t("vicloud.privacyHint")} onClick={() => navigate("vicloud-privacy")} chevron testId="vicloud-open-privacy" />
        <Row icon={<TileIcon icon={RiVipDiamondLine} />} label={t("vicloud.plans")} hint={t("vicloud.plansHint")} onClick={() => navigate("vicloud-plans")} chevron testId="vicloud-open-plans" />
      </Group>
    </div>
  );
}

/** ViCloud+ plans: 50 GB, 200 GB, 1 TB. Choosing is possible; paying is not (yet). */
export function ViCloudPlansSection(_: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const status = useCloudStatus();
  const [plan, setPlan] = useState<string>("200");
  return (
    <div data-testid="settings-vicloud-plans">
      <Hero
        title={t("vicloud.plans")}
        subtitle={t("vicloud.plansSubtitle")}
        art={
          <span className="grid size-[76px] rotate-[8deg] place-items-center rounded-[22px] border border-white/80 bg-[linear-gradient(150deg,rgba(255,255,255,0.9),rgba(228,221,255,0.7))] text-primary shadow-[0_10px_30px_-12px_rgba(106,77,245,0.5)]">
            <RiVipDiamondLine className="size-9" />
          </span>
        }
      />
      <div className="mb-3 flex items-center justify-between rounded-[18px] border border-border/70 bg-surface px-4 py-3 text-[14px] shadow-tile">
        <span className="text-text-secondary">{t("vicloud.currentPlan")}</span>
        <span className="font-semibold text-text">{t("vicloud.freePlan", { size: formatStorage(status.quotaBytes, lang) })}</span>
      </div>
      <div className="mb-3 overflow-hidden rounded-[22px] border border-border/70 bg-surface p-1.5 shadow-tile" role="radiogroup" aria-label={t("vicloud.plans")} data-testid="vicloud-plan-list">
        {PLANS.map((p) => {
          const on = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPlan(p.id)}
              className={cx("flex w-full items-center gap-3 rounded-[16px] border px-3.5 py-3 text-left transition-colors", on ? "border-primary/60 bg-primary/[0.06]" : "border-transparent hover:bg-surface-hover")}
              data-testid={`vicloud-plan-${p.id}`}
            >
              <span className="min-w-0 flex-1">
                <span className={cx("block text-[17px] font-bold", on ? "text-primary-strong" : "text-text")}>{formatStorage(p.bytes, lang)}</span>
                <span className="block text-[12.5px] text-text-secondary">{t(p.hint)}</span>
              </span>
              <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-white" : "border-border-strong")}>
                {on && <RiCheckLine className="size-4" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mb-4 px-2 text-[13px] leading-snug text-text-secondary" data-testid="vicloud-payment-note">
        {t("vicloud.paymentUnavailable")}
      </p>
      <Button className="w-full" disabled data-testid="vicloud-upgrade">
        {t("vicloud.upgradeUnavailable")}
      </Button>
    </div>
  );
}

/** Storage management: what ViCloud keeps, by category, and the way to more space. */
export function ViCloudStorageSection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  return (
    <div data-testid="settings-vicloud-storage">
      <Hero title={t("vicloud.manage")} subtitle={t("vicloud.manageSubtitle")} art={<ViCloudIcon className="size-[72px] rotate-[8deg]" />} />
      <section className="mb-6 rounded-[22px] border border-border/70 bg-surface p-3.5 shadow-tile">
        <ViCloudUsage compact />
      </section>
      <NotRunning testId="vicloud-storage-status" />
      <Group title={t("vicloud.byCategory")} footer={t("vicloud.emptyHint")}>
        <Row icon={<FilesGlyph className="size-[22px]" />} label={APP_REGISTRY.files.name[lang]} value={formatStorage(0, lang)} testId="vicloud-cat-files" />
        <Row icon={<MediaGlyph className="size-[22px]" />} label={APP_REGISTRY.media.name[lang]} value={formatStorage(0, lang)} testId="vicloud-cat-media" />
        <Row icon={<TileIcon icon={RiHistoryLine} />} label={t("vicloud.cat.backups")} value={formatStorage(0, lang)} testId="vicloud-cat-backups" />
      </Group>
      <Group>
        <Row icon={<TileIcon icon={RiVipDiamondLine} />} label={t("vicloud.more")} onClick={() => navigate("vicloud-plans")} chevron testId="vicloud-more-space" />
      </Group>
    </div>
  );
}

function usePrefs() {
  const prefs = useSession((s) => s.user!.preferences.vicloud);
  const update = useUpdatePreferences();
  return { prefs, set: (patch: Partial<ViCloudPrefs>) => update.mutate({ vicloud: patch }) };
}

/** Which apps keep their data in ViCloud. Notes, Mail and Vibex live on the VOIDEX servers already. */
export function ViCloudSyncSection(_: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const { prefs, set } = usePrefs();
  return (
    <div data-testid="settings-vicloud-sync">
      <Hero title={t("vicloud.sync")} subtitle={t("vicloud.syncSubtitle")} />
      <NotRunning testId="vicloud-sync-status" />
      <Group title={t("vicloud.syncApps")} footer={t("vicloud.syncFooter")}>
        <Row
          icon={<FilesGlyph className="size-[22px]" />}
          label={APP_REGISTRY.files.name[lang]}
          hint={t("vicloud.syncFilesHint")}
          right={<Switch checked={prefs.syncFiles} onChange={(v) => set({ syncFiles: v })} label={APP_REGISTRY.files.name[lang]} />}
          testId="vicloud-sync-files"
        />
        <Row
          icon={<MediaGlyph className="size-[22px]" />}
          label={APP_REGISTRY.media.name[lang]}
          hint={t("vicloud.syncMediaHint")}
          right={<Switch checked={prefs.syncMedia} onChange={(v) => set({ syncMedia: v })} label={APP_REGISTRY.media.name[lang]} />}
          testId="vicloud-sync-media"
        />
      </Group>
      <Group title={t("vicloud.alwaysSynced")}>
        {(["notes", "mail", "vibex"] as const).map((id) => (
          <Row key={id} icon={<TileIcon icon={RiCloudLine} />} label={APP_REGISTRY[id].name[lang]} value={t("vicloud.onServer")} />
        ))}
      </Group>
    </div>
  );
}

/** Backup: the switches people expect; nothing runs until ViCloud does. */
export function ViCloudBackupSection(_: SectionProps) {
  const t = useT();
  const { prefs, set } = usePrefs();
  return (
    <div data-testid="settings-vicloud-backup">
      <Hero title={t("vicloud.backup")} subtitle={t("vicloud.backupSubtitle")} />
      <Group footer={t("vicloud.backupMainHint")}>
        <Row
          icon={<TileIcon icon={RiUploadCloud2Line} />}
          label={t("vicloud.backupMain")}
          right={<Switch checked={prefs.backup} onChange={(v) => set({ backup: v })} label={t("vicloud.backupMain")} />}
          testId="vicloud-backup-toggle"
        />
      </Group>
      <NotRunning testId="vicloud-backup-status" />
      <Group>
        <Row icon={<TileIcon icon={RiHistoryLine} />} label={t("vicloud.lastBackup")} value={t("vicloud.never")} testId="vicloud-last-backup" />
        <Row
          icon={<TileIcon icon={RiImage2Line} />}
          label={t("vicloud.backupMedia")}
          right={<Switch checked={prefs.backupMedia} disabled={!prefs.backup} onChange={(v) => set({ backupMedia: v })} label={t("vicloud.backupMedia")} />}
          testId="vicloud-backup-media"
        />
        <Row
          icon={<TileIcon icon={RiSignalTowerLine} />}
          label={t("vicloud.backupCellular")}
          hint={t("vicloud.backupCellularHint")}
          right={<Switch checked={prefs.backupCellular} disabled={!prefs.backup} onChange={(v) => set({ backupCellular: v })} label={t("vicloud.backupCellular")} />}
          testId="vicloud-backup-cellular"
        />
      </Group>
      <Button variant="secondary" className="w-full" disabled data-testid="vicloud-backup-now">
        {t("vicloud.backupNow")}
      </Button>
      <p className="mt-2 px-2 text-center text-[12.5px] text-text-tertiary">{t("vicloud.backupNowHint")}</p>
    </div>
  );
}

/** Privacy and protection: what is true today, and where the related settings live. */
export function ViCloudPrivacySection({ navigate }: SectionProps) {
  const t = useT();
  return (
    <div data-testid="settings-vicloud-privacy">
      <Hero title={t("vicloud.privacy")} subtitle={t("vicloud.privacySubtitle")} />
      <Group>
        <Row icon={<TileIcon icon={RiShieldKeyholeLine} />} label={t("vicloud.transport")} hint={t("vicloud.transportHint")} right={<Badge tone="success">{t("vicloud.on")}</Badge>} testId="vicloud-transport" />
        <Row
          icon={<TileIcon icon={RiShieldCheckLine} />}
          label={t("vicloud.advanced")}
          hint={t("vicloud.advancedHint")}
          right={<Badge>{t("vicloud.unavailable")}</Badge>}
          testId="vicloud-advanced"
        />
      </Group>
      <Group>
        <Row icon={<TileIcon icon={RiLock2Line} />} label={t("settings.lock")} hint={t("settings.hint.lock")} onClick={() => navigate("lock")} chevron testId="vicloud-open-lock" />
        <Row icon={<TileIcon icon={RiDownload2Line} />} label={t("settings.privacy")} hint={t("vicloud.exportHint")} onClick={() => navigate("privacy")} chevron testId="vicloud-open-data" />
      </Group>
    </div>
  );
}
