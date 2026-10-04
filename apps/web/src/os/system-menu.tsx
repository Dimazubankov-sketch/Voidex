import { RiCheckboxBlankLine, RiCloseLine, RiSubtractLine, RiStackLine, RiCheckboxMultipleBlankLine } from "@remixicon/react";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { MenuList, type MenuItem } from "@/ui/overlays";
import { requestClose, useWM } from "./window-manager";

/**
 * The [...] window menu. Desktop gets real window management
 * (minimize / maximize / close — minimizing already returns to the workspace,
 * so there is no separate "Workspace" item). Phones get the mobile
 * equivalents (Minimize → home, open apps, close) — no meaningless desktop
 * controls.
 */
export function WindowMenu({ windowId, onDone }: { windowId: string; onDone: () => void }) {
  const t = useT();
  const ff = useFormFactor();
  const wm = useWM();
  const win = wm.windows[windowId];
  if (!win) return null;

  const items: MenuItem[] =
    ff === "desktop"
      ? [
          { id: "minimize", label: t("os.minimize"), icon: <RiSubtractLine className="size-5" />, onSelect: () => wm.minimize(windowId), hint: "_" },
          {
            id: "maximize",
            label: win.state === "maximized" ? t("os.restore") : t("os.maximize"),
            icon: win.state === "maximized" ? <RiCheckboxMultipleBlankLine className="size-[18px]" /> : <RiCheckboxBlankLine className="size-[18px]" />,
            onSelect: () => wm.toggleMaximize(windowId),
          },
          { id: "close", label: t("os.close"), icon: <RiCloseLine className="size-5" />, onSelect: () => void requestClose(windowId), danger: true },
        ]
      : [
          // "Minimize": the same action and icon as on PC — back to the home screen.
          { id: "minimize", label: t("os.minimize"), icon: <RiSubtractLine className="size-5" />, onSelect: () => wm.minimize(windowId) },
          { id: "switcher", label: t("os.switcher"), icon: <RiStackLine className="size-5" />, onSelect: () => wm.setSwitcher(true) },
          { id: "close", label: t("os.close"), icon: <RiCloseLine className="size-5" />, onSelect: () => void requestClose(windowId), danger: true },
        ];
  return <MenuList items={items} onDone={onDone} />;
}
