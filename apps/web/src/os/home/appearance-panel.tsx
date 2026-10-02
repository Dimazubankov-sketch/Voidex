import { useRef, useState, type ReactNode } from "react";
import { RiCheckLine, RiDeleteBinLine, RiImageAddLine } from "@remixicon/react";
import {
  DESKTOP_COLUMNS_MAX,
  DESKTOP_COLUMNS_MIN,
  WALLPAPER_PRESETS,
  defaultLayout,
  type Wallpaper,
  type WallpaperPreset,
  type WorkspaceLayout,
} from "@voidex/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Button, Spinner, Switch } from "@/ui/controls";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { DEFAULT_SWATCH, prepareWallpaper, useWallpaperImage, wallpaperStyle } from "./appearance";
import { useWorkspaceLayout, updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

/** Parts of the panel: the brush shows one at a time, Settings → Desktop all of them. */
export type AppearancePart = "wallpaper" | "view" | "dock" | "reset";

/**
 * Desktop appearance and arrangement — one panel used by the brush menu on
 * the home screen and by Settings → Desktop. Every choice is saved to the
 * account (layout.appearance / layout.mobile / layout.desktop), so it is the
 * same on every device. Controls that only make sense on the other kind of
 * device (phone icons per row vs PC scale and dock) are shown on that device.
 * New wallpaper kinds are new swatches here plus a case in `wallpaperStyle`.
 */
export function AppearancePanel({ parts = ["wallpaper", "view", "dock", "reset"] }: { parts?: AppearancePart[] }) {
  const t = useT();
  const ff = useFormFactor();
  const { layout } = useWorkspaceLayout();
  const a = layout.appearance;
  const setAppearance = (patch: Partial<WorkspaceLayout["appearance"]>) => updateLayout((l) => ({ ...l, appearance: { ...l.appearance, ...patch } }));
  const setDesktop = (patch: Partial<WorkspaceLayout["desktop"]>) => updateLayout((l) => ({ ...l, desktop: { ...l.desktop, ...patch } }));
  const [confirmReset, setConfirmReset] = useState(false);
  const pc = ff === "desktop";

  return (
    <div className="space-y-6" data-testid="appearance-panel">
      <p className="text-[13px] text-text-secondary">{t("appearance.synced")}</p>
      {parts.includes("wallpaper") && (
        <>
          <WallpaperPicker current={a.wallpaper} onPick={(wallpaper) => setAppearance({ wallpaper })} />
          <Block title={t("appearance.glass")} hint={t("appearance.glassHint")}>
            <Field label={t("appearance.glass")}>
              <Segmented
                value={a.glass}
                options={[
                  ["off", "appearance.glassOff"],
                  ["medium", "appearance.glassMedium"],
                  ["on", "appearance.glassOn"],
                ]}
                onChange={(glass) => setAppearance({ glass })}
                testId="glass"
              />
            </Field>
            {pc && (
              <Field label={t("appearance.systemBar")}>
                <Segmented
                  value={a.systemBar}
                  options={[
                    ["glass", "appearance.systemBarGlass"],
                    ["off", "appearance.systemBarOff"],
                  ]}
                  onChange={(systemBar) => setAppearance({ systemBar })}
                  testId="system-bar-style"
                />
              </Field>
            )}
          </Block>
        </>
      )}

      {parts.includes("view") && (
        <Block title={t("appearance.view")}>
          <div className="flex items-center gap-3" data-testid="show-labels">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-text">{t("appearance.showLabels")}</span>
              <span className="block text-[12.5px] text-text-tertiary">{t("appearance.showLabelsHint")}</span>
            </span>
            <Switch checked={a.showLabels} onChange={(showLabels) => setAppearance({ showLabels })} label={t("appearance.showLabels")} />
          </div>
          <Field label={t("appearance.view")}>
            <Segmented
              value={pc ? layout.desktop.view : layout.mobile.view}
              options={[
                ["grid", "home.viewGrid"],
                ["categories", "home.viewCategories"],
              ]}
              onChange={(view) => (pc ? setDesktop({ view }) : updateLayout((l) => ({ ...l, mobile: { ...l.mobile, view } })))}
              testId={pc ? "desktop-view" : "phone-view"}
            />
          </Field>
          {pc ? (
            <>
              {/* Phones scale with the number of icons per row; PCs have the scale. */}
              <Field label={t("appearance.scale")}>
                <Segmented
                  value={layout.desktop.density}
                  options={[
                    ["compact", "appearance.scaleS"],
                    ["normal", "appearance.scaleM"],
                    ["spacious", "appearance.scaleL"],
                  ]}
                  onChange={(density) => setDesktop({ density })}
                  testId="scale"
                />
              </Field>
              <Field label={t("appearance.pcColumns")}>
                <Segmented
                  value={String(layout.desktop.columns)}
                  options={Array.from({ length: DESKTOP_COLUMNS_MAX - DESKTOP_COLUMNS_MIN + 1 }, (_, i) => {
                    const v = String(i + DESKTOP_COLUMNS_MIN);
                    return [v, v] as [string, string];
                  })}
                  onChange={(v) => setDesktop({ columns: Number(v) })}
                  testId="pc-columns"
                />
              </Field>
              <Field label={t("appearance.sort")}>
                <Segmented
                  value={layout.desktop.sort}
                  options={[
                    ["manual", "appearance.sortManual"],
                    ["name", "appearance.sortName"],
                  ]}
                  onChange={(sort) => setDesktop({ sort })}
                  testId="desktop-sort"
                />
              </Field>
            </>
          ) : (
            <Field label={t("appearance.phoneColumns")}>
              <Segmented
                value={String(layout.mobile.columns) as "3" | "4"}
                options={[
                  ["3", "3"],
                  ["4", "4"],
                ]}
                onChange={(v) => updateLayout((l) => ({ ...l, mobile: { ...l.mobile, columns: v === "4" ? 4 : 3 } }))}
                testId="phone-columns"
              />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-[14px]">{t("appearance.captions")}</span>
            <Switch checked={a.captions} onChange={(captions) => setAppearance({ captions })} label={t("appearance.captions")} />
          </div>
        </Block>
      )}

      {parts.includes("dock") && pc && (
        <Block title={t("appearance.dock")}>
          <Field label={t("appearance.dockScale")}>
            <Segmented
              value={layout.desktop.dockScale}
              options={[
                ["s", "appearance.scaleS"],
                ["m", "appearance.scaleM"],
                ["l", "appearance.scaleL"],
              ]}
              onChange={(dockScale) => setDesktop({ dockScale })}
              testId="dock-scale"
            />
          </Field>
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-[14px]">{t("appearance.dockDesktops")}</span>
            <Switch checked={layout.desktop.dockDesktops} onChange={(dockDesktops) => setDesktop({ dockDesktops })} label={t("appearance.dockDesktops")} />
          </div>
        </Block>
      )}

      {parts.includes("reset") && (
        <Block title={t("appearance.reset")} hint={t("appearance.resetHint")}>
          <Button variant="secondary" onClick={() => setConfirmReset(true)} data-testid="layout-reset">
            {t("appearance.reset")}
          </Button>
          <ConfirmDialog
            open={confirmReset}
            onClose={() => setConfirmReset(false)}
            title={t("appearance.reset")}
            message={t("appearance.resetHint")}
            confirmLabel={t("appearance.reset")}
            onConfirm={() => {
              setConfirmReset(false);
              updateLayout((l) => ({ ...defaultLayout([]), appearance: l.appearance }));
              toast({ title: t("appearance.resetDone"), tone: "success" });
            }}
          />
        </Block>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[13px] font-medium uppercase tracking-wide text-text-tertiary">{title}</h3>
      {hint && <p className="mb-2 text-[13px] text-text-secondary">{hint}</p>}
      <div className="space-y-3 rounded-[20px] border border-border bg-surface p-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[14px]">{label}</span>
      {children}
    </div>
  );
}

function Segmented<V extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: V;
  options: [V, MessageKey | string][];
  onChange: (v: V) => void;
  testId?: string;
}) {
  const t = useT();
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-surface-secondary p-1" role="radiogroup" data-testid={testId}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          data-testid={testId ? `${testId}-${v}` : undefined}
          className={cx(
            "pressable h-8 min-w-9 rounded-xl px-3 text-[13px] font-medium",
            value === v ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text",
          )}
        >
          {label.includes(".") ? t(label as MessageKey) : label}
        </button>
      ))}
    </div>
  );
}

const WALLPAPER_LABEL: Record<WallpaperPreset, MessageKey> = {
  white: "wallpaper.white",
  aura: "wallpaper.aura",
  mist: "wallpaper.mist",
  "wave-light": "wallpaper.waveLight",
  "wave-milk": "wallpaper.waveMilk",
  "wave-milk-violet": "wallpaper.waveMilkViolet",
  "wave-gray": "wallpaper.waveGray",
  "wave-gray-purple": "wallpaper.waveGrayPurple",
  "wave-milk-gray-purple": "wallpaper.waveMilkGrayPurple",
};

function sameWallpaper(a: Wallpaper, b: Wallpaper) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Swatch({ wallpaper, current, onPick, label, testId, children }: { wallpaper: Wallpaper; current: Wallpaper; onPick: (w: Wallpaper) => void; label: string; testId: string; children?: ReactNode }) {
  const image = useWallpaperImage(wallpaper);
  const style = wallpaper.kind === "default" ? { background: DEFAULT_SWATCH } : wallpaperStyle(wallpaper, image.data).style;
  const active = sameWallpaper(wallpaper, current);
  return (
    <button
      type="button"
      onClick={() => onPick(wallpaper)}
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testId}
      className="pressable flex w-[68px] shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cx("relative block h-[92px] w-[64px] overflow-hidden rounded-[16px] border border-black/10 shadow-sm", active && "ring-[3px] ring-primary ring-offset-2")}
        style={style}
      >
        {children}
        {active && (
          <span className="absolute bottom-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-white">
            <RiCheckLine className="size-3.5" />
          </span>
        )}
      </span>
      <span className={cx("line-clamp-2 min-h-[2.5em] w-full text-center text-[11px] leading-tight", active ? "font-semibold text-text" : "text-text-secondary")}>{label}</span>
    </button>
  );
}

function WallpaperPicker({ current, onPick }: { current: Wallpaper; onPick: (w: Wallpaper) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasImage = current.kind === "image";

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const blob = await prepareWallpaper(file);
      const r = await api.put<{ version: string }>("/api/account/wallpaper", blob, { headers: { "Content-Type": "application/octet-stream" } });
      onPick({ kind: "image", version: r.version });
    } catch {
      toast({ title: t("appearance.imageFailed"), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    onPick({ kind: "default" });
    try {
      await api.delete("/api/account/wallpaper");
    } catch {
      /* the layout no longer points at it; a later upload replaces it anyway */
    }
  };

  return (
    <Block title={t("appearance.wallpaper")}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] justify-items-center gap-x-2 gap-y-3 pt-1" data-testid="wallpaper-presets">
        <Swatch wallpaper={{ kind: "default" }} current={current} onPick={onPick} label={t("wallpaper.default")} testId="wallpaper-default" />
        {WALLPAPER_PRESETS.map((id) => (
          <Swatch key={id} wallpaper={{ kind: "preset", id }} current={current} onPick={onPick} label={t(WALLPAPER_LABEL[id])} testId={`wallpaper-preset-${id}`} />
        ))}
      </div>
      <div>
        <div className="mb-2 text-[13px] text-text-secondary">{t("appearance.image")}</div>
        <div className="flex flex-wrap items-center gap-3">
          {hasImage && <Swatch wallpaper={current} current={current} onPick={onPick} label={t("appearance.image")} testId="wallpaper-image" />}
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy} data-testid="wallpaper-upload">
            {busy ? <Spinner size={16} /> : <RiImageAddLine className="size-4" />}
            {busy ? t("appearance.uploading") : t("appearance.upload")}
          </Button>
          {hasImage && (
            <Button variant="ghost" size="sm" onClick={removeImage} data-testid="wallpaper-remove">
              <RiDeleteBinLine className="size-4" />
              {t("appearance.removeImage")}
            </Button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-text-tertiary">{t("appearance.imageHint")}</p>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="wallpaper-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>
    </Block>
  );
}

/** Brush menu → Wallpaper (and the desktop's right-click "Wallpaper") opens this. */
export function AppearanceSheet() {
  const t = useT();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.appearanceOpen);
  const setOpen = useHomeUi((s) => s.setAppearanceOpen);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t("appearance.wallpaper")} width={ff === "desktop" ? 560 : 480} testId="appearance-sheet">
      <AppearancePanel parts={["wallpaper"]} />
    </Sheet>
  );
}
