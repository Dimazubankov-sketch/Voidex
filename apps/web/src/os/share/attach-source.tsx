import { useEffect, useMemo, useState } from "react";
import { RiArrowLeftSLine, RiCheckLine, RiCloudOffLine, RiComputerLine, RiSmartphoneLine } from "@remixicon/react";
import { serialize } from "@voidex/files/model";
import type { MediaItem } from "@voidex/media/model";
import { fileName, itemBlob } from "@voidex/media/utils";
import { FilesGlyph, MediaGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { errorMessage } from "@/lib/errors";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { Sheet, toast } from "@/ui/overlays";
import { useCloudDialog, useCloudStatus } from "@/os/cloud/cloud";
import { sessionFiles, sessionMedia } from "@/os/cloud/session";

type Step = "choose" | "files" | "media";
const PRSN_MIME = "application/vnd.voidex.prsn+json";

/**
 * «Откуда выбрать?» (Step 2.7): the attach button of Vibex and VoidOps Mail
 * asks where from: Files VOIDEX, Media VOIDEX or the device. The VOIDEX
 * sources offer only what really is there (this session, while the cloud is
 * off) and say so when there is nothing; the device source is the real file
 * picker with the app's own type and size rules.
 */
export function AttachSourceSheet({
  open,
  onClose,
  onDevice,
  onPick,
  max,
  testId = "attach-source",
}: {
  open: boolean;
  onClose: () => void;
  onDevice: () => void;
  onPick: (files: File[]) => void;
  max: number;
  testId?: string;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>("choose");
  useEffect(() => {
    if (open) setStep("choose");
  }, [open]);
  const title = step === "choose" ? t("attach.title") : step === "files" ? t("attach.files") : t("attach.media");
  return (
    <Sheet open={open} onClose={onClose} title={title} width={460} testId={testId} centered>
      {step === "choose" ? (
        <Choose
          testId={testId}
          onStep={setStep}
          onDevice={() => {
            onClose();
            onDevice();
          }}
        />
      ) : step === "files" ? (
        <FilesSource
          testId={testId}
          max={max}
          onBack={() => setStep("choose")}
          onDevice={() => {
            onClose();
            onDevice();
          }}
          onPick={(f) => {
            onClose();
            onPick(f);
          }}
        />
      ) : (
        <MediaSource
          testId={testId}
          max={max}
          onBack={() => setStep("choose")}
          onDevice={() => {
            onClose();
            onDevice();
          }}
          onPick={(f) => {
            onClose();
            onPick(f);
          }}
        />
      )}
    </Sheet>
  );
}

function Choose({ onStep, onDevice, testId }: { onStep: (s: Step) => void; onDevice: () => void; testId: string }) {
  const t = useT();
  const ff = useFormFactor();
  const rows = [
    { id: "files", icon: <FilesGlyph className="size-8" />, label: t("attach.files"), hint: t("attach.filesHint"), run: () => onStep("files") },
    { id: "media", icon: <MediaGlyph className="size-8" />, label: t("attach.media"), hint: t("attach.mediaHint"), run: () => onStep("media") },
    {
      id: "device",
      icon: ff === "mobile" ? <RiSmartphoneLine className="size-7 text-text-secondary" /> : <RiComputerLine className="size-7 text-text-secondary" />,
      label: t("attach.device"),
      hint: t("attach.deviceHint"),
      run: onDevice,
    },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid={`${testId}-options`}>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={r.run}
          className="pressable flex min-h-[64px] items-center gap-3 rounded-[20px] border border-border bg-surface px-3 text-left hover:bg-surface-hover"
          data-testid={`${testId}-${r.id}`}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-surface-secondary">{r.icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15.5px] font-semibold text-text">{r.label}</span>
            <span className="text-[13px] leading-snug text-text-tertiary">{r.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onBack} className="mb-3 flex w-fit items-center gap-1 rounded-full bg-surface-secondary py-1 pl-1.5 pr-3 text-[13.5px] font-medium text-text-secondary">
      <RiArrowLeftSLine className="size-[18px]" />
      {t("attach.title")}
    </button>
  );
}

/** Nothing to offer: the cloud is off and this session holds nothing. Says so; no fake items. */
function Empty({ onDevice, testId, text }: { onDevice: () => void; testId: string; text: string }) {
  const t = useT();
  const show = useCloudDialog((s) => s.show);
  const cloud = useCloudStatus();
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid={`${testId}-empty`}>
      <span className="grid size-14 place-items-center rounded-2xl bg-surface-secondary text-text-secondary">
        <RiCloudOffLine className="size-7" />
      </span>
      {!cloud.available && <span className="text-[16px] font-semibold text-text">{t("cloud.unavailable")}</span>}
      <span className="max-w-[320px] text-[14px] leading-snug text-text-secondary">{text}</span>
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={() => show("attach")} className="h-10 rounded-full bg-surface-secondary px-4 text-[14px] font-medium text-text">
          {t("cloud.more")}
        </button>
        <button type="button" onClick={onDevice} className="h-10 rounded-full bg-primary px-4 text-[14px] font-semibold text-white" data-testid={`${testId}-empty-device`}>
          {t("attach.device")}
        </button>
      </div>
    </div>
  );
}

function Footer({ count, busy, onAttach }: { count: number; busy: boolean; onAttach: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={!count || busy}
      onClick={onAttach}
      className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-white disabled:opacity-50"
      data-testid="attach-source-confirm"
    >
      {busy && <Spinner size={16} />}
      {t("attach.attach", { n: count })}
    </button>
  );
}

function FilesSource({ onBack, onDevice, onPick, max, testId }: { onBack: () => void; onDevice: () => void; onPick: (f: File[]) => void; max: number; testId: string }) {
  const t = useT();
  const files = useMemo(() => sessionFiles().peek(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  return (
    <div data-testid={`${testId}-files`}>
      <Back onBack={onBack} />
      {!files.length ? (
        <Empty onDevice={onDevice} testId={testId} text={t("attach.filesEmpty")} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {files.map(({ entry }) => {
              const on = picked.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => toggle(entry.id)}
                  aria-pressed={on}
                  className={cx("flex min-h-12 items-center gap-3 rounded-2xl px-2 text-left", on ? "bg-primary-soft" : "hover:bg-surface-hover")}
                  data-testid={`${testId}-file`}
                >
                  <span className={cx("grid size-9 shrink-0 place-items-center rounded-[10px] text-[10px] font-bold uppercase", entry.kind === "prsn" ? "bg-[#fff1e6] text-[#c25a12]" : "bg-[#efedff] text-[#5b4af0]")}>.{entry.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-text">{entry.name}</span>
                  {on && <RiCheckLine className="size-5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          <Footer
            count={picked.length}
            busy={false}
            onAttach={() =>
              onPick(
                files
                  .filter((f) => picked.includes(f.entry.id))
                  .map((f) => new File([serialize(f.entry.kind, f.data)], f.entry.name, { type: f.entry.kind === "prsn" ? PRSN_MIME : "text/plain" })),
              )
            }
          />
        </>
      )}
    </div>
  );
}

function MediaSource({ onBack, onDevice, onPick, max, testId }: { onBack: () => void; onDevice: () => void; onPick: (f: File[]) => void; max: number; testId: string }) {
  const t = useT();
  const items = useMemo<MediaItem[]>(() => sessionMedia().peek().items.filter((m) => !m.deletedAt && !m.hidden), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  const attach = async () => {
    setBusy(true);
    try {
      onPick(await Promise.all(items.filter((m) => picked.includes(m.id)).map(async (m) => new File([await itemBlob(m)], fileName(m), { type: m.mime }))));
    } catch (e) {
      toast({ title: errorMessage(t, e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid={`${testId}-media`}>
      <Back onBack={onBack} />
      {!items.length ? (
        <Empty onDevice={onDevice} testId={testId} text={t("attach.mediaEmpty")} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {items.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggle(m.id)} aria-pressed={on} className="relative aspect-square overflow-hidden rounded-xl bg-surface-secondary" data-testid={`${testId}-item`}>
                  {m.kind === "video" ? <video src={m.src} muted playsInline preload="metadata" className="size-full object-cover" /> : <img src={m.src} alt="" className="size-full object-cover" />}
                  {on && (
                    <span className="absolute inset-0 grid place-items-center bg-primary/30">
                      <RiCheckLine className="size-7 text-white" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <Footer count={picked.length} busy={busy} onAttach={() => void attach()} />
        </>
      )}
    </div>
  );
}
