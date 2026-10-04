import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  RiComputerLine,
  RiDeviceLine,
  RiKeyLine,
  RiLogoutBoxRLine,
  RiMacbookLine,
  RiMessage2Line,
  RiPhoneLine,
  RiSmartphoneLine,
  RiTabletLine, RiLock2Line } from "@remixicon/react";
import { isPasswordAcceptable, type MeDto, type SessionDto, type VerificationStartedDto } from "@voidex/shared";
import { formatPhone, parsePhone, type CountryCode } from "@voidex/shared/phone";
import { ApiError, api } from "@/lib/api";
import { applyMe, signOutEverywhere } from "@/lib/account";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatRelative, useLanguage, useT } from "@/lib/i18n";
import { qk, queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Button, Notice, OtpInput, PasswordField, Skeleton, Switch } from "@/ui/controls";
import { PhoneField } from "@/ui/pickers";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { PasswordStrength } from "@/auth/signup";
import { Badge, Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";

function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api.get<SessionDto[]>("/api/security/sessions") });
}

export function SecuritySection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const me = useSession((s) => s.user)!;
  const sessions = useSessions();
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <div>
      <SectionTitle>{t("settings.security")}</SectionTitle>
      <Group>
        <Row
          icon={<RiKeyLine className="size-[18px]" />}
          label={t("settings.password.submit")}
          hint={t("settings.password.last", { date: formatDate(me.passwordChangedAt, lang) })}
          chevron
          onClick={() => navigate("password")}
          testId="security-password"
        />
        <Row
          icon={<RiPhoneLine className="size-[18px]" />}
          label={t("settings.security.phoneVerification")}
          hint={formatPhone(me.phone)}
          right={<Badge tone={me.phoneVerifiedAt ? "success" : "warning"}>{me.phoneVerifiedAt ? t("common.verified") : t("common.notVerified")}</Badge>}
          chevron
          onClick={() => navigate("phone")}
        />
        <Row
          icon={<RiLock2Line className="size-[18px]" />}
          label={t("settings.faceIdPasscode")}
          hint={t("settings.hint.lock")}
          chevron
          onClick={() => navigate("lock")}
          testId="security-lock"
        />
      </Group>
      <Group title={t("settings.security.recovery")}>
        <Row icon={<RiMessage2Line className="size-[18px]" />} label={t("settings.security.recoverySms", { phone: formatPhone(me.phone) })} />
        <Row
          icon={<RiMacbookLine className="size-[18px]" />}
          label={t("settings.security.recoveryDevice")}
          hint={sessions.data ? t("settings.security.trustedCount", { n: sessions.data.length }) : undefined}
        />
      </Group>
      <Group>
        <Row icon={<RiDeviceLine className="size-[18px]" />} label={t("settings.devices")} value={sessions.data?.length ?? ""} chevron onClick={() => navigate("devices")} />
        <Row icon={<RiLogoutBoxRLine className="size-[18px]" />} label={t("settings.signOutAll")} danger onClick={() => setConfirmAll(true)} />
      </Group>
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => void signOutEverywhere()}
        title={t("settings.signOutAll")}
        message={t("settings.signOutAllConfirm")}
        confirmLabel={t("settings.signOut")}
        danger
      />
    </div>
  );
}

export function PasswordSection() {
  const t = useT();
  const lang = useLanguage();
  const me = useSession((s) => s.user)!;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const change = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>("/api/account/password", { currentPassword: current, newPassword: next, signOutOtherDevices: signOutOthers }),
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      toast({ title: t("settings.password.done"), tone: "success" });
      applyMe(await api.get<MeDto>("/api/me"));
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
    },
  });
  const ctx = { firstName: me.firstName, lastName: me.lastName, username: me.mailAddress.split("@")[0], phone: me.phone };
  const ok = current && isPasswordAcceptable(next, ctx) && next === confirm;
  const fields = change.error instanceof ApiError ? change.error.fields : {};
  return (
    <div>
      <SectionTitle subtitle={t("settings.password.last", { date: formatDate(me.passwordChangedAt, lang) })}>{t("settings.password")}</SectionTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) change.mutate();
        }}
        className="space-y-3"
      >
        <PasswordField
          label={t("settings.password.current")}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          showLabel={t("common.show")}
          hideLabel={t("common.hide")}
          error={fields.currentPassword ? t("error.wrong_password") : undefined}
          data-testid="current-password"
        />
        <PasswordField
          label={t("settings.password.new")}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          showLabel={t("common.show")}
          hideLabel={t("common.hide")}
          error={fields.newPassword === "same" ? t("field.same") : undefined}
          data-testid="new-password"
        />
        <PasswordField
          label={t("settings.password.confirm")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          showLabel={t("common.show")}
          hideLabel={t("common.hide")}
          error={confirm && confirm !== next && confirm.length >= next.length ? t("signup.password.mismatch") : undefined}
          data-testid="new-password-confirm"
        />
        <PasswordStrength password={next} ctx={ctx} />
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
          <span className="text-[15px]">{t("settings.password.signOutOthers")}</span>
          <Switch checked={signOutOthers} onChange={setSignOutOthers} label={t("settings.password.signOutOthers")} />
        </div>
        {change.error && !fields.currentPassword && fields.newPassword !== "same" && <Notice tone="danger">{errorMessage(t, change.error)}</Notice>}
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={!ok} loading={change.isPending} data-testid="change-password">
            {t("settings.password.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PhoneSection() {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const [stage, setStage] = useState<"view" | "form" | "code">("view");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [verification, setVerification] = useState<VerificationStartedDto | null>(null);
  const [code, setCode] = useState("");
  const [country, setCountry] = useState(me.country as CountryCode);
  const parsed = parsePhone(phone, country);

  const start = useMutation({
    mutationFn: () => api.post<VerificationStartedDto>("/api/account/phone/start", { password, phone: parsed?.e164 ?? phone }),
    onSuccess: (v) => {
      setVerification(v);
      setStage("code");
    },
  });
  const confirm = useMutation({
    mutationFn: (c: string) => api.post<MeDto>("/api/account/phone/confirm", { verificationId: verification!.verificationId, code: c }),
    onSuccess: (me) => {
      applyMe(me);
      toast({ title: t("settings.phone.done"), tone: "success" });
      setStage("view");
      setPassword("");
      setPhone("");
      setCode("");
    },
    onError: () => setCode(""),
  });

  return (
    <div>
      <SectionTitle subtitle={t("settings.phone.usage")}>{t("settings.phone")}</SectionTitle>
      <Group>
        <Row
          label={t("settings.phone.current")}
          value={formatPhone(me.phone)}
          right={<Badge tone={me.phoneVerifiedAt ? "success" : "warning"}>{me.phoneVerifiedAt ? t("common.verified") : t("common.notVerified")}</Badge>}
        />
      </Group>
      {stage === "view" && (
        <Button variant="secondary" onClick={() => setStage("form")} data-testid="change-phone">
          {t("settings.phone.change")}
        </Button>
      )}
      {stage === "form" && (
        <form
          className="space-y-3 animate-fade-up"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && parsed) start.mutate();
          }}
        >
          <PasswordField
            label={t("settings.phone.confirmPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            showLabel={t("common.show")}
            hideLabel={t("common.hide")}
            error={start.error instanceof ApiError && start.error.fields.password ? t("error.wrong_password") : undefined}
          />
          <PhoneField label={t("settings.phone.new")} value={phone} onChange={setPhone} country={country} onCountryChange={setCountry} error={phone && !parsed ? t("error.phone_invalid") : undefined} />
          {start.error && !(start.error instanceof ApiError && start.error.fields.password) && <Notice tone="danger">{errorMessage(t, start.error)}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStage("view")}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!password || !parsed} loading={start.isPending}>
              {t("signup.phone.sendCode")}
            </Button>
          </div>
        </form>
      )}
      {stage === "code" && verification && (
        <div className="animate-fade-up">
          <p className="mb-3 text-[14px] text-text-secondary">{t("signup.otp.subtitle", { phone: parsed?.international ?? phone })}</p>
          {verification.devCode && (
            <Notice tone="warning" className="mb-3">
              <span data-testid="dev-code" data-code={verification.devCode}>
                {t("signup.otp.devNotice", { code: verification.devCode })}
              </span>
            </Notice>
          )}
          <OtpInput value={code} onChange={setCode} onComplete={(c) => confirm.mutate(c)} error={!!confirm.error} disabled={confirm.isPending} autoFocus />
          {confirm.error && <Notice tone="danger" className="mt-3">{errorMessage(t, confirm.error)}</Notice>}
          <Button variant="ghost" className="mt-3" onClick={() => setStage("form")}>
            {t("common.back")}
          </Button>
        </div>
      )}
    </div>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "size-5";
  if (platform === "ios" || platform === "android") return <RiSmartphoneLine className={cls} />;
  if (platform === "macos") return <RiMacbookLine className={cls} />;
  if (platform === "windows" || platform === "linux") return <RiComputerLine className={cls} />;
  return <RiTabletLine className={cls} />;
}

export function DevicesSection() {
  const t = useT();
  const lang = useLanguage();
  const sessions = useSessions();
  const [confirm, setConfirm] = useState<SessionDto | "others" | null>(null);
  const revoke = useMutation({
    mutationFn: async (target: SessionDto | "others") =>
      target === "others" ? api.post("/api/security/sessions/revoke-others") : api.delete(`/api/security/sessions/${target.id}`),
    onSuccess: () => {
      toast({ title: t("settings.devices.revoked"), tone: "success" });
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
    },
  });
  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current);

  return (
    <div>
      <SectionTitle>{t("settings.devices")}</SectionTitle>
      {sessions.isLoading && <Skeleton className="h-40 w-full rounded-[20px]" />}
      {sessions.error && (
        <Notice tone="danger">
          {errorMessage(t, sessions.error)}{" "}
          <button className="font-semibold underline" onClick={() => sessions.refetch()}>
            {t("common.retry")}
          </button>
        </Notice>
      )}
      {!!list.length && (
        <Group>
          {list.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 [&:not(:last-child)]:border-b" data-testid="session-row">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-text-secondary">
                <PlatformIcon platform={s.platform} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{s.deviceName}</span>
                  {s.current && <Badge tone="primary">{t("settings.devices.current")}</Badge>}
                </span>
                <span className="block truncate text-[13px] text-text-secondary">
                  {s.current ? t("settings.devices.signedIn", { date: formatDate(s.createdAt, lang) }) : t("settings.devices.lastActive", { time: formatRelative(s.lastActiveAt, lang) })}
                  {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                </span>
              </span>
              {!s.current && (
                <Button variant="danger" size="sm" onClick={() => setConfirm(s)} data-testid="session-revoke">
                  {t("settings.devices.signOut")}
                </Button>
              )}
            </div>
          ))}
        </Group>
      )}
      {sessions.data && !others.length && <p className="px-1 text-[14px] text-text-secondary">{t("settings.devices.none")}</p>}
      {others.length > 0 && (
        <Button variant="danger" onClick={() => setConfirm("others")}>
          {t("settings.devices.signOutOthers")}
        </Button>
      )}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && revoke.mutate(confirm)}
        loading={revoke.isPending}
        title={confirm === "others" ? t("settings.devices.signOutOthers") : t("settings.devices.signOut")}
        message={confirm && confirm !== "others" ? confirm.deviceName : undefined}
        confirmLabel={t("settings.devices.signOut")}
        danger
      />
    </div>
  );
}
