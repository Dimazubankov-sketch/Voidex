import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";

/**
 * System actions — OS-level commands shown in the app menu (9 dots) next to
 * the apps, e.g. "Screenshot". An action appears only when `available()` says
 * it really works on this device and account: nothing is shown as a stub.
 *
 * Planned: Screenshot → VOIDEX Cloud.
 *   Captures the current VOIDEX screen (the workspace, not other tabs or the
 *   device) and saves it to the user's VOIDEX Cloud storage, not to the device
 *   gallery. It needs the Cloud app and its storage API (quota, file listing),
 *   which do not exist yet — so it is not registered. When Cloud ships, add:
 *
 *     { id: "screenshot", label: "system.screenshot", Icon: RiScreenshot2Line,
 *       available: () => cloudInstalled(), run: () => captureToCloud() }
 *
 *   `captureToCloud` would render the workspace to an image in the browser
 *   and upload it through the same BlobStorage the server already uses for
 *   attachments and wallpapers (a new `cloud` purpose with its own limits).
 */
export interface SystemAction {
  id: string;
  label: MessageKey;
  Icon: ComponentType<{ className?: string }>;
  available: () => boolean;
  run: () => void;
}

export const SYSTEM_ACTIONS: SystemAction[] = [];

export function availableSystemActions(): SystemAction[] {
  return SYSTEM_ACTIONS.filter((a) => a.available());
}
