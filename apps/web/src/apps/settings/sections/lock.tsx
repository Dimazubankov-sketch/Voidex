import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RiKeyLine, RiLock2Line, RiTimerLine } from "@remixicon/react";
import { AUTO_LOCK_OPTIONS, type AutoLockMinutes, type SecurityStatusDto } from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { faceIdSupport } from "@/lib/faceid";
import { useT } from "@/lib/i18n";
import { ensureStepUp, setSecurityStatus, useSecurityStatus } from "@/lib/security";
import { Button, Spinner, Switch } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { Segmented, Block } from "@/os/home/appearance-panel";
import { lockNow } from "@/os/lock/auto-lock";
import { FaceGlyph } from "@/os/lock/face-glyph";
import { PasscodePad } from "@/os/lock/passcode-pad";
import { FaceIdSetup } from "@/os/lock/security-setup";
import { Badge, Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";
import { WallpaperLink } from "./wallpapers";

/**
 * Settings → Lock screen (Step 2.4, 2.5.1): what protects VOIDEX — the
 * code-password, Face ID on this device, auto-lock, "lock now" — and a link
 * to its wallpaper (chosen only in Settings → Wallpapers).
 */
export function LockSection({ navigate }: SectionProps) {
  const t = useT();
  const status = useSecurityStatus().data;
  const support = useQuery({ queryKey: ["face-id-support"], queryFn: faceIdSupport, staleTime: Infinity }).data;
  const [codeSheet, setCodeSheet] = useState<null | "create" | "change">(null);
  const [faceSheet, setFaceSheet] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const on = !!status?.passcodeEnabled;

  const run = async (key: string, fn: () => Promise<SecurityStatusDto>) => {
    // Sensitive change: confirm first (the server checks it too).
    if (!(await ensureStepUp())) return;
    setBusy(key);
    try {
      setSecurityStatus(await fn());
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="settings-lock">
      <SectionTitle subtitle={t("lockSettings.subtitle")}>{t("settings.lock")}</SectionTitle>

      <Group title={t("lockSettings.code")} footer={t("lockSettings.codeHint")}>
        <Row
          icon={<RiKeyLine className="size-[18px]" />}
          label={t("lockSettings.code")}
          right={status ? <Badge tone={on ? "success" : "default"}>{on ? t("lockSettings.on") : t("lockSettings.off")}</Badge> : <Spinner size={14} />}
          testId="passcode-status"
        />
        {on ? (
          <>
            <Row label={t("lockSettings.codeChange")} chevron onClick={() => void ensureStepUp().then((ok) => ok && setCodeSheet("change"))} testId="passcode-change" />
            <Row label={t("lockSettings.codeOff")} danger onClick={() => setConfirmOff(true)} testId="passcode-off" />
          </>
        ) : (
          <Row label={t("lockSettings.codeOn")} chevron onClick={() => setCodeSheet("create")} testId="passcode-on" />
        )}
      </Group>

      <Group title={t("lock.faceId")} footer={faceFooter(t, support, status)}>
        <Row
          icon={<span className="block size-5"><FaceGlyph state="idle" className="size-full" /></span>}
          label={t("lockSettings.faceThisDevice")}
          hint={status?.faceIdDevices ? t("lockSettings.faceDevices", { n: status.faceIdDevices }) : undefined}
          right={
            busy === "face" ? (
              <Spinner size={16} />
            ) : (
              <Switch
                checked={!!status?.faceIdOnThisDevice}
                disabled={!on || (support !== "available" && !status?.faceIdOnThisDevice)}
                label={t("lockSettings.faceThisDevice")}
                onChange={(v) =>
                  v
                    ? void ensureStepUp().then((ok) => ok && setFaceSheet(true))
                    : void run("face", () => api.delete<SecurityStatusDto>("/api/security/face-id"))
                }
              />
            )
          }
          testId="face-id-toggle"
        />
      </Group>

      <Block title={t("lockSettings.autoLock")} hint={t("lockSettings.autoLockHint")}>
        <div className={cx("flex items-center gap-3", !on && "pointer-events-none opacity-50")}>
          <RiTimerLine className="size-5 shrink-0 text-primary" />
          <Segmented
            value={String(status?.autoLockMinutes ?? 5)}
            options={AUTO_LOCK_OPTIONS.map((m) => [String(m), m === 0 ? t("lockSettings.autoNever") : t("lockSettings.minutes", { n: m })] as [string, string])}
            onChange={(v) => void run("auto", () => api.post<SecurityStatusDto>("/api/security/auto-lock", { minutes: Number(v) as AutoLockMinutes }))}
            testId="auto-lock"
          />
        </div>
      </Block>

      <div className="mt-6">
        <Button variant="secondary" className="w-full" disabled={!on} onClick={() => void lockNow()} data-testid="settings-lock-now">
          <RiLock2Line className="size-4" /> {t("lockSettings.lockNow")}
        </Button>
      </div>

      <div className="mt-6" />
      <WallpaperLink tab="lock" onOpen={() => navigate("wallpapers")} />

      <PasscodeSheet mode={codeSheet} onClose={() => setCodeSheet(null)} />
      <Sheet open={faceSheet} onClose={() => setFaceSheet(false)} width={460} testId="face-id-sheet">
        {faceSheet && <FaceIdSetup support={support} onDone={() => setFaceSheet(false)} onSkip={() => setFaceSheet(false)} skipLabel={t("common.cancel")} />}
      </Sheet>
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => {
          setConfirmOff(false);
          void run("off", () => api.delete<SecurityStatusDto>("/api/security/passcode"));
        }}
        title={t("lockSettings.codeOffTitle")}
        message={t("lockSettings.codeOffBody")}
        confirmLabel={t("lockSettings.codeOff")}
        danger
      />
    </div>
  );
}

function faceFooter(t: ReturnType<typeof useT>, support: string | undefined, status: SecurityStatusDto | undefined) {
  if (status && !status.passcodeEnabled) return t("lockSettings.faceNeedsCode");
  if (support && support !== "available") return t(`setup.faceUnavailable.${support as "no-authenticator"}`);
  return t("lockSettings.faceHint");
}

/** Create or change the code-password: twice the same six digits. */
function PasscodeSheet({ mode, onClose }: { mode: null | "create" | "change"; onClose: () => void }) {
  const t = useT();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setFirst(null);
    setError(null);
    onClose();
  };
  return (
    <Sheet open={mode !== null} onClose={close} title={mode === "change" ? t("lockSettings.codeChange") : t("lockSettings.codeOn")} width={400} testId="passcode-sheet">
      {mode && (
        <PasscodePad
          key={first ? "confirm" : "create"}
          title={first ? t("setup.codeRepeat") : mode === "change" ? t("lockSettings.codeNew") : t("setup.codeCreate")}
          error={error}
          testId={first ? "passcode-sheet-confirm" : "passcode-sheet-create"}
          onSubmit={async (code) => {
            if (!first) {
              if (/^(\d)\1{5}$/.test(code) || "0123456789".includes(code) || "9876543210".includes(code)) {
                setError(t("setup.codeWeak"));
                return false;
              }
              setError(null);
              setFirst(code);
              return true;
            }
            if (code !== first) {
              setFirst(null);
              setError(t("setup.codeMismatch"));
              return false;
            }
            try {
              setSecurityStatus(await api.post<SecurityStatusDto>("/api/security/passcode", { passcode: code }));
              toast({ title: mode === "change" ? t("lockSettings.codeChanged") : t("lockSettings.codeCreated"), tone: "success" });
              close();
              return true;
            } catch (e) {
              setFirst(null);
              setError(errorMessage(t, e));
              return false;
            }
          }}
        />
      )}
    </Sheet>
  );
}
