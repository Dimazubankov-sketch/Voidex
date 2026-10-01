import { useEffect, useRef, useState } from "react";
import { RiArrowRightSLine, RiCheckLine, RiMacbookLine, RiMessage2Line } from "@remixicon/react";
import type { ChallengeDto, ChallengeStatusDto, SessionResponse, VerificationStartedDto } from "@voidex/shared";
import { ApiError, api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { Button, Notice, OtpInput, Spinner } from "@/ui/controls";
import { StepBody } from "./flow-shell";

export type ChallengeStage = "choose" | "sms" | "device";

/** Pick how to confirm: SMS code or approval on a trusted device. */
export function ChallengeChoose({ challenge, onPick, error }: { challenge: ChallengeDto; onPick: (m: "sms" | "device") => void; error?: string | null }) {
  const t = useT();
  const option = (id: "sms" | "device", icon: React.ReactNode, title: string, hint: string) => (
    <button
      type="button"
      onClick={() => onPick(id)}
      data-testid={`challenge-${id}`}
      className="pressable flex w-full items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-4 text-left hover:bg-surface-hover"
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">{icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-text-secondary">{hint}</span>
      </span>
      <RiArrowRightSLine className="size-5 text-text-tertiary" />
    </button>
  );
  return (
    <StepBody title={t("challenge.title")} subtitle={challenge.kind === "login" ? t("challenge.subtitle") : t("challenge.recoverySubtitle")}>
      {challenge.methods.length === 0 && (
        <Notice tone="info" className="mb-3" data-testid="no-challenge-methods">
          {challenge.kind === "login" ? t("challenge.noMethodsLogin") : t("challenge.noMethodsRecovery")}
        </Notice>
      )}
      <div className="space-y-2.5">
        {option("sms", <RiMessage2Line className="size-5" />, t("challenge.sms", { phone: challenge.phoneMasked }), t("challenge.smsHint"))}
        {challenge.methods.includes("device") &&
          option("device", <RiMacbookLine className="size-5" />, t("challenge.device"), t("challenge.deviceHint"))}
      </div>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
    </StepBody>
  );
}

/** SMS code entry for a challenge. Calls onVerified once the server accepts the code. */
export function ChallengeSms({ challenge, onVerified }: { challenge: ChallengeDto; onVerified: () => void }) {
  const t = useT();
  const [sent, setSent] = useState<(VerificationStartedDto & { at: number }) | null>(null);
  const [code, setCode] = useState("");
  const [state, setState] = useState<"sending" | "idle" | "checking" | "ok" | "error">("sending");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const r = await api.post<VerificationStartedDto>(`/api/auth/challenges/${challenge.id}/sms`, { secret: challenge.secret }, { anonymous: true });
      setSent({ ...r, at: Date.now() });
      setState("idle");
    } catch (err) {
      setError(errorMessage(t, err));
      setState("error");
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(value: string) {
    setState("checking");
    setError(null);
    try {
      await api.post(`/api/auth/challenges/${challenge.id}/verify-sms`, { secret: challenge.secret, code: value }, { anonymous: true });
      setState("ok");
      onVerified();
    } catch (err) {
      setState("error");
      setError(errorMessage(t, err));
      setCode("");
    }
  }

  const wait = sent ? Math.max(0, Math.ceil((sent.at + sent.resendAfterSeconds * 1000 - now) / 1000)) : 0;
  return (
    <StepBody title={t("signup.otp.title")} subtitle={t("signup.otp.subtitle", { phone: challenge.phoneMasked })}>
      {sent?.devCode && (
        <Notice tone="warning" className="mb-4">
          <span data-testid="dev-code" data-code={sent.devCode}>
            {t("signup.otp.devNotice", { code: sent.devCode })}
          </span>
        </Notice>
      )}
      <OtpInput value={code} onChange={setCode} onComplete={verify} error={state === "error" && !!code} disabled={state === "checking" || state === "ok" || !sent} autoFocus />
      <div className="mt-4 flex min-h-6 items-center gap-2 text-[14px]">
        {(state === "checking" || state === "sending") && <Spinner className="text-primary" />}
        {state === "ok" && (
          <span className="flex items-center gap-1.5 font-medium text-success">
            <RiCheckLine className="size-5" /> {t("challenge.approved")}
          </span>
        )}
        {error && <span className="text-danger animate-fade-up">{error}</span>}
      </div>
      {state !== "ok" && (
        <Button variant="secondary" size="sm" className="mt-6" disabled={wait > 0 || state === "sending"} onClick={send}>
          {wait > 0 ? t("signup.otp.resendIn", { s: wait }) : t("signup.otp.resend")}
        </Button>
      )}
    </StepBody>
  );
}

/** Asks trusted devices to approve, then polls until someone decides. */
export function ChallengeDevice({ challenge, onApproved, onUseSms }: { challenge: ChallengeDto; onApproved: () => void; onUseSms: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ChallengeStatusDto["status"] | "requesting">("requesting");

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    (async () => {
      try {
        await api.post(`/api/auth/challenges/${challenge.id}/device`, { secret: challenge.secret }, { anonymous: true });
        setStatus("pending");
      } catch (err) {
        setError(errorMessage(t, err));
        return;
      }
      const poll = async () => {
        if (stop) return;
        try {
          const s = await api.post<ChallengeStatusDto>(`/api/auth/challenges/${challenge.id}/status`, { secret: challenge.secret }, { anonymous: true });
          setStatus(s.status);
          if (s.status === "approved") return onApproved();
          if (s.status === "denied") return setError(t("error.challenge_denied"));
        } catch (err) {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return setError(errorMessage(t, err));
        }
        timer = window.setTimeout(poll, 2000);
      };
      timer = window.setTimeout(poll, 1500);
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.id]);

  return (
    <StepBody title={t("challenge.waitTitle")} subtitle={t("challenge.waitSubtitle")}>
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-surface-secondary px-6 py-8 text-center">
        <div className="relative flex size-20 items-center justify-center rounded-3xl bg-surface shadow-tile">
          <RiMacbookLine className="size-9 text-primary" />
          {status !== "denied" && !error && <span className="absolute -right-1 -top-1 size-4 rounded-full bg-primary animate-glow" />}
        </div>
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <div className="flex items-center gap-2 text-[15px] text-text-secondary" data-testid="waiting-approval">
            <Spinner className="text-primary" /> {status === "approved" ? t("challenge.approved") : t("challenge.waiting")}
          </div>
        )}
      </div>
      <Button variant="ghost" className="mt-5" onClick={onUseSms}>
        {t("challenge.useSms")}
      </Button>
    </StepBody>
  );
}

/** `replaceSession`: an account switch — the current session ends once the new one exists. */
export async function completeLogin(challenge: ChallengeDto, opts: { replaceSession?: boolean } = {}) {
  return api.post<SessionResponse>(
    `/api/auth/challenges/${challenge.id}/complete`,
    { secret: challenge.secret, ...(opts.replaceSession ? { replaceSession: true } : {}) },
    { anonymous: !opts.replaceSession },
  );
}
