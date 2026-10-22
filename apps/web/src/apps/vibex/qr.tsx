import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RiCloseLine, RiDownload2Line, RiShareForwardLine } from "@remixicon/react";
import qrcode from "qrcode-generator";
import { vibexProfileLink, type VibexPersonDto } from "@voidex/shared";
import { VibexGlyph } from "@/brand/brand";
import { useT } from "@/lib/i18n";
import { toast } from "@/ui/overlays";

/**
 * Update 2 · C6: personal QR codes. A code holds only the public link of a profile —
 * https://<VOIDEX>/u/<@username> — never a password, a token, a phone number or a private address.
 * It is drawn from the username every time (nothing is stored per person). Scanning it with a phone
 * camera opens the profile in Vibex (signed out: VOIDEX asks to sign in first).
 */
export function profileLink(handle: string) {
  return vibexProfileLink(window.location.origin, handle);
}

/** The modules of the code (true = dark), medium error correction. */
function useMatrix(text: string): boolean[][] {
  return useMemo(() => {
    const qr = qrcode(0, "Q");
    qr.addData(unescape(encodeURIComponent(text)), "Byte");
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }, [text]);
}

/** The code as an SVG: rounded modules, the three finder patterns drawn as rounded squares. */
export function QrCode({ text, size = 232, className }: { text: string; size?: number; className?: string }) {
  const m = useMatrix(text);
  const n = m.length;
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const dots: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c] && !finder(r, c)) dots.push(`M${c + 0.12},${r + 0.5}a0.38,0.38 0 1,0 0.76,0a0.38,0.38 0 1,0 -0.76,0`);
  const eye = (x: number, y: number) => (
    <g key={`${x},${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.9} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} className={className} role="img" aria-label={text} data-testid="qr-code" data-text={text} data-modules={n}>
      <path d={dots.join("")} fill="currentColor" />
      {eye(0, 0)}
      {eye(n - 7, 0)}
      {eye(0, n - 7)}
    </svg>
  );
}

/** Shares a profile's link (the system share sheet, else the clipboard). */
export async function shareProfile(t: ReturnType<typeof useT>, person: Pick<VibexPersonDto, "name" | "handle">) {
  const url = profileLink(person.handle);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: `${person.name} · Vibex`, url });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: t("vibex.qr.copied") });
  } catch {
    toast({ title: url });
  }
}

/** The card as a PNG: the code, the username, white background (for saving or sending). */
async function cardPng(text: string, handle: string): Promise<Blob | null> {
  const qr = qrcode(0, "Q");
  qr.addData(unescape(encodeURIComponent(text)), "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const scale = 16;
  const pad = 48;
  const side = n * scale + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side + 90;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#1c1a2e";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(pad + c * scale, pad + r * scale, scale, scale);
  g.fillStyle = "#5b45f0";
  g.font = "600 38px -apple-system, system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(`@${handle}`.toUpperCase(), side / 2, side + 50);
  return new Promise((done) => canvas.toBlob((b) => done(b), "image/png"));
}

/**
 * C6: a profile's QR code, full screen: close (top left), the code with the @username, «Поделиться»
 * (the link) and «Сохранить» (the card as a picture). Works for someone else's profile and for mine.
 */
export function ProfileQrSheet({ person, onClose }: { person: Pick<VibexPersonDto, "name" | "handle"> | null; onClose: () => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!person) return;
    setBusy(true);
    try {
      const blob = await cardPng(profileLink(person.handle), person.handle);
      if (!blob) return;
      const file = new File([blob], `vibex-${person.handle}.png`, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: person.name });
          return;
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return;
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <AnimatePresence>
      {person && (
        <motion.div
          className="fixed inset-0 z-[400] flex flex-col bg-[radial-gradient(120%_80%_at_50%_30%,#efeaff_0%,#d9d0ff_55%,#c3b6ff_100%)] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] dark:bg-[radial-gradient(120%_80%_at_50%_30%,#2b2650_0%,#1d1a36_60%,#141226_100%)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal
          aria-label={t("vibex.qr.title")}
          data-testid="qr-sheet"
        >
          <div className="flex items-center justify-between">
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="vx-glass flex size-11 items-center justify-center rounded-full text-text" data-testid="qr-close">
              <RiCloseLine className="size-6" />
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-5">
            <motion.div
              className="flex flex-col items-center gap-3 rounded-[32px] bg-white px-7 pb-6 pt-7 text-[#1c1a2e] shadow-[0_20px_60px_-20px_rgba(60,40,160,0.45)]"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="relative">
                <QrCode text={profileLink(person.handle)} size={Math.min(250, window.innerWidth - 120)} />
                <span className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[14px] bg-white p-1.5 shadow-sm">
                  <VibexGlyph className="size-full" />
                </span>
              </div>
              <span className="max-w-[260px] truncate text-[19px] font-semibold uppercase tracking-wide text-primary" data-testid="qr-handle">
                @{person.handle}
              </span>
            </motion.div>
            <p className="max-w-[300px] text-center text-[13.5px] text-text-secondary">{t("vibex.qr.hint")}</p>
          </div>
          <div className="flex justify-center gap-3">
            <button type="button" onClick={() => void shareProfile(t, person)} className="vx-glass flex h-12 flex-1 max-w-[180px] items-center justify-center gap-2 rounded-full text-[15px] font-medium text-text" data-testid="qr-share">
              <RiShareForwardLine className="size-5" />
              {t("vibex.qr.share")}
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className="vx-glass flex h-12 flex-1 max-w-[180px] items-center justify-center gap-2 rounded-full text-[15px] font-medium text-text disabled:opacity-50" data-testid="qr-save">
              <RiDownload2Line className="size-5" />
              {t("vibex.qr.save")}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
