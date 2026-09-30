import { useT } from "@/lib/i18n";
import { AppearancePanel } from "@/os/home/appearance-panel";
import { SectionTitle } from "../kit";

/**
 * Settings → Desktop: wallpaper, background colour, icon label text and size,
 * app arrangement and desktop view. The same panel as the brush on the home
 * screen; the text options change desktop labels only, not the whole system.
 */
export function DesktopSection() {
  const t = useT();
  return (
    <div data-testid="settings-desktop">
      <SectionTitle>{t("settings.desktop")}</SectionTitle>
      <AppearancePanel showReset />
    </div>
  );
}
