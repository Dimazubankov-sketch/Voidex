import { useState } from "react";
import type { ChallengeDto, LoginResponse } from "@voidex/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { useSession, type SignedOutReason } from "@/lib/session";
import { Button, Notice, PasswordField, RoundNavButton, TextField } from "@/ui/controls";
import { VoidexMark } from "@/brand/brand";
import { ChallengeChoose, ChallengeDevice, ChallengeSms, completeLogin, type ChallengeStage } from "./challenge";
import { FlowFooter, FlowShell, StepBody, StepStage } from "./flow-shell";

type Stage = "credentials" | ChallengeStage;
const ORDER: Stage[] = ["credentials", "choose", "sms", "device"];

export function LoginFlow({ onExit, onForgot, onCreate, reason }: { onExit: () => void; onForgot: () => void; onCreate: () => void; reason?: SignedOutReason }) {
  const t = useT();
  const [stage, setStage] = useState<Stage>("credentials");
  const [dir, setDir] = useState<1 | -1>(1);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [challenge, setChallenge] = useState<ChallengeDto | null>(null);

  const go = (s: Stage) => {
    setDir(ORDER.indexOf(s) >= ORDER.indexOf(stage) ? 1 : -1);
    setError(null);
    setStage(s);
  };

  async function signIn() {
    if (!identifier.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<LoginResponse>("/api/auth/login", { identifier: identifier.trim(), password }, { anonymous: true });
      if (r.status === "ok") return useSession.getState().setSession(r);
      setChallenge(r.challenge);
      go("choose");
    } catch (err) {
      setError(errorMessage(t, err));
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!challenge) return;
    setBusy(true);
    try {
      useSession.getState().setSession(await completeLogin(challenge));
    } catch (err) {
      setError(errorMessage(t, err));
      go("choose");
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    if (stage === "credentials") return onExit();
    if (stage === "choose") {
      setChallenge(null);
      return go("credentials");
    }
    go("choose");
  };

  return (
    <FlowShell
      footer={
        <FlowFooter
          left={<RoundNavButton direction="back" label={t("common.back")} onClick={back} />}
          right={
            stage === "credentials" ? (
              <RoundNavButton label={t("login.submit")} onClick={signIn} loading={busy} disabled={!identifier.trim() || !password} />
            ) : null
          }
        />
      }
    >
      <StepStage stepKey={stage} direction={dir}>
        {stage === "credentials" && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <StepBody icon={<VoidexMark className="size-12" />} title={t("login.title")} subtitle={t("login.subtitle")}>
              {reason === "expired" && <Notice tone="info" className="mb-4">{t("os.sessionExpired")}</Notice>}
              {reason === "revoked" && <Notice tone="info" className="mb-4">{t("os.signedOutRemotely")}</Notice>}
              <div key={shake} className={shake ? "animate-shake space-y-3" : "space-y-3"}>
                <TextField
                  label={t("login.identifier")}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  data-testid="login-identifier"
                />
                <PasswordField
                  label={t("login.password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  showLabel={t("common.show")}
                  hideLabel={t("common.hide")}
                  data-testid="login-password"
                />
              </div>
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
              <div className="mt-5 flex flex-col items-start gap-1">
                <Button variant="ghost" size="sm" className="-ml-2 text-primary" onClick={onForgot} data-testid="forgot-password">
                  {t("login.forgot")}
                </Button>
                <div className="text-[14px] text-text-secondary">
                  {t("login.noAccount")}{" "}
                  <button type="button" className="font-semibold text-primary" onClick={onCreate}>
                    {t("login.createAccount")}
                  </button>
                </div>
              </div>
              <button type="submit" hidden />
            </StepBody>
          </form>
        )}
        {stage === "choose" && challenge && <ChallengeChoose challenge={challenge} onPick={(m) => go(m)} error={error} />}
        {stage === "sms" && challenge && <ChallengeSms challenge={challenge} onVerified={finish} />}
        {stage === "device" && challenge && <ChallengeDevice challenge={challenge} onApproved={finish} onUseSms={() => go("sms")} />}
      </StepStage>
    </FlowShell>
  );
}
