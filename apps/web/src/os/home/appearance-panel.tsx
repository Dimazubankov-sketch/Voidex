import { useState, type ReactNode } from "react";
import {
  defaultLayout,
  type WallpaperPreset,
  type WorkspaceLayout,
} from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT, type MessageKey } from "@/lib/i18n";
import { Button, Switch } from "@/ui/controls";
import { ConfirmDialog, toast } from "@/ui/overlays";
import { useWorkspaceLayout, updateLayout } from "./layout";

/** Parts of the panel (wallpapers are chosen only in Settings → Wallpapers, glass in Personalization). */
export type AppearancePart = "view" | "dock" | "reset";

/**
 * Desktop appearance and arrangement — one panel used by the brush menu on
 * the home screen and by Settings → Desktop. Every choice is saved to the
 * account (layout.appearance / layout.mobile / layout.desktop), so it is the
 * same on every device. Controls that only make sense on the other kind of
 * device (phone icons per row vs PC scale and dock) are shown on that device.
 * New wallpaper kinds are new swatches here plus a case in `wallpaperStyle`.
 */
export function AppearancePanel({ parts = ["view", "dock", "reset"] }: { parts?: AppearancePart[] }) {
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

export function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
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

export function Segmented<V extends string>({
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

export const WALLPAPER_LABEL: Record<WallpaperPreset, MessageKey> = {
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
