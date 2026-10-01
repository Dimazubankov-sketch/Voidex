import { useT } from "@/lib/i18n";
import { AppearancePanel } from "@/os/home/appearance-panel";
import { SectionTitle } from "../kit";

/**
 * Settings → Desktop: wallpaper and glass, view, scale (PC) or icons per row
 * (phone), dock. The same panel the brush menu on the home screen uses.
 */
export function DesktopSection() {
  const t = useT();
  return (
    <div data-testid="settings-desktop">
      <SectionTitle>{t("settings.desktop")}</SectionTitle>
      <AppearancePanel />
    </div>
  );
}
