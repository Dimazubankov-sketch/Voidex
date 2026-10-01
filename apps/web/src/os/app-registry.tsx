import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { AppId } from "@voidex/shared";
import { MailGlyph, SettingsGlyph, VibexGlyph } from "@/brand/brand";

/**
 * Client half of the App Registry: how each registered app is drawn and
 * loaded. The manifest (name, permissions, window defaults) comes from
 * @voidex/shared and the server decides which apps a user has installed.
 *
 * Adding an app = manifest in shared/apps.ts + an entry here + its folder in
 * src/apps/<id>. Apps are code-split, so the shell doesn't grow with them.
 */
export interface ClientApp {
  Icon: ComponentType<{ className?: string }>;
  Component: LazyExoticComponent<ComponentType>;
}

export const CLIENT_APPS: Record<AppId, ClientApp> = {
  settings: {
    Icon: SettingsGlyph,
    Component: lazy(() => import("@/apps/settings/settings-app").then((m) => ({ default: m.SettingsApp }))),
  },
  mail: {
    Icon: MailGlyph,
    Component: lazy(() => import("@/apps/mail/mail-app").then((m) => ({ default: m.MailApp }))),
  },
  vibex: {
    Icon: VibexGlyph,
    Component: lazy(() => import("@/apps/vibex/vibex-app").then((m) => ({ default: m.VibexApp }))),
  },
};
