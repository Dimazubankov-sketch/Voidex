import { useEffect, useRef, useState, type ReactNode } from "react";
import { RiAddLine, RiArrowLeftSLine, RiCheckLine, RiCloseLine, RiImageAddLine, RiMoreFill } from "@remixicon/react";
import type { NotesDocKind } from "@voidex/shared";
import { NotesGlyph } from "@/brand/brand";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { Spinner } from "@/ui/controls";
import { Popover, Sheet, toast, usePopover } from "@/ui/overlays";
import { WindowMenu } from "@/os/system-menu";
import { WindowHeader, useWindow } from "@/os/window-context";
import { downscale, notesApi, useMediaUrl } from "./data";
import { VoidexSearchField } from "@/ui/search-field";

/**
 * Header of the Notes browser screens. The Notes logo has a fixed place:
 * the back button has its own slot to the left of it (empty on the first
 * screen), so it never replaces, covers or moves the logo. Editors have no
 * logo at all (they use their own floating controls).
 */
export function NotesHeader({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const t = useT();
  return (
    <WindowHeader className="relative z-10" right={right} menu={false}>
      <span className="flex w-10 shrink-0 justify-center" data-no-drag={onBack ? true : undefined}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className="grid size-10 place-items-center rounded-full text-text transition-colors hover:bg-surface-hover"
            data-testid="notes-back"
          >
            <RiArrowLeftSLine className="size-6" />
          </button>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2" data-testid="notes-logo">
        <span className="grid size-8 shrink-0 place-items-center" data-system-ui>
          <NotesGlyph className="size-[26px]" />
        </span>
        <span className="truncate text-[17px] font-semibold tracking-tight text-text">{t("notes.name")}</span>
      </span>
    </WindowHeader>
  );
}

/**
 * Bottom bar of the browser screens: one centred search field with the "+"
 * (new project / new note or presentation) inside it, at its end, as the
 * round button in Media's search. Thumb-reachable on phones (safe area
 * aware), the same compact bar on PC.
 */
export function BottomBar({
  query,
  onQuery,
  placeholder,
  onAdd,
  addLabel,
  addMenu,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  onAdd?: () => void;
  addLabel: string;
  addMenu?: { id: string; label: string; icon: ReactNode; onSelect: () => void }[];
}) {
  const pop = usePopover();
  return (
    <div className="vx-kb-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pt-6" data-testid="notes-bottom-bar">
      <div className="pointer-events-auto w-full max-w-[560px]">
        <VoidexSearchField
          className="w-full shadow-[0_6px_24px_rgba(20,20,40,0.12)]"
          size="lg"
          name="voidex-notes-search"
          value={query}
          onChange={onQuery}
          placeholder={placeholder}
          aria-label={placeholder}
          testId="notes-search"
          trailing={
            onAdd || addMenu ? (
              <button
                ref={pop.anchor}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  // The button sits inside the field's <label>: keep the tap from focusing the input.
                  e.preventDefault();
                  if (addMenu) pop.toggle();
                  else onAdd?.();
                }}
                aria-label={addLabel}
                title={addLabel}
                className="-mr-1 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--search-bg)] text-[var(--search-icon)] transition hover:brightness-95 active:scale-95"
                data-testid="notes-add"
              >
                <RiAddLine className="size-5" />
              </button>
            ) : undefined
          }
        />
        {addMenu && (
          <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={230} testId="notes-add-menu">
            <Menu items={addMenu} onDone={pop.close} />
          </Popover>
        )}
      </div>
    </div>
  );
}

export interface MenuEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  checked?: boolean;
  divider?: boolean;
}

/** Menu rows (checked ones show a tick), with optional dividers. */
export function Menu({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  return (
    <div className="flex flex-col">
      {items.map((it) => (
        <div key={it.id}>
          {it.divider && <div className="mx-2 my-1 h-px bg-border/80" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDone();
              it.onSelect();
            }}
            className={cx("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors", it.danger ? "text-danger hover:bg-danger-soft" : "text-text hover:bg-surface-hover")}
            data-testid={`notes-menu-${it.id}`}
            aria-checked={it.checked === undefined ? undefined : it.checked}
          >
            <span className={cx("flex size-5 shrink-0 items-center justify-center", it.danger ? "text-danger" : "text-text-secondary")}>
              {it.checked ? <RiCheckLine className="size-[18px] text-primary" /> : it.icon}
            </span>
            <span className="min-w-0 flex-1 leading-tight">{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * A "…" button with its menu. `win`: it is also the window's menu (Notes has
 * one "…" in its header: its own actions, then minimize / maximize / close).
 */
export function MoreMenu({ items, label, testId, className, width = 250, win }: { items: MenuEntry[]; label: string; testId?: string; className?: string; width?: number; win?: boolean }) {
  const pop = usePopover();
  const w = useWindow();
  // Step 2.7: phones have no system "…" for windows; the app's own actions stay.
  const sys = !!win && w.formFactor === "desktop";
  if (sys) testId = "window-menu";
  else if (win) testId = testId ?? "notes-more";
  if (!sys && !items.length) return null;
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          pop.toggle();
        }}
        aria-label={label}
        title={label}
        className={cx("grid size-10 place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text", className)}
        data-testid={testId}
        data-no-drag
      >
        <RiMoreFill className="size-5" />
      </button>
      <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={width} testId={testId ? `${testId}-popover` : undefined}>
        <Menu items={items} onDone={pop.close} />
        {sys && (
          <>
            {items.length > 0 && <div className="mx-2 my-1 h-px bg-border/80" />}
            <WindowMenu windowId={w.windowId} onDone={pop.close} />
          </>
        )}
      </Popover>
    </>
  );
}

/** A stable, soft violet gradient per id (generated cover when there is no picture). */
function hue(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 238 + (h % 46) - 18; // violet family 220…266
}

/** A project's cover: its picture, or a generated one with the first letter. */
export function ProjectCover({ cover, name, id, className }: { cover: string | null; name: string; id: string; className?: string }) {
  const url = useMediaUrl(cover);
  const h = hue(id);
  return (
    <span
      className={cx("relative block overflow-hidden bg-cover bg-center", className)}
      style={url ? { backgroundImage: `url("${url}")` } : { background: `radial-gradient(120% 90% at 85% 0%, hsl(${h} 90% 82%), transparent 60%), linear-gradient(150deg, hsl(${h} 80% 96%), hsl(${h + 8} 70% 86%))` }}
      aria-hidden
      data-system-ui
    >
      {!url && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="text-[min(42cqw,72px)] font-semibold leading-none text-[hsl(var(--vn2-hue,250)_60%_45%)]/80" style={{ color: `hsl(${h} 55% 52% / 0.75)` }}>
            {(name.trim()[0] ?? "N").toUpperCase()}
          </span>
        </span>
      )}
    </span>
  );
}

/** A document's cover: its picture, or a generated page (note) / slide (presentation) with its first words. */
export function DocCover({ cover, kind, preview, id, className }: { cover: string | null; kind: NotesDocKind; preview: string; id: string; className?: string }) {
  const url = useMediaUrl(cover);
  const h = hue(id);
  if (url) return <span className={cx("block bg-cover bg-center", className)} style={{ backgroundImage: `url("${url}")` }} aria-hidden data-system-ui />;
  return (
    <span
      className={cx("relative flex items-center justify-center overflow-hidden", className)}
      style={{ background: `linear-gradient(160deg, hsl(${h} 70% 97%), hsl(${h + 6} 60% 90%))` }}
      aria-hidden
      data-system-ui
    >
      {kind === "presentation" ? (
        <span className="flex aspect-video w-[78%] flex-col justify-center gap-[6%] rounded-[8%/14%] bg-white px-[8%] shadow-[0_6px_18px_-8px_rgba(60,40,160,0.35)]">
          <span className="h-[14%] w-[70%] rounded-full" style={{ background: `hsl(${h} 70% 62%)` }} />
          <span className="h-[8%] w-[50%] rounded-full bg-[#d9d6ef]" />
        </span>
      ) : (
        <span className="flex h-[84%] w-[66%] flex-col gap-[5%] overflow-hidden rounded-[6px] bg-white p-[8%] text-left shadow-[0_6px_18px_-8px_rgba(60,40,160,0.35)]">
          {preview ? (
            <span className="line-clamp-6 text-[9px] leading-[1.35] text-[#6b6880]">{preview}</span>
          ) : (
            <>
              <span className="h-[7%] w-[60%] rounded-full" style={{ background: `hsl(${h} 70% 70%)` }} />
              <span className="h-[5%] w-full rounded-full bg-[#e5e3f3]" />
              <span className="h-[5%] w-[85%] rounded-full bg-[#e5e3f3]" />
              <span className="h-[5%] w-[70%] rounded-full bg-[#e5e3f3]" />
            </>
          )}
        </span>
      )}
    </span>
  );
}

/** The VOIDEX file icon of a share card: .txt (notes, projects) or .prsn (presentations). */
export function FileIcon({ ext, className }: { ext: ".txt" | ".prsn"; className?: string }) {
  return <img src={ext === ".prsn" ? "/brand/file-prsn.webp" : "/brand/file-txt.webp"} alt="" className={cx("object-contain", className)} draggable={false} data-system-ui />;
}

/**
 * Rename and change the cover (Step 2.6, like the Photos album sheet): a big
 * cover with "Добавить фото", the name with a clear button, ✕ and ✓.
 */
export function CoverSheet({
  open,
  onClose,
  title,
  name,
  cover,
  preview,
  onSave,
  fallback,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  name: string;
  /** Placeholder and the name used when the field is left empty (creating). */
  fallback?: string;
  cover: string | null;
  preview: (cover: string | null) => ReactNode;
  onSave: (v: { name: string; cover: string | null }) => Promise<void>;
}) {
  const t = useT();
  const ff = useFormFactor();
  const [value, setValue] = useState(name);
  const [pic, setPic] = useState(cover);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setValue(name);
      setPic(cover);
    }
  }, [open, name, cover]);
  const pick = async (file: File) => {
    setBusy(true);
    try {
      setPic(await notesApi.upload(await downscale(file)));
    } catch {
      toast({ title: t("notes.imageFailed"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} width={420} testId="notes-cover-sheet">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onClose} aria-label={t("common.cancel")} className="grid size-11 place-items-center rounded-full border border-border bg-surface text-text shadow-sm" data-testid="notes-cover-cancel">
          <RiCloseLine className="size-6" />
        </button>
        <span className="text-[15px] font-semibold text-text">{title}</span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ name: value.trim() || name || fallback || "", cover: pic });
              onClose();
            } catch {
              toast({ title: t("notes.saveFailed"), tone: "danger" });
            } finally {
              setBusy(false);
            }
          }}
          aria-label={t("common.save")}
          className="grid size-11 place-items-center rounded-full bg-primary text-white shadow-float disabled:opacity-60"
          data-testid="notes-cover-save"
        >
          <RiCheckLine className="size-6" />
        </button>
      </div>
      <div className="mt-5 flex flex-col items-center gap-3">
        <span className="relative block size-[min(52vw,220px)] overflow-hidden rounded-[28px] shadow-tile">
          {preview(pic)}
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-primary text-white shadow"
            aria-label={pic ? t("notes.cover.change") : t("notes.cover.add")}
          >
            {busy ? <Spinner size={14} className="text-white" /> : <RiImageAddLine className="size-[18px]" />}
          </button>
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => input.current?.click()} className="h-9 rounded-full bg-primary/10 px-4 text-[14px] font-medium text-primary" data-testid="notes-cover-pick">
            {pic ? t("notes.cover.change") : t("notes.cover.add")}
          </button>
          {pic && (
            <button type="button" onClick={() => setPic(null)} className="h-9 rounded-full bg-surface-secondary px-4 text-[14px] font-medium text-text-secondary" data-testid="notes-cover-remove">
              {t("notes.cover.remove")}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="notes-cover-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pick(f);
          }}
        />
      </div>
      <label className="mt-5 flex h-[52px] items-center gap-2 rounded-2xl bg-surface-secondary px-4">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          placeholder={fallback}
          autoFocus={ff === "desktop"}
          aria-label={t("notes.rename")}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium text-text outline-none"
          data-testid="notes-cover-name"
        />
        {value && (
          <button type="button" onClick={() => setValue("")} aria-label={t("common.clear")} className="grid size-6 place-items-center rounded-full bg-text-tertiary/40 text-white">
            <RiCloseLine className="size-4" />
          </button>
        )}
      </label>
    </Sheet>
  );
}

/** "Изменено 5 окт." */
export function useAgo() {
  const t = useT();
  const lang = useLanguage();
  return (iso: string) => {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return t("notes.time.today", { time: d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) });
    if (days < 7) return t("notes.time.days", { n: days });
    return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
  };
}
