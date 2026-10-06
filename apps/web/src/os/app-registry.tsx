import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { AppId } from "@voidex/shared";
import { CalculatorGlyph, FilesGlyph, MailGlyph, MediaGlyph, NotesGlyph, SettingsGlyph, VibexGlyph } from "@/brand/brand";

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
  calculator: {
    Icon: CalculatorGlyph,
    // KaTeX, mathjs and the calculator itself load with this chunk only; Tesseract (OCR) even later.
    Component: lazy(() => import("@/apps/calculator/calculator-app").then((m) => ({ default: m.CalculatorApp }))),
  },
  notes: {
    Icon: NotesGlyph,
    // The editor, its UI kit and styles load with this chunk only.
    Component: lazy(() => import("@/apps/notes/notes-app").then((m) => ({ default: m.NotesApp }))),
  },
  files: {
    Icon: FilesGlyph,
    // The Files module, its editors and UI kit load with this chunk only.
    Component: lazy(() => import("@/apps/files/files-app").then((m) => ({ default: m.FilesWindowApp }))),
  },
  media: {
    Icon: MediaGlyph,
    // The gallery loads with this chunk; its photo / video editors are split further.
    Component: lazy(() => import("@/apps/media/media-app").then((m) => ({ default: m.MediaWindowApp }))),
  },
};
