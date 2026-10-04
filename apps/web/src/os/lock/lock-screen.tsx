import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { RiGridFill, RiLogoutBoxRLine } from "@remixicon/react";
import { ErrorCode, type LockStateDto, type SessionResponse } from "@voidex/shared";
import { ApiError, rawGetBlob, rawPost, refreshSession } from "@/lib/api";
import { signOut } from "@/lib/account";
import { cx } from "@/lib/cx";
import { faceIdNotConfirmed, faceIdSupport, faceIdUnlockAssertion } from "@/lib/faceid";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT, type TFunction } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { VoidexMark } from "@/brand/brand";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { wallpaperStyle } from "../home/appearance";
import { FaceGlyph, FaceLens, type FaceState } from "./face-glyph";
import { PasscodePad } from "./passcode-pad";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Tabs of this browser tell each other about an unlock (the session is shared). */
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("vx-lock") : null;

/** Unlocked here: fresh tokens, everything that failed while locked refetches, other tabs follow. */
function finishUnlock(s: SessionResponse) {
  useSession.getState().setSession(s);
  void queryClient.invalidateQueries();
  channel?.postMessage("unlocked");
}

/** "Wrong code-password. 4 attempts left." / "Try again in 0:28" etc. */
export function passcodeErrorText(err: unknown, t: TFunction): { text: string; lockedUntil: string | null } {
  if (err instanceof ApiError) {
    const lockedUntil = typeof err.details.lockedUntil === "string" ? err.details.lockedUntil : null;
    if (err.code === ErrorCode.PasscodeLocked) return { text: t("lock.blocked"), lockedUntil };
    if (err.code === ErrorCode.PasscodeInvalid) {
      const left = typeof err.details.attemptsLeft === "number" ? err.details.attemptsLeft : null;
      return { text: left !== null && left <= 5 ? t("lock.wrongLeft", { n: left }) : t("lock.wrong"), lockedUntil };
    }
    if (err.code === "network") return { text: t("lock.offline"), lockedUntil: null };
  }
  return { text: t("lock.failed"), lockedUntil: null };
}

/** Seconds left until a moment, ticking. */
export function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [until]);
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The VOIDEX lock screen. Shown on app start when the account has a
 * code-password, after inactivity, on a manual lock and when another tab
 * locked the session. It is not a curtain: the server refuses every request
 * of a locked session until the code-password or Face ID unlocks it here.
 */
export function LockScreen() {
  const t = useT();
  const ff = useFormFactor();
  const [mode, setMode] = useState<"face" | "passcode">("face");
  const [face, setFace] = useState<FaceState>("idle");
  const [faceMsg, setFaceMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const autoTried = useRef(false);

  const stateQ = useQuery({
    queryKey: ["lock-state"],
    queryFn: () => rawPost<LockStateDto>("/api/auth/lock/state"),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const state = stateQ.data;
  const supportQ = useQuery({ queryKey: ["face-id-support"], queryFn: faceIdSupport, staleTime: Infinity });
  const faceOffered = !!state?.faceId && supportQ.data === "available";
  const effectiveMode = faceOffered ? mode : "passcode";
  const blockedFor = useCountdown(lockedUntil ?? state?.passcodeLockedUntil ?? null);

  // The session is gone (revoked elsewhere, expired): back to sign-in.
  useEffect(() => {
    const err = stateQ.error;
    if (err instanceof ApiError && (err.code === ErrorCode.SessionRevoked || err.code === ErrorCode.SessionExpired || err.code === ErrorCode.Unauthenticated)) {
      useSession.getState().signOutLocal(err.code === ErrorCode.SessionRevoked ? "revoked" : "expired");
    }
  }, [stateQ.error]);

  // Unlocked meanwhile (another tab, or nothing to unlock with any more): continue with a normal refresh.
  useEffect(() => {
    if (state && !state.locked) void refreshSession().then(() => queryClient.invalidateQueries()).catch(() => undefined);
  }, [state]);
  const refetchState = stateQ.refetch;
  useEffect(() => {
    const h = (e: MessageEvent) => e.data === "unlocked" && void refetchState();
    channel?.addEventListener("message", h);
    const onFocus = () => void refetchState();
    window.addEventListener("focus", onFocus);
    return () => {
      channel?.removeEventListener("message", h);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetchState]);

  const unlockWith = useCallback(
    async (body: { passcode: string } | { webauthn: unknown }) => {
      const s = await rawPost<SessionResponse>("/api/auth/lock/unlock", body);
      setOpening(true);
      // A short beat for the success state, then the session opens.
      window.setTimeout(() => finishUnlock(s), 650);
    },
    [],
  );

  const handleFatal = (err: unknown) => {
    if (err instanceof ApiError && err.code === ErrorCode.SessionRevoked) {
      toast({ title: t("lock.signedOutAttempts"), tone: "danger", duration: 7000 });
      useSession.getState().signOutLocal("revoked");
      return true;
    }
    return false;
  };

  const tryFace = useCallback(async (auto = false) => {
    if (face === "scanning" || opening) return;
    setFace("scanning");
    setFaceMsg(null);
    try {
      const assertion = await faceIdUnlockAssertion();
      await unlockWith({ webauthn: assertion });
      setFace("success");
    } catch (err) {
      if (handleFatal(err)) return;
      if (auto && faceIdNotConfirmed(err)) {
        // The automatic first try may need a tap in some browsers: just wait for it.
        setFace("idle");
        setFaceMsg(t("lock.faceTap"));
      } else {
        setFace("error");
        setFaceMsg(faceIdNotConfirmed(err) ? t("lock.faceNotConfirmed") : t("lock.faceFailed"));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, opening, unlockWith]);

  // Face ID first: one automatic attempt when the screen appears (browsers may require a tap — then it waits).
  useEffect(() => {
    if (!faceOffered || autoTried.current || blockedFor > 0) return;
    autoTried.current = true;
    void tryFace(true);
  }, [faceOffered, tryFace, blockedFor]);

  const submitCode = async (passcode: string) => {
    try {
      await unlockWith({ passcode });
      setError(null);
      return true;
    } catch (err) {
      if (handleFatal(err)) return false;
      const e = passcodeErrorText(err, t);
      setError(e.text);
      setLockedUntil(e.lockedUntil);
      return false;
    }
  };

  const wp = wallpaperStyle(state?.wallpaper ?? { kind: "preset", id: "wave-milk-violet" }, null);
  const imageQ = useQuery({
    queryKey: ["lock-wallpaper", state?.wallpaperSlot, state?.wallpaper?.kind === "image" ? state.wallpaper.version : null],
    enabled: state?.wallpaper?.kind === "image",
    queryFn: async () => URL.createObjectURL(await rawGetBlob(`/api/auth/lock/wallpaper?slot=${state!.wallpaperSlot}`)),
    staleTime: Infinity,
  });
  const bg = state?.wallpaper?.kind === "image" ? wallpaperStyle(state.wallpaper, imageQ.data ?? null) : wp;
  const dark = bg.dark;

  const statusText = opening
    ? t("lock.opening")
    : face === "scanning"
      ? t("lock.faceScanning")
      : face === "error"
        ? faceMsg
        : (faceMsg ?? t("lock.faceIdle"));

  return (
    <motion.div
      className="fixed inset-0 z-[400] flex select-none flex-col overflow-hidden"
      style={bg.style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.35, ease: EASE }}
      data-testid="lock-screen"
      role="dialog"
      aria-modal="true"
      aria-label={t("lock.title")}
    >
      {/* Soft milk veil keeps text readable on any wallpaper */}
      <div className={cx("pointer-events-none absolute inset-0", dark ? "bg-black/15" : "bg-white/10")} />

      <header className="relative flex items-center gap-2 px-5 pt-[max(var(--safe-top),14px)]" data-system-ui>
        <VoidexMark className="size-6" />
        <span className={cx("text-[13px] font-semibold tracking-[0.2em]", dark ? "text-white" : "text-text")}>VOIDEX</span>
      </header>

      <div className={cx("relative flex min-h-0 flex-1 flex-col items-center", ff === "mobile" ? "pt-[6vh]" : "pt-[7vh]")}>
        <BigClock dark={dark} dimmed={effectiveMode === "passcode" && ff === "desktop"} />

        <div className="flex w-full flex-1 flex-col items-center justify-center pb-6">
          <AnimatePresence mode="wait" initial={false}>
            {effectiveMode === "face" ? (
              <motion.div
                key="face"
                className={cx("flex flex-col items-center px-8 py-7 text-center", ff === "desktop" && "vx-lock-card rounded-[30px]")}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                <button type="button" onClick={() => void tryFace()} aria-label={t("lock.faceTry")} data-testid="lock-face-button" className="rounded-full outline-offset-4">
                  <FaceLens state={opening ? "success" : face} size={ff === "mobile" ? 132 : 128} />
                </button>
                <div className={cx("mt-4 text-[18px] font-semibold", dark && ff === "mobile" ? "text-white" : "text-text")}>{t("lock.faceId")}</div>
                <div
                  className={cx("mt-1 max-w-[240px] text-[13.5px]", face === "error" ? "font-medium text-danger" : opening ? "font-medium text-primary" : dark && ff === "mobile" ? "text-white/80" : "text-text-secondary")}
                  data-testid="lock-face-status"
                  aria-live="polite"
                >
                  {statusText}
                </div>
                {face === "error" && <div className="mt-1 max-w-[240px] text-[12.5px] text-text-tertiary">{t("lock.faceRetryHint")}</div>}
              </motion.div>
            ) : (
              <motion.div
                key="code"
                className="vx-lock-card flex w-[min(340px,calc(100vw-32px))] flex-col items-center rounded-[32px] px-6 pb-5 pt-7"
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                {opening ? (
                  <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-center" data-testid="lock-opening">
                    <FaceLens state="success" size={96} />
                    <div className="text-[15px] font-medium text-primary">{t("lock.opening")}</div>
                  </div>
                ) : (
                  <PasscodePad
                    title={state ? t("lock.enterCodeName", { name: state.firstName }) : t("lock.enterCode")}
                    error={blockedFor > 0 ? t("lock.tryIn", { time: mmss(blockedFor) }) : error}
                    disabled={blockedFor > 0}
                    onSubmit={submitCode}
                    extraLabel={t("lock.useFaceLink")}
                    extraKey={
                      faceOffered ? (
                        <button type="button" onClick={() => setMode("face")} className="rounded-[18px] p-2 text-primary hover:bg-white/50" aria-label={t("lock.useFace")} data-testid="lock-use-face">
                          <span className="block size-9">
                            <FaceLensMini />
                          </span>
                        </button>
                      ) : undefined
                    }
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {effectiveMode === "face" && !opening && (
            <button
              type="button"
              onClick={() => setMode("passcode")}
              className={cx("mt-7 flex flex-col items-center gap-2 text-[13px]", dark ? "text-white/90" : "text-text-secondary")}
              data-testid="lock-use-code"
            >
              <span className="vx-lock-card grid size-12 place-items-center rounded-full text-primary">
                <RiGridFill className="size-5" />
              </span>
              {t("lock.useCode")}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setConfirmOut(true)}
          className={cx("mb-[max(var(--safe-bottom),18px)] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px]", dark ? "text-white/75 hover:text-white" : "text-text-tertiary hover:text-text-secondary")}
          data-testid="lock-sign-out"
        >
          <RiLogoutBoxRLine className="size-4" />
          {t("lock.forgot")}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={() => void signOut()}
        title={t("lock.signOutTitle")}
        message={t("lock.signOutBody")}
        confirmLabel={t("lock.signOut")}
        danger
      />
    </motion.div>
  );
}

/** The same symbol, small (the "use Face ID" key on the keypad). */
function FaceLensMini() {
  return <FaceGlyph state="idle" className="size-full" />;
}

function BigClock({ dark, dimmed }: { dark: boolean; dimmed: boolean }) {
  const lang = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(now);
  const dateRaw = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(now);
  const date = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  return (
    <div className={cx("flex flex-col items-center transition-[filter,opacity] duration-300", dimmed && "opacity-60 blur-[6px]")} data-testid="lock-clock">
      <div className={cx("text-[clamp(64px,13vw,124px)] font-extralight leading-none tracking-[-0.03em] tabular-nums", dark ? "text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.25)]" : "text-text")}>{time}</div>
      <div className={cx("mt-2 text-[clamp(15px,1.8vw,21px)]", dark ? "text-white/90" : "text-text-secondary")}>{date}</div>
    </div>
  );
}
