import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RiDownload2Line, RiFileTextLine } from "@remixicon/react";
import type { ConsentDto, LegalDocumentDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { useUpdatePreferences } from "@/lib/account";
import { errorMessage } from "@/lib/errors";
import { formatDate, useLanguage, useT } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useSystemInfo } from "@/lib/system";
import { VoidexMark } from "@/brand/brand";
import { Notice, Skeleton, Switch } from "@/ui/controls";
import { LegalSheet } from "@/auth/legal-sheet";
import { Badge, Group, Row, SectionTitle } from "../kit";

function useLegalList() {
  const lang = useLanguage();
  return useQuery({
    queryKey: ["legal-list", lang],
    queryFn: () => api.get<Omit<LegalDocumentDto, "content">[]>(`/api/legal?lang=${lang}`, { anonymous: true }),
    staleTime: Infinity,
  });
}

export function PrivacySection() {
  const t = useT();
  const lang = useLanguage();
  const consents = useQuery({ queryKey: qk.consents, queryFn: () => api.get<ConsentDto[]>("/api/account/consents") });
  const docs = useLegalList();
  const [open, setOpen] = useState<string | null>(null);
  const exportData = useMutation({
    mutationFn: async () => {
      const data = await api.get<unknown>("/api/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voidex-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <div>
      <SectionTitle subtitle={t("settings.privacy.dataHint")}>{t("settings.privacy")}</SectionTitle>
      <Group title={t("settings.privacy.documents")}>
        {consents.isLoading && <Skeleton className="m-4 h-20" />}
        {consents.data?.map((c) => (
          <Row
            key={`${c.key}-${c.version}`}
            icon={<RiFileTextLine className="size-[18px]" />}
            label={docs.data?.find((d) => d.key === c.key)?.title ?? c.key}
            hint={t("settings.privacy.accepted", { date: formatDate(c.acceptedAt, lang), version: c.version })}
            onClick={() => setOpen(c.key)}
            chevron
          />
        ))}
      </Group>
      <Group footer={t("settings.privacy.exportHint")}>
        <Row
          icon={<RiDownload2Line className="size-[18px]" />}
          label={t("settings.privacy.export")}
          onClick={() => exportData.mutate()}
          right={exportData.isPending ? <span className="text-[13px] text-text-tertiary">…</span> : undefined}
          testId="export-data"
        />
      </Group>
      {exportData.error && <Notice tone="danger">{errorMessage(t, exportData.error)}</Notice>}
      <LegalSheet docKey={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function NotificationsSection() {
  const t = useT();
  const prefs = useSession((s) => s.user!.preferences.notifications);
  const update = useUpdatePreferences();
  const row = (key: keyof typeof prefs, label: string, hint: string, disabled?: boolean) => (
    <Row label={label} hint={hint} right={<Switch checked={prefs[key]} disabled={disabled} onChange={(v) => update.mutate({ notifications: { [key]: v } })} label={label} />} testId={`pref-${key}`} />
  );
  return (
    <div>
      <SectionTitle>{t("settings.notifications")}</SectionTitle>
      <Group>
        {row("newMailBanner", t("settings.notifications.banner"), t("settings.notifications.bannerHint"))}
        {row("showPreview", t("settings.notifications.preview"), t("settings.notifications.previewHint"), !prefs.newMailBanner)}
        {row("sound", t("settings.notifications.sound"), t("settings.notifications.soundHint"))}
      </Group>
      {update.error && <Notice tone="danger">{errorMessage(t, update.error)}</Notice>}
    </div>
  );
}

export function AboutSection() {
  const t = useT();
  const info = useSystemInfo();
  const docs = useLegalList();
  const [open, setOpen] = useState<string | null>(null);
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Web";
  return (
    <div>
      <div className="mb-8 flex flex-col items-center pt-4 text-center">
        <div className="relative">
          <div className="absolute inset-2 rounded-full bg-primary/30 blur-2xl" />
          <VoidexMark className="relative size-24" />
        </div>
        <div className="mt-4 text-[26px] font-bold tracking-[0.16em]">VOIDEX</div>
        <div className="text-[14px] text-text-secondary">{t("settings.about.tagline")}</div>
      </div>
      <Group>
        <Row label={t("settings.about.version")} value={info.data?.version ?? "…"} />
        <Row label={t("settings.about.environment")} value={info.data?.environment ?? "…"} />
        <Row label={t("settings.about.mailDomain")} value={info.data ? `@${info.data.mailDomain}` : "…"} />
        <Row
          label={t("settings.about.sms")}
          right={
            info.data &&
            (info.data.smsDevMode ? (
              <Badge tone="warning">{t("settings.about.smsDev")}</Badge>
            ) : !info.data.smsAvailable ? (
              <Badge>{t("settings.about.smsDisabled")}</Badge>
            ) : (
              <Badge tone="success">{info.data.smsProvider}</Badge>
            ))
          }
        />
        <Row label={t("settings.about.device")} value={device} />
      </Group>
      <Group title={t("settings.about.legal")}>
        {docs.data?.map((d) => (
          <Row key={d.key} icon={<RiFileTextLine className="size-[18px]" />} label={d.title} hint={`v${d.version}`} onClick={() => setOpen(d.key)} chevron />
        ))}
      </Group>
      <LegalSheet docKey={open} onClose={() => setOpen(null)} />
    </div>
  );
}
