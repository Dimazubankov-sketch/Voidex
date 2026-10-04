import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorCode, type SecurityStatusDto } from "@voidex/shared";
import { api, ApiError, setStepUpHandler } from "@/lib/api";
import { faceIdAssertion, faceIdNotConfirmed, faceIdSupport } from "@/lib/faceid";
import { useT } from "@/lib/i18n";
import { requestStepUp, setSecurityStatus, useSecurityStatus, useStepUp } from "@/lib/security";
import { useSession } from "@/lib/session";
import { Button } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { FaceGlyph, FaceLens, type FaceState } from "./face-glyph";
import { mmss, passcodeErrorText, useCountdown } from "./lock-screen";
import { PasscodePad } from "./passcode-pad";

/**
 * "Confirm it's you" — the code-password or Face ID before sensitive
 * sections (personal data, password, phone, security, devices) and changes.
 * Mounted once; any API call answered with `step_up_required` opens it and
 * is repeated after the confirmation.
 */
export function StepUpSheet() {
  const t = useT();
  const open = useStepUp((s) => s.open);
  const finish = useStepUp((s) => s.finish);
  const status = useSecurityStatus(open).data;
  const supportQ = useQuery({ queryKey: ["face-id-support"], queryFn: faceIdSupport, staleTime: Infinity });
  const faceOffered = !!status?.faceIdOnThisDevice && supportQ.data === "available";
  const [mode, setMode] = useState<"face" | "passcode">("face");
  const [face, setFace] = useState<FaceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const blockedFor = useCountdown(lockedUntil ?? status?.passcodeLockedUntil ?? null);
  const autoTried = useRef(false);

  useEffect(() => {
    setStepUpHandler(requestStepUp);
    return () => setStepUpHandler(null);
  }, []);

  useEffect(() => {
    if (!open) {
      setMode("face");
      setFace("idle");
      setError(null);
      autoTried.current = false;
    }
  }, [open]);

  const done = (s: SecurityStatusDto) => {
    setSecurityStatus(s);
    finish(true);
  };

  const fatal = (err: unknown) => {
    if (err instanceof ApiError && err.code === ErrorCode.SessionRevoked) {
      toast({ title: t("lock.signedOutAttempts"), tone: "danger", duration: 7000 });
      finish(false);
      useSession.getState().signOutLocal("revoked");
      return true;
    }
    return false;
  };

  const [faceMsg, setFaceMsg] = useState<string | null>(null);
  const tryFace = useCallback(async (auto = false) => {
    setFace("scanning");
    try {
      const webauthn = await faceIdAssertion();
      const s = await api.post<SecurityStatusDto>("/api/security/step-up", { webauthn }, { noStepUp: true });
      setFace("success");
      window.setTimeout(() => done(s), 450);
    } catch (err) {
      if (fatal(err)) return;
      const unconfirmed = faceIdNotConfirmed(err);
      setFace(auto && unconfirmed ? "idle" : "error");
      setFaceMsg(unconfirmed ? t("lock.faceNotConfirmed") : t("lock.faceFailed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open && faceOffered && !autoTried.current) {
      autoTried.current = true;
      void tryFace(true);
    }
  }, [open, faceOffered, tryFace]);

  const submit = async (passcode: string) => {
    try {
      const s = await api.post<SecurityStatusDto>("/api/security/step-up", { passcode }, { noStepUp: true });
      done(s);
      return true;
    } catch (err) {
      if (fatal(err)) return false;
      const e = passcodeErrorText(err, t);
      setError(e.text);
      setLockedUntil(e.lockedUntil);
      return false;
    }
  };

  const effective = faceOffered ? mode : "passcode";

  return (
    <Sheet open={open} onClose={() => finish(false)} title={t("stepUp.title")} width={400} testId="step-up">
      <p className="-mt-1 mb-4 text-[14px] text-text-secondary">{t("stepUp.subtitle")}</p>
      {effective === "face" ? (
        <div className="flex flex-col items-center pb-2 text-center">
          <button type="button" onClick={() => void tryFace()} aria-label={t("lock.faceTry")} data-testid="step-up-face" className="rounded-full">
            <FaceLens state={face} size={120} />
          </button>
          <div className={face === "error" ? "mt-3 text-[14px] font-medium text-danger" : "mt-3 text-[14px] text-text-secondary"}>
            {face === "scanning" ? t("lock.faceScanning") : face === "error" ? faceMsg : face === "success" ? t("stepUp.confirmed") : t("lock.faceTap")}
          </div>
          <Button variant="secondary" className="mt-5" onClick={() => setMode("passcode")} data-testid="step-up-use-code">
            {t("lock.useCode")}
          </Button>
        </div>
      ) : (
        <PasscodePad
          title={t("stepUp.enterCode")}
          error={blockedFor > 0 ? t("lock.tryIn", { time: mmss(blockedFor) }) : error}
          disabled={blockedFor > 0}
          onSubmit={submit}
          testId="step-up-pad"
          extraKey={
            faceOffered ? (
              <button type="button" onClick={() => setMode("face")} className="rounded-[18px] p-2 hover:bg-surface-hover" aria-label={t("lock.useFace")}>
                <span className="block size-9">
                  <FaceGlyph state="idle" className="size-full" />
                </span>
              </button>
            ) : undefined
          }
        />
      )}
    </Sheet>
  );
}
