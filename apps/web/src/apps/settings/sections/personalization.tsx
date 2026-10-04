import { RiCheckLine, RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";
import type { Theme, WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Block, Segmented } from "@/os/home/appearance-panel";
import { updateLayout, useWorkspaceLayout } from "@/os/home/layout";
import { SectionTitle } from "../kit";

const THEMES: { id: Theme; icon: typeof RiSunLine }[] = [
  { id: "light", icon: RiSunLine },
  { id: "dark", icon: RiMoonLine },
  { id: "system", icon: RiComputerLine },
];

/**
 * Settings → Personalization (Step 2.5): the colour theme (light, dark,
 * as on the device) and the glass of the desktop — its level, and on PC the
 * system bar and the dock separately. Saved to the account.
 */
export function PersonalizationSection() {
  const t = useT();
  const ff = useFormFactor();
  const { layout } = useWorkspaceLayout();
  const a = layout.appearance;
  const set = (patch: Partial<WorkspaceLayout["appearance"]>) => updateLayout((l) => ({ ...l, appearance: { ...l.appearance, ...patch } }));
  return (
    <div data-testid="settings-personalization" className="space-y-6">
      <SectionTitle subtitle={t("personalization.subtitle")}>{t("settings.personalization")}</SectionTitle>
      <section>
        <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-text-tertiary">{t("personalization.theme")}</h3>
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t("personalization.theme")} data-testid="theme">
          {THEMES.map(({ id, icon: Icon }) => {
            const on = a.theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ theme: id })}
                className={cx("pressable flex flex-col items-center gap-2 rounded-[20px] border bg-surface p-2.5 pb-3 text-center", on ? "border-primary ring-2 ring-primary/30" : "border-border")}
                data-testid={`theme-${id}`}
              >
                <ThemeThumb id={id} />
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text">
                  {on ? <RiCheckLine className="size-4 text-primary" /> : <Icon className="size-4 text-text-tertiary" />}
                  {t(`personalization.${id}`)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[12.5px] text-text-tertiary">{t("personalization.themeHint")}</p>
      </section>

      <Block title={t("appearance.glass")} hint={t("appearance.glassHint")}>
        <Row label={t("appearance.glass")}>
          <Segmented
            value={a.glass}
            options={[
              ["off", "appearance.glassOff"],
              ["medium", "appearance.glassMedium"],
              ["on", "appearance.glassOn"],
            ]}
            onChange={(glass) => set({ glass })}
            testId="personal-glass"
          />
        </Row>
        {ff === "desktop" && (
          <>
            <Row label={t("appearance.systemBar")}>
              <Segmented
                value={a.systemBar}
                options={[
                  ["glass", "appearance.systemBarGlass"],
                  ["off", "appearance.systemBarOff"],
                ]}
                onChange={(systemBar) => set({ systemBar })}
                testId="personal-system-bar"
              />
            </Row>
            <Row label={t("appearance.dock")}>
              <Segmented
                value={a.dock}
                options={[
                  ["glass", "appearance.systemBarGlass"],
                  ["off", "appearance.systemBarOff"],
                ]}
                onChange={(dock) => set({ dock })}
                testId="personal-dock"
              />
            </Row>
          </>
        )}
      </Block>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[14px]">{label}</span>
      {children}
    </div>
  );
}

/** A small window in the theme's colours (split for "system"). */
function ThemeThumb({ id }: { id: Theme }) {
  const pane = (dark: boolean) => (
    <span className={cx("flex h-full flex-1 flex-col gap-1 p-1.5", dark ? "bg-[#1c1c25]" : "bg-[#f5f5f7]")}>
      <span className={cx("h-2 w-2/3 rounded-full", dark ? "bg-[#3a3a48]" : "bg-[#dcdce3]")} />
      <span className={cx("h-6 rounded-md", dark ? "bg-[#2a2a36]" : "bg-white")} />
      <span className="h-2 w-1/2 rounded-full bg-[#7f72ff]" />
    </span>
  );
  return (
    <span className="flex aspect-[4/3] w-full overflow-hidden rounded-[14px] border border-black/10" aria-hidden>
      {id === "system" ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(id === "dark")
      )}
    </span>
  );
}
