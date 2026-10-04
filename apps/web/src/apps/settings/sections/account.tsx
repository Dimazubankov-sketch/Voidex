import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RiCameraLine, RiDeleteBinLine, RiKeyLine, RiLock2Line, RiLogoutBoxRLine, RiMailLine, RiPhoneLine, RiShieldCheckLine, RiDeviceLine, RiUserLine } from "@remixicon/react";
import { validateBirthDate, validateName, type MeDto } from "@voidex/shared";
import { formatPhone, type CountryCode } from "@voidex/shared/phone";
import { api } from "@/lib/api";
import { applyMe, prepareAvatar, signOut, signOutEverywhere, useUpdateProfile } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { errorMessage, fieldMessage } from "@/lib/errors";
import { countryName, flagEmoji, formatDate, useLanguage, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useFormFactor } from "@/lib/form-factor";
import { Avatar } from "@/brand/brand";
import { Button, Notice, TextField } from "@/ui/controls";
import { BirthDateFields, CountryList, LanguageList, datePartsToIso, isoToDateParts } from "@/ui/pickers";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { Badge, BrandFooter, Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";

function useMe(): MeDto {
  return useSession((s) => s.user)!;
}

export function AccountSection({ navigate }: SectionProps) {
  const t = useT();
  const lang = useLanguage();
  const me = useMe();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = `${me.firstName} ${me.lastName}`;
  const pc = useFormFactor() === "desktop";
  return (
    <div>
      {pc ? (
        // Step 2.5 (PC): a large profile card — picture, name, address, phone, country — with its actions.
        <div className="vx-profile-card relative mb-6 flex items-center gap-5 overflow-hidden rounded-[28px] border border-border/70 p-6 shadow-tile" data-testid="account-card">
          <span className="rounded-full p-1 shadow-[0_10px_30px_-12px_rgba(106,77,245,0.55)] ring-4 ring-surface">
            <Avatar name={name} userId={me.id} version={me.avatarVersion} size={96} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[26px] font-bold tracking-tight" data-testid="account-name">
              {name}
            </h2>
            <div className="truncate text-[14.5px] text-text-secondary" data-selectable>
              {me.mailAddress}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary-strong">{formatPhone(me.phone)}</span>
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-text-secondary">
                {flagEmoji(me.country)} {countryName(me.country, lang)}
              </span>
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-text-tertiary">{t("settings.memberSince", { date: formatDate(me.createdAt, lang) })}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Button size="sm" onClick={() => navigate("personal")} data-testid="account-edit">
              {t("settings.editProfile")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate("security")}>
              {t("settings.security")}
            </Button>
          </div>
        </div>
      ) : (
      <div className="relative mb-6 flex flex-col items-center overflow-hidden rounded-[26px] bg-[radial-gradient(90%_70%_at_50%_0%,rgba(150,128,255,0.18),rgba(150,128,255,0)_70%)] pb-2 pt-5 text-center">
        <span className="rounded-full p-1 shadow-[0_10px_30px_-12px_rgba(106,77,245,0.55)] ring-4 ring-surface">
          <Avatar name={name} userId={me.id} version={me.avatarVersion} size={92} />
        </span>
        <h2 className="mt-3 text-[24px] font-bold tracking-tight" data-testid="account-name">
          {name}
        </h2>
        <div className="text-[14px] text-text-secondary" data-selectable>
          {me.mailAddress}
        </div>
        <div className="mt-1 text-[12.5px] text-text-tertiary">{t("settings.memberSince", { date: formatDate(me.createdAt, lang) })}</div>
      </div>
      )}
      <Group>
        <Row icon={<RiUserLine className="size-[18px]" />} label={t("settings.personal")} hint={t("settings.hint.personal")} chevron onClick={() => navigate("personal")} testId="row-personal" />
        <Row icon={<RiMailLine className="size-[18px]" />} label={t("settings.email")} hint={me.mailAddress} chevron onClick={() => navigate("email")} testId="row-email" />
        <Row icon={<RiPhoneLine className="size-[18px]" />} label={t("settings.phone")} hint={formatPhone(me.phone)} chevron onClick={() => navigate("phone")} testId="row-phone" />
      </Group>
      <Group>
        <Row icon={<RiShieldCheckLine className="size-[18px]" />} label={t("settings.security")} hint={t("settings.hint.security")} chevron onClick={() => navigate("security")} testId="row-security" />
        <Row icon={<RiKeyLine className="size-[18px]" />} label={t("settings.password")} hint={t("settings.hint.password")} chevron onClick={() => navigate("password")} testId="row-password" />
        <Row icon={<RiDeviceLine className="size-[18px]" />} label={t("settings.devices")} hint={t("settings.hint.devices")} chevron onClick={() => navigate("devices")} testId="row-devices" />
        <Row icon={<RiLock2Line className="size-[18px]" />} label={t("settings.faceIdPasscode")} hint={t("settings.hint.lock")} chevron onClick={() => navigate("lock")} testId="row-lock" />
      </Group>
      <Group>
        <Row
          icon={<RiLogoutBoxRLine className="size-[18px]" />}
          label={t("settings.signOut")}
          danger
          chevron
          testId="sign-out"
          onClick={async () => {
            setBusy(true);
            await signOut().finally(() => setBusy(false));
          }}
          right={busy ? <span className="text-[13px] text-text-tertiary">…</span> : undefined}
        />
        <Row icon={<RiLogoutBoxRLine className="size-[18px]" />} label={t("settings.signOutAll")} danger chevron onClick={() => setConfirmAll(true)} testId="sign-out-all" />
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
      <BrandFooter />
    </div>
  );
}

export function PersonalSection() {
  const t = useT();
  const me = useMe();
  const [first, setFirst] = useState(me.firstName);
  const [last, setLast] = useState(me.lastName);
  const [birth, setBirth] = useState(isoToDateParts(me.birthDate));
  const update = useUpdateProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const avatar = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api.delete<MeDto>("/api/account/avatar");
      if (file.size > 10 * 1024 * 1024) throw new Error("too-large");
      const blob = await prepareAvatar(file);
      return api.put<MeDto>("/api/account/avatar", blob, { headers: { "Content-Type": "image/jpeg" } });
    },
    onSuccess: applyMe,
    onError: (err) => setAvatarError(err instanceof Error && err.message === "too-large" ? t("settings.avatarTooLarge") : errorMessage(t, err)),
  });

  const birthIso = datePartsToIso(birth);
  const birthErr = validateBirthDate(
    { day: Number(birth.day) || undefined, month: Number(birth.month) || undefined, year: birth.year.length === 4 ? Number(birth.year) : undefined },
    me.country as CountryCode,
  );
  const errs = { firstName: validateName(first), lastName: validateName(last) };
  const dirty = first.trim() !== me.firstName || last.trim() !== me.lastName || birthIso !== me.birthDate;
  const serverFields = update.error instanceof ApiError ? update.error.fields : {};
  const valid = !errs.firstName && !errs.lastName && !birthErr;

  return (
    <div>
      <SectionTitle>{t("settings.personal")}</SectionTitle>
      <Group title={t("settings.avatar")}>
        <div className="flex items-center gap-4 p-4">
          <Avatar name={`${me.firstName} ${me.lastName}`} userId={me.id} version={me.avatarVersion} size={64} />
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" size="sm" icon={<RiCameraLine className="size-4" />} onClick={() => fileRef.current?.click()} loading={avatar.isPending}>
              {t("settings.avatarChange")}
            </Button>
            {me.hasAvatar && (
              <Button variant="ghost" size="sm" icon={<RiDeleteBinLine className="size-4" />} onClick={() => avatar.mutate(null)} disabled={avatar.isPending}>
                {t("settings.avatarRemove")}
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              setAvatarError(null);
              const f = e.target.files?.[0];
              if (f) avatar.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
        {avatarError && <div className="px-4 pb-4"><Notice tone="danger">{avatarError}</Notice></div>}
      </Group>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !dirty) return;
          update.mutate(
            { firstName: first, lastName: last, birthDate: birthIso! },
            { onSuccess: () => toast({ title: t("settings.profileSaved"), tone: "success" }) },
          );
        }}
      >
        <div className="space-y-3">
          <TextField
            label={t("settings.firstName")}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            error={fieldMessage(t, errs.firstName ?? serverFields.firstName, "firstName")}
            autoComplete="given-name"
            data-testid="settings-first-name"
          />
          <TextField
            label={t("settings.lastName")}
            value={last}
            onChange={(e) => setLast(e.target.value)}
            error={fieldMessage(t, errs.lastName ?? serverFields.lastName, "lastName")}
            autoComplete="family-name"
          />
          <div>
            <div className="mb-2 px-1 text-[13px] text-text-secondary">{t("settings.birthDate")}</div>
            <BirthDateFields value={birth} onChange={setBirth} error={fieldMessage(t, birthErr ?? serverFields.birthDate ?? undefined)} />
          </div>
        </div>
        {update.error && !Object.keys(serverFields).length && <Notice tone="danger" className="mt-4">{errorMessage(t, update.error)}</Notice>}
        <div className="mt-5 flex justify-end gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setFirst(me.firstName);
                setLast(me.lastName);
                setBirth(isoToDateParts(me.birthDate));
              }}
            >
              {t("common.cancel")}
            </Button>
          )}
          <Button type="submit" disabled={!dirty || !valid} loading={update.isPending} data-testid="settings-save-profile">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function EmailSection() {
  const t = useT();
  const me = useMe();
  return (
    <div>
      <SectionTitle>{t("settings.email")}</SectionTitle>
      <Group footer={t("settings.email.note")}>
        <Row label={t("settings.email.address")} value={me.mailAddress} />
        <Row label={t("settings.email.type")} right={<Badge tone="primary">{t("settings.email.internal")}</Badge>} />
      </Group>
    </div>
  );
}

export function LanguageSection() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();
  return (
    <div>
      <SectionTitle subtitle={t("settings.language.hint")}>{t("settings.language")}</SectionTitle>
      <LanguageList value={me.language} onChange={(language) => language !== me.language && update.mutate({ language })} />
      {update.error && <Notice tone="danger" className="mt-4">{errorMessage(t, update.error)}</Notice>}
    </div>
  );
}

export function CountrySection() {
  const t = useT();
  const lang = useLanguage();
  const me = useMe();
  const update = useUpdateProfile();
  const err = update.error instanceof ApiError && update.error.fields.birthDate === "too_young" ? t("error.too_young") : update.error ? errorMessage(t, update.error) : null;
  return (
    <div>
      <SectionTitle subtitle={t("settings.country.hint")}>{t("settings.country")}</SectionTitle>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-primary-soft px-4 py-3 text-primary-strong">
        <span className="text-[22px]">{flagEmoji(me.country)}</span>
        <span className="font-semibold">{countryName(me.country, lang)}</span>
      </div>
      {err && <Notice tone="danger" className="mb-4">{err}</Notice>}
      <CountryList value={me.country} onChange={(country) => country !== me.country && update.mutate({ country })} />
    </div>
  );
}
