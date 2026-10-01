import { useState, type FormEvent, type ReactNode } from "react";
import { RiAddLine, RiArrowLeftLine, RiCheckLine } from "@remixicon/react";
import type { ChallengeDto, LoginResponse } from "@voidex/shared";
import { Avatar, VibexGlyph } from "@/brand/brand";
import { ChallengeChoose, ChallengeDevice, ChallengeSms, completeLogin } from "@/auth/challenge";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/account";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { forgetAccount, knownAccounts, reopenAfterSwitch } from "@/lib/known-accounts";
import { useSession } from "@/lib/session";
import { Button, Notice, PasswordField, TextField } from "@/ui/controls";
import { ConfirmDialog, Sheet } from "@/ui/overlays";
import { activateVibex } from "./data";

/**
 * Vibex sign-in — the Voyzen auth card on VOIDEX identity. Email + password,
 * no phone. It does NOT create a second account: it turns Vibex on for the
 * signed-in VOIDEX account (one email = one account = one Vibex profile).
 * Another account's email switches accounts through VOIDEX sessions.
 */
export function VibexAuth() {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState(me.mailAddress);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [switching, setSwitching] = useState(false);
  const signup = mode === "signup";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    setOther(false);
    try {
      await activateVibex(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.code === "vibex_other_account") setOther(true);
      else setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (switching) {
    return (
      <AuthStage>
        <SwitchFlow initialEmail={email.trim()} initialPassword={password} onCancel={() => setSwitching(false)} />
      </AuthStage>
    );
  }

  return (
    <AuthStage>
      <form onSubmit={submit} className="w-full rounded-3xl border border-border bg-surface p-7 shadow-tile sm:p-8" data-testid="vibex-auth">
        <div className="flex flex-col items-center gap-2 text-center">
          <VibexGlyph className="mb-2 size-14" />
          <h1 className="text-[24px] font-bold tracking-tight text-text">{signup ? t("vibex.auth.signupTitle") : t("vibex.auth.signinTitle")}</h1>
          <p className="text-[14px] text-text-secondary">{t("vibex.auth.subtitle")}</p>
        </div>
        <div className="mt-6 space-y-3">
          <TextField
            label={t("vibex.auth.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            data-testid="vibex-auth-email"
          />
          <PasswordField
            label={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            showLabel={t("common.show")}
            hideLabel={t("common.hide")}
            data-testid="vibex-auth-password"
          />
        </div>
        {signup && <p className="mt-3 text-[12px] text-text-tertiary">{t("vibex.auth.oneAccount")}</p>}
        {error && (
          <Notice tone="danger" className="mt-4">
            {error}
          </Notice>
        )}
        {other && (
          <Notice tone="info" className="mt-4" data-testid="vibex-auth-other">
            <div>{t("vibex.auth.otherAccount", { email: email.trim() })}</div>
            <Button size="sm" className="mt-2" onClick={() => setSwitching(true)} data-testid="vibex-auth-switch">
              {t("vibex.account.signInAs", { email: email.trim() })}
            </Button>
          </Notice>
        )}
        <Button type="submit" className="mt-5 w-full" loading={busy} disabled={!email.trim() || !password} data-testid="vibex-auth-submit">
          {signup ? t("vibex.auth.signupSubmit") : t("vibex.auth.signinSubmit")}
        </Button>
        <p className="mt-4 text-center text-[14px] text-text-secondary">
          {signup ? t("vibex.auth.haveProfile") : t("vibex.auth.noProfile")}{" "}
          <button
            type="button"
            className="font-semibold text-primary"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setError(null);
            }}
            data-testid="vibex-auth-mode"
          >
            {signup ? t("vibex.auth.signinLink") : t("vibex.auth.signupLink")}
          </button>
        </p>
      </form>
    </AuthStage>
  );
}

/** Voyzen's auth screen frame: soft brand glow, the wordmark, the card. */
function AuthStage({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="scroll-area relative flex min-h-0 flex-1 justify-center overflow-x-hidden bg-surface-secondary/60 px-4 py-8">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/15 blur-[110px]" />
      <div className="relative my-auto flex w-full max-w-[420px] flex-col items-center gap-6">
        <div className="flex items-center gap-2.5" data-system-ui>
          <VibexGlyph className="size-9" />
          <span className="text-[24px] font-bold tracking-tight text-text">{t("vibex.title")}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Sign in to another VOIDEX account and replace this device's session with it
 * (VOIDEX sessions: password, and the second factor on a device that isn't
 * trusted for that account). Vibex opens again for the new account.
 */
export function SwitchFlow({ initialEmail = "", initialPassword = "", onCancel }: { initialEmail?: string; initialPassword?: string; onCancel: () => void }) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeDto | null>(null);
  const [stage, setStage] = useState<"credentials" | "choose" | "sms" | "device">("credentials");

  const done = (r: Parameters<ReturnType<typeof useSession.getState>["setSession"]>[0]) => {
    reopenAfterSwitch("vibex");
    useSession.getState().setSession(r);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password || busy) return;
    if (email.trim().toLowerCase() === useSession.getState().user?.mailAddress) {
      setError(t("vibex.account.alreadyHere"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<LoginResponse>("/api/auth/login", { identifier: email.trim(), password, replaceSession: true });
      if (r.status === "ok") return done(r);
      setChallenge(r.challenge);
      setStage("choose");
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!challenge) return;
    try {
      done(await completeLogin(challenge, { replaceSession: true }));
    } catch (err) {
      setError(errorMessage(t, err));
      setStage("choose");
    }
  };

  return (
    <div className="w-full rounded-3xl border border-border bg-surface p-6 shadow-tile" data-testid="vibex-switch-flow">
      <button
        type="button"
        onClick={() => (stage === "credentials" ? onCancel() : setStage(stage === "choose" ? "credentials" : "choose"))}
        className="mb-4 flex items-center gap-1.5 text-[14px] font-medium text-text-secondary hover:text-text"
      >
        <RiArrowLeftLine className="size-4" />
        {t("common.back")}
      </button>
      {stage === "credentials" && (
        <form onSubmit={submit} className="space-y-3">
          <h2 className="text-[20px] font-bold tracking-tight">{t("vibex.account.signInOther")}</h2>
          <p className="text-[13px] text-text-secondary">{t("vibex.account.switchHint")}</p>
          <TextField label={t("vibex.auth.email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} data-testid="vibex-switch-email" />
          <PasswordField
            label={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus={!!initialEmail}
            showLabel={t("common.show")}
            hideLabel={t("common.hide")}
            data-testid="vibex-switch-password"
          />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" className="w-full" loading={busy} disabled={!email.trim() || !password} data-testid="vibex-switch-submit">
            {t("vibex.account.switchSubmit")}
          </Button>
        </form>
      )}
      {stage === "choose" && challenge && <ChallengeChoose challenge={challenge} onPick={(m) => setStage(m)} error={error} />}
      {stage === "sms" && challenge && <ChallengeSms challenge={challenge} onVerified={finish} />}
      {stage === "device" && challenge && <ChallengeDevice challenge={challenge} onApproved={finish} onUseSms={() => setStage("sms")} />}
    </div>
  );
}

/** Switch account: this account, accounts used on this device, add another, create a new VOIDEX account. */
export function AccountSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const me = useSession((s) => s.user)!;
  const [flow, setFlow] = useState<{ email: string } | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [, bump] = useState(0);
  const others = knownAccounts().filter((a) => a.id !== me.id);
  const close = () => {
    setFlow(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t("vibex.account.switch")} width={440} testId="vibex-account-switcher">
      {flow ? (
        <SwitchFlow initialEmail={flow.email} onCancel={() => setFlow(null)} />
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border">
            <AccountRow name={`${me.firstName} ${me.lastName}`} address={me.mailAddress} userId={me.id} version={me.avatarVersion} active />
            {others.map((a) => (
              <AccountRow
                key={a.id}
                name={a.name}
                address={a.address}
                userId={undefined}
                version={0}
                onClick={() => setFlow({ email: a.address })}
                onForget={() => {
                  forgetAccount(a.id);
                  bump((n) => n + 1);
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => setFlow({ email: "" })}
              className="flex w-full items-center gap-3 border-t px-4 py-3 text-left text-[14px] font-medium text-primary transition hover:bg-surface-secondary"
              data-testid="vibex-add-account"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary-soft">
                <RiAddLine className="size-5" />
              </span>
              {t("vibex.account.add")}
            </button>
          </div>
          <p className="text-[12px] text-text-tertiary">{t("vibex.account.oneEmail")}</p>
          <Button variant="ghost" size="sm" className="-ml-2 text-primary" onClick={() => setConfirmCreate(true)} data-testid="vibex-create-account">
            {t("vibex.account.create")}
          </Button>
          <ConfirmDialog
            open={confirmCreate}
            onClose={() => setConfirmCreate(false)}
            title={t("vibex.account.create")}
            message={t("vibex.account.createHint")}
            confirmLabel={t("common.continue")}
            onConfirm={() => {
              setConfirmCreate(false);
              void signOut();
            }}
          />
        </div>
      )}
    </Sheet>
  );
}

function AccountRow({ name, address, userId, version, active, onClick, onForget }: { name: string; address: string; userId?: string; version: number; active?: boolean; onClick?: () => void; onForget?: () => void }) {
  const t = useT();
  return (
    <div className={cx("flex items-center gap-3 px-4 py-3 [&:not(:first-child)]:border-t", onClick && "cursor-default hover:bg-surface-secondary")}>
      <button type="button" disabled={!onClick} onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid={active ? "vibex-account-current" : "vibex-account-other"}>
        <Avatar name={name} userId={userId} version={version} size={38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{name}</span>
          <span className="block truncate text-[12px] text-text-secondary">{address}</span>
        </span>
      </button>
      {active ? (
        <RiCheckLine className="size-5 shrink-0 text-primary" aria-label={t("vibex.account.current")} />
      ) : (
        onForget && (
          <button type="button" onClick={onForget} className="shrink-0 text-[12px] text-text-tertiary hover:text-text" title={t("vibex.account.forget")}>
            {t("vibex.account.forget")}
          </button>
        )
      )}
    </div>
  );
}
