import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { RiArrowRightLine, RiLock2Line, RiShieldCheckLine } from "@remixicon/react";
import type { SecurityStatusDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { faceIdNotConfirmed, faceIdSupport, registerFaceId, type FaceIdSupport } from "@/lib/faceid";
import { useT } from "@/lib/i18n";
import { setSecurityStatus } from "@/lib/security";
import { VoidexMark } from "@/brand/brand";
import { Button } from "@/ui/controls";
import { FaceLens, type FaceState } from "./face-glyph";
import { PasscodePad } from "./passcode-pad";

const EASE = [0.22, 1, 0.36, 1] as const;
const SETUP_BG = "radial-gradient(80% 60% at 85% -10%, rgba(150,128,255,0.30), rgba(150,128,255,0) 70%), radial-gradient(60% 50% at 0% 110%, rgba(176,150,255,0.20), rgba(176,150,255,0) 70%), #f8f6fc";

/**
 * First setup after registration: the code-password is required (it unlocks
 * VOIDEX and confirms sensitive changes), Face ID is offered and can be
 * skipped. Covers the desktop until the code-password exists.
 */
export function SecuritySetup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState<"create" | "confirm" | "face">("create");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  const support = useQuery({ queryKey: ["face-id-support"], queryFn: faceIdSupport, staleTime: Infinity }).data;
  const total = 3;
  const index = step === "create" ? 1 : step === "confirm" ? 2 : 3;

  return (
    <motion.div
      className="fixed inset-0 z-[390] flex flex-col overflow-y-auto"
      style={{ background: SETUP_BG }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      data-testid="security-setup"
      role="dialog"
      aria-modal="true"
    >
      <header className="flex items-center gap-2 px-5 pt-[max(var(--safe-top),14px)]">
        <VoidexMark className="size-6" />
        <span className="text-[13px] font-semibold tracking-[0.2em] text-text">VOIDEX</span>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <div className="vx-lock-card w-full max-w-[460px] rounded-[30px] px-6 pb-6 pt-6 sm:px-9">
          <div className="text-[12px] font-medium text-text-tertiary" data-testid="setup-step">
            {t("setup.step", { n: index, total })}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/12">
            <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,#9d8bff,#6a4df5)]" animate={{ width: `${(index / total) * 100}%` }} transition={{ duration: 0.4, ease: EASE }} />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22, ease: EASE }} className="mt-6">
              {step === "create" && (
                <>
                  <Intro icon={<RiLock2Line className="size-6" />} title={t("setup.codeTitle")} text={t("setup.codeText")} />
                  <div className="mt-5">
                    <PasscodePad
                      title={t("setup.codeCreate")}
                      error={error}
                      testId="setup-pad-create"
                      onSubmit={async (code) => {
                        if (/^(\d)\1{5}$/.test(code) || "0123456789".includes(code) || "9876543210".includes(code)) {
                          setError(t("setup.codeWeak"));
                          return false;
                        }
                        setFirst(code);
                        setError(null);
                        setStep("confirm");
                        return true;
                      }}
                    />
                  </div>
                </>
              )}
              {step === "confirm" && (
                <>
                  <Intro icon={<RiLock2Line className="size-6" />} title={t("setup.codeTitle")} text={t("setup.codeRepeatText")} />
                  <div className="mt-5">
                    <PasscodePad
                      title={t("setup.codeRepeat")}
                      error={error}
                      testId="setup-pad-confirm"
                      onSubmit={async (code) => {
                        if (code !== first) {
                          setError(t("setup.codeMismatch"));
                          setFirst("");
                          setStep("create");
                          return false;
                        }
                        try {
                          setSecurityStatus(await api.post<SecurityStatusDto>("/api/security/passcode", { passcode: code }));
                          setError(null);
                          setStep("face");
                          return true;
                        } catch {
                          setError(t("lock.failed"));
                          return false;
                        }
                      }}
                    />
                  </div>
                  <button type="button" className="mx-auto mt-3 block text-[13px] text-text-secondary hover:text-text" onClick={() => (setFirst(""), setStep("create"))}>
                    {t("common.back")}
                  </button>
                </>
              )}
              {step === "face" && <FaceIdSetup support={support} onDone={onDone} onSkip={onDone} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function Intro({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</span>
      <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-text">{title}</h1>
      <p className="mt-1.5 max-w-[340px] text-[14px] text-text-secondary">{text}</p>
    </div>
  );
}

/**
 * Face ID setup (onboarding and Settings). The device's own system prompt
 * does the face check; the ring shows the stage honestly (waiting for the
 * device → checking → done), never an invented scan percentage.
 */
export function FaceIdSetup({ support, onDone, onSkip, skipLabel }: { support: FaceIdSupport | undefined; onDone: () => void; onSkip: () => void; skipLabel?: string }) {
  const t = useT();
  const [state, setState] = useState<FaceState>("idle");
  const [stage, setStage] = useState<"ready" | "device" | "saving" | "done" | "failed" | "cancelled">("ready");

  const start = async () => {
    setState("scanning");
    setStage("device");
    try {
      const s = (await registerFaceId()) as SecurityStatusDto;
      setStage("saving");
      setSecurityStatus(s);
      setState("success");
      setStage("done");
    } catch (err) {
      setState("error");
      setStage(faceIdNotConfirmed(err) ? "cancelled" : "failed");
    }
  };

  if (support === undefined) return null;
  const available = support === "available";
  const progress = stage === "done" ? 1 : stage === "saving" ? 0.85 : undefined;

  return (
    <div className="flex flex-col items-center text-center" data-testid="face-setup" data-stage={stage}>
      <h1 className="text-[24px] font-semibold tracking-tight text-text">{t("setup.faceTitle")}</h1>
      <p className="mt-1.5 max-w-[340px] text-[14px] text-text-secondary">{t("setup.faceText")}</p>
      <div className="mt-6">
        <FaceLens state={available ? state : "idle"} size={150} progress={progress} />
      </div>
      {available ? (
        <>
          <span
            className={cx(
              "mt-4 rounded-full px-3 py-1 text-[12.5px] font-medium",
              stage === "failed" ? "bg-danger-soft text-danger" : stage === "done" ? "bg-success-soft text-success" : "bg-primary/10 text-primary",
            )}
            data-testid="face-setup-status"
          >
            {t(`setup.faceStage.${stage}`)}
          </span>
          <div className="mt-4 text-[15px] font-semibold text-text">{stage === "done" ? t("setup.faceDoneTitle") : t("setup.faceHowTitle")}</div>
          <p className="mt-1 max-w-[340px] text-[13px] text-text-secondary">{stage === "done" ? t("setup.faceDoneText") : t("setup.faceHowText")}</p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
            {stage === "done" ? (
              <Button className="flex-1" onClick={onDone} data-testid="face-setup-finish">
                {t("common.continue")} <RiArrowRightLine className="size-4" />
              </Button>
            ) : (
              <>
                <Button className="flex-1" onClick={() => void start()} loading={stage === "device" || stage === "saving"} data-testid="face-setup-start">
                  {stage === "failed" || stage === "cancelled" ? t("common.retry") : t("common.continue")} <RiArrowRightLine className="size-4" />
                </Button>
                <Button variant="secondary" className="flex-1" onClick={onSkip} data-testid="face-setup-later">
                  {skipLabel ?? t("setup.faceLater")}
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mt-5 rounded-2xl bg-surface-secondary/80 px-4 py-3 text-left text-[13px] text-text-secondary" data-testid="face-unavailable">
            {t(`setup.faceUnavailable.${support}`)}
          </div>
          <Button className="mt-6 w-full" onClick={onSkip} data-testid="face-setup-later">
            {t("common.continue")} <RiArrowRightLine className="size-4" />
          </Button>
        </>
      )}
      <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
        <RiShieldCheckLine className="size-3.5" /> {t("setup.facePrivacy")}
      </div>
    </div>
  );
}
