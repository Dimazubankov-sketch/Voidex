import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RiKeyLine, RiLock2Line, RiTimerLine } from "@remixicon/react";
import { AUTO_LOCK_OPTIONS, type AutoLockMinutes, type SecurityStatusDto, type Wallpaper } from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { faceIdSupport } from "@/lib/faceid";
import { useLanguage, useT } from "@/lib/i18n";
import { ensureStepUp, setSecurityStatus, useSecurityStatus } from "@/lib/security";
import { Button, Spinner, Switch } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { WallpaperPicker, Segmented, Block } from "@/os/home/appearance-panel";
import { useWallpaperImage, wallpaperStyle } from "@/os/home/appearance";
import { useWorkspaceLayout, updateLayout } from "@/os/home/layout";
import { lockNow } from "@/os/lock/auto-lock";
import { FaceGlyph } from "@/os/lock/face-glyph";
import { PasscodePad } from "@/os/lock/passcode-pad";
import { FaceIdSetup } from "@/os/lock/security-setup";
import { Badge, Group, Row, SectionTitle } from "../kit";

/**
 * Settings → Lock screen & wallpapers (Step 2.4): what the lock screen and
 * the desktop look like (separate wallpapers), and what protects them — the
 * code-password, Face ID on this device and auto-lock.
 */
export function LockSection() {
  const t = useT();
  const { layout } = useWorkspaceLayout();
  const a = layout.appearance;
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

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Preview kind="lock" wallpaper={a.lockWallpaper ?? a.wallpaper} slot={a.lockWallpaper ? "lock" : "desktop"} />
        <Preview kind="desktop" wallpaper={a.wallpaper} slot="desktop" />
      </div>

      <div className="space-y-6">
        <WallpaperPicker
          slot="lock"
          title={t("lockSettings.lockWallpaper")}
          current={a.lockWallpaper ?? null}
          desktop={a.wallpaper}
          onPick={(lockWallpaper) => updateLayout((l) => ({ ...l, appearance: { ...l.appearance, lockWallpaper } }))}
        />
        <WallpaperPicker
          title={t("lockSettings.desktopWallpaper")}
          current={a.wallpaper}
          onPick={(wallpaper) => wallpaper && updateLayout((l) => ({ ...l, appearance: { ...l.appearance, wallpaper } }))}
        />
      </div>

      <div className="mt-8" />
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

/** A small picture of the lock screen or the desktop with its wallpaper. */
function Preview({ kind, wallpaper, slot }: { kind: "lock" | "desktop"; wallpaper: Wallpaper; slot: "lock" | "desktop" }) {
  const t = useT();
  const lang = useLanguage();
  const image = useWallpaperImage(wallpaper, slot);
  const w = wallpaperStyle(wallpaper, image.data);
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date());
  return (
    <div className="flex flex-col items-center gap-2" data-testid={`preview-${kind}`}>
      <div className="relative aspect-[3/4] w-full max-w-[200px] overflow-hidden rounded-[22px] border border-black/10 shadow-tile" style={w.style}>
        {kind === "lock" ? (
          <div className="flex h-full flex-col items-center pt-[14%]">
            <span className={cx("text-[30px] font-extralight leading-none tracking-tight", w.dark ? "text-white" : "text-text")}>{time}</span>
            <span className="mt-auto mb-[16%] grid size-10 place-items-center rounded-full bg-white/70 p-2 shadow-sm backdrop-blur">
              <FaceGlyph state="idle" className="size-full" />
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 p-3 pt-[16%]">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[8px] bg-white/80 shadow-sm" />
            ))}
          </div>
        )}
      </div>
      <span className="text-[13px] font-medium text-text-secondary">{kind === "lock" ? t("lockSettings.previewLock") : t("lockSettings.previewDesktop")}</span>
    </div>
  );
}
