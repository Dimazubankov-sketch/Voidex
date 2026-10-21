import type { ComponentType, LazyExoticComponent } from "react";
import { lazyWithRecovery } from "@/lib/app-update";
import type { AppId } from "@voidex/shared";
import { CalculatorGlyph, ClockGlyph, FilesGlyph, FormaGlyph, MailGlyph, MediaGlyph, NotesGlyph, SettingsGlyph, StoreGlyph, VibexGlyph } from "@/brand/brand";

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
    Component: lazyWithRecovery(() => import("@/apps/settings/settings-app").then((m) => ({ default: m.SettingsApp }))),
  },
  mail: {
    Icon: MailGlyph,
    Component: lazyWithRecovery(() => import("@/apps/mail/mail-app").then((m) => ({ default: m.MailApp }))),
  },
  vibex: {
    Icon: VibexGlyph,
    Component: lazyWithRecovery(() => import("@/apps/vibex/vibex-app").then((m) => ({ default: m.VibexApp }))),
  },
  calculator: {
    Icon: CalculatorGlyph,
    // KaTeX, mathjs and the calculator itself load with this chunk only; Tesseract (OCR) even later.
    Component: lazyWithRecovery(() => import("@/apps/calculator/calculator-app").then((m) => ({ default: m.CalculatorApp }))),
  },
  notes: {
    Icon: NotesGlyph,
    // The editor, its UI kit and styles load with this chunk only.
    Component: lazyWithRecovery(() => import("@/apps/notes/notes-app").then((m) => ({ default: m.NotesApp }))),
  },
  files: {
    Icon: FilesGlyph,
    // The Files module, its editors and UI kit load with this chunk only.
    Component: lazyWithRecovery(() => import("@/apps/files/files-app").then((m) => ({ default: m.FilesWindowApp }))),
  },
  media: {
    Icon: MediaGlyph,
    // The gallery loads with this chunk; its photo / video editors are split further.
    Component: lazyWithRecovery(() => import("@/apps/media/media-app").then((m) => ({ default: m.MediaWindowApp }))),
  },
  clock: {
    Icon: ClockGlyph,
    // Step 2.14: the Clock UI (its drums, lists, sound picker) loads with this chunk; the alarm scheduler is part of the shell.
    Component: lazyWithRecovery(() => import("@/apps/clock/clock-app").then((m) => ({ default: m.ClockApp }))),
  },
  forma: {
    Icon: FormaGlyph,
    // Forma: the editor, its component runtime and the sound library load with this chunk only.
    Component: lazyWithRecovery(() => import("@/apps/forma/forma-app").then((m) => ({ default: m.FormaApp }))),
  },
  store: {
    Icon: StoreGlyph,
    // Step 2.11: Appex Store; its screenshots load lazily as they scroll in.
    Component: lazyWithRecovery(() => import("@/apps/store/store-app").then((m) => ({ default: m.StoreApp }))),
  },
};

/** Step 2.11: loads an app's code (what "installing" it fetches); resolves once it is ready to open. */
export const APP_LOADERS: Record<AppId, () => Promise<unknown>> = {
  settings: () => import("@/apps/settings/settings-app"),
  mail: () => import("@/apps/mail/mail-app"),
  vibex: () => import("@/apps/vibex/vibex-app"),
  calculator: () => import("@/apps/calculator/calculator-app"),
  notes: () => import("@/apps/notes/notes-app"),
  files: () => import("@/apps/files/files-app"),
  media: () => import("@/apps/media/media-app"),
  clock: () => import("@/apps/clock/clock-app"),
  forma: () => import("@/apps/forma/forma-app"),
  store: () => import("@/apps/store/store-app"),
};
