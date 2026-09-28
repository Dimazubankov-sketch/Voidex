import { useState } from "react";
import { isPasswordAcceptable, type ChallengeDto, type SessionResponse } from "@voidex/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Notice, PasswordField, RoundNavButton, TextField } from "@/ui/controls";
import { ChallengeChoose, ChallengeDevice, ChallengeSms, type ChallengeStage } from "./challenge";
import { FlowFooter, FlowShell, StepBody, StepStage } from "./flow-shell";
import { PasswordStrength } from "./signup";

type Stage = "identify" | ChallengeStage | "password";
const ORDER: Stage[] = ["identify", "choose", "sms", "device", "password"];

/** Forgot password → identify → SMS or trusted-device approval → new password → workspace. */
export function RecoveryFlow({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [stage, setStage] = useState<Stage>("identify");
  const [dir, setDir] = useState<1 | -1>(1);
  const [identifier, setIdentifier] = useState("");
  const [challenge, setChallenge] = useState<ChallengeDto | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (s: Stage) => {
    setDir(ORDER.indexOf(s) >= ORDER.indexOf(stage) ? 1 : -1);
    setError(null);
    setStage(s);
  };

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await api.post<ChallengeDto>("/api/auth/recovery/start", { identifier: identifier.trim() }, { anonymous: true }));
      go("choose");
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<SessionResponse>(
        "/api/auth/recovery/reset",
        { challengeId: challenge.id, secret: challenge.secret, newPassword: password },
        { anonymous: true },
      );
      useSession.getState().setSession(s);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const passwordOk = isPasswordAcceptable(password) && password === confirm;
  const back = () => {
    if (stage === "identify") return onExit();
    if (stage === "choose" || stage === "password") return go(stage === "choose" ? "identify" : "choose");
    go("choose");
  };

  return (
    <FlowShell
      footer={
        <FlowFooter
          left={<RoundNavButton direction="back" label={t("common.back")} onClick={back} />}
          right={
            stage === "identify" ? (
              <RoundNavButton label={t("common.next")} onClick={start} loading={busy} disabled={!identifier.trim()} />
            ) : stage === "password" ? (
              <RoundNavButton label={t("recovery.submit")} onClick={reset} loading={busy} disabled={!passwordOk} />
            ) : null
          }
        />
      }
    >
      <StepStage stepKey={stage} direction={dir}>
        {stage === "identify" && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (identifier.trim()) void start();
            }}
          >
            <StepBody title={t("recovery.title")} subtitle={t("recovery.subtitle")}>
              <TextField
                label={t("login.identifier")}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                data-testid="recovery-identifier"
              />
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
            </StepBody>
          </form>
        )}
        {stage === "choose" && challenge && <ChallengeChoose challenge={challenge} onPick={(m) => go(m)} error={error} />}
        {stage === "sms" && challenge && <ChallengeSms challenge={challenge} onVerified={() => window.setTimeout(() => go("password"), 400)} />}
        {stage === "device" && challenge && <ChallengeDevice challenge={challenge} onApproved={() => go("password")} onUseSms={() => go("sms")} />}
        {stage === "password" && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (passwordOk) void reset();
            }}
          >
            <StepBody title={t("recovery.newTitle")} subtitle={t("recovery.newSubtitle")}>
              <div className="space-y-3">
                <PasswordField
                  label={t("settings.password.new")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                  showLabel={t("common.show")}
                  hideLabel={t("common.hide")}
                  data-testid="new-password"
                />
                <PasswordField
                  label={t("settings.password.confirm")}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  showLabel={t("common.show")}
                  hideLabel={t("common.hide")}
                  error={confirm && confirm !== password && confirm.length >= password.length ? t("signup.password.mismatch") : undefined}
                  data-testid="new-password-confirm"
                />
              </div>
              <PasswordStrength password={password} />
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
              <button type="submit" hidden />
            </StepBody>
          </form>
        )}
      </StepStage>
    </FlowShell>
  );
}
