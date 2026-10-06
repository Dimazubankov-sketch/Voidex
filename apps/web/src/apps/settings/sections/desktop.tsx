import { RiApps2Line } from "@remixicon/react";
import { useT } from "@/lib/i18n";
import { AppearancePanel } from "@/os/home/appearance-panel";
import { useHomeUi } from "@/os/home/ui-store";
import { useWM } from "@/os/window-manager";
import { useWindow } from "@/os/window-context";
import { Group, Row, SectionTitle } from "../kit";
import type { SectionProps } from "../settings-app";

/**
 * Settings → Desktop (Step 2.5.1): view and labels, widgets, the dock — and a
 * link to the desktop wallpaper (chosen only in Settings → Wallpapers).
 */
export function DesktopSection({ navigate }: SectionProps) {
  const t = useT();
  const win = useWindow();
  return (
    <div data-testid="settings-desktop">
      <SectionTitle>{t("settings.desktop")}</SectionTitle>
      <Group>
        <Row
          icon={<RiApps2Line className="size-[18px]" />}
          label={t("desktop.widgets")}
          hint={t("desktop.widgetsHint")}
          chevron
          onClick={() => {
            // The widget gallery lives on the home screen: step aside and open it there.
            useWM.getState().minimize(win.windowId);
            useHomeUi.getState().setWidgetsOpen(true);
          }}
          testId="settings-desktop-widgets"
        />
      </Group>
      <AppearancePanel parts={["view", "dock", "reset"]} />
    </div>
  );
}
