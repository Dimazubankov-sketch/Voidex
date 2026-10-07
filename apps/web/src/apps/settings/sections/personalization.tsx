import { RiCheckLine, RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react";
import { APP_LOOKS, type AppLook, type Theme, type WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { Block, Segmented } from "@/os/home/appearance-panel";
import { updateLayout, useWorkspaceLayout } from "@/os/home/layout";
import { SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";
import { VoidexSearchField } from "@/ui/search-field";

const THEMES: { id: Theme; icon: typeof RiSunLine }[] = [
  { id: "light", icon: RiSunLine },
  { id: "dark", icon: RiMoonLine },
  { id: "system", icon: RiComputerLine },
];

/**
 * Settings → Personalization: the colour theme (light, dark, as on the
 * device), the background of every search field (Step 2.7), and the glass
 * of the desktop: its level, and on PC the system bar and the dock
 * separately. Saved to the account. Wallpapers live only in Settings → Обои.
 */
export function PersonalizationSection(_: SectionProps) {
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

      {/* Step 2.8: one look for every app. */}
      <section>
        <h3 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-text-tertiary">{t("personalization.appLook")}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label={t("personalization.appLook")} data-testid="app-look">
          {APP_LOOKS.map((id) => {
            const on = a.appLook === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ appLook: id })}
                className={cx("pressable flex flex-col items-center gap-2 rounded-[20px] border bg-surface p-2.5 pb-3 text-center", on ? "border-primary ring-2 ring-primary/30" : "border-border")}
                data-testid={`app-look-${id}`}
              >
                <AppLookThumb id={id} />
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold leading-tight text-text">
                  {on && <RiCheckLine className="size-4 shrink-0 text-primary" />}
                  {t(`personalization.appLook.${id}`)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[12.5px] text-text-tertiary">{t("personalization.appLookHint")}</p>
      </section>

      <Block title={t("personalization.searchBg")} hint={t("personalization.searchBgHint")}>
        <Row label={t("personalization.searchBg")}>
          <Segmented
            value={a.searchAppearance}
            options={[
              ["system", "personalization.searchSystem"],
              ["white", "personalization.searchWhite"],
            ]}
            onChange={(searchAppearance) => set({ searchAppearance })}
            testId="personal-search-bg"
          />
        </Row>
        <VoidexSearchField value="" onChange={() => undefined} placeholder={t("home.search")} readOnly tabIndex={-1} testId="personal-search-preview" />
      </Block>

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

/** A small app window in each look: its background, a card and a field. */
const LOOK_THUMB: Record<AppLook, { bg: string; card: string; field: string; line: string }> = {
  media: { bg: "radial-gradient(ellipse at 92% -10%, #d5c5fb, transparent 55%), #f8f7fc", card: "#ffffff", field: "#f1eefa", line: "#d9d3ec" },
  notes: { bg: "#ececed", card: "#ffffff", field: "#f3f3f5", line: "#d6d6dc" },
  mail: { bg: "#ffffff", card: "#f5f5f7", field: "#ffffff", line: "#dcdce2" },
  dark: { bg: "#121218", card: "#1c1c25", field: "#252530", line: "#3a3a48" },
};

function AppLookThumb({ id }: { id: AppLook }) {
  const c = LOOK_THUMB[id];
  return (
    <span className="flex aspect-[4/3] w-full flex-col gap-1 overflow-hidden rounded-[14px] border border-black/10 p-1.5" style={{ background: c.bg }} aria-hidden>
      <span className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
      <span className="flex flex-1 flex-col gap-1 rounded-md p-1" style={{ background: c.card, boxShadow: id === "mail" ? "none" : "0 1px 2px rgba(0,0,0,.08)" }}>
        <span className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
        <span className="h-2.5 rounded" style={{ background: c.field }} />
      </span>
      <span className="h-1.5 w-1/3 rounded-full bg-[#7f72ff]" />
    </span>
  );
}
