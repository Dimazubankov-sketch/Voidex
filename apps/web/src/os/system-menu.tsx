import { RiApps2Line, RiCheckboxBlankLine, RiCloseLine, RiHome5Line, RiSubtractLine, RiStackLine, RiCheckboxMultipleBlankLine } from "@remixicon/react";
import { APP_REGISTRY } from "@voidex/shared";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { MenuList, type MenuItem } from "@/ui/overlays";
import { useWM } from "./window-manager";

/**
 * The [...] window menu. Desktop gets real window management
 * (minimize / maximize / close / workspace). Phones get the mobile
 * equivalents — no meaningless desktop controls.
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
          { id: "home", label: t("os.home"), icon: <RiHome5Line className="size-5" />, onSelect: () => wm.goHome() },
          { id: "close", label: t("os.close"), icon: <RiCloseLine className="size-5" />, onSelect: () => wm.close(windowId), danger: true },
        ]
      : [
          { id: "home", label: t("os.home"), icon: <RiHome5Line className="size-5" />, onSelect: () => wm.goHome() },
          { id: "switcher", label: t("os.switcher"), icon: <RiStackLine className="size-5" />, onSelect: () => wm.setSwitcher(true) },
          { id: "close", label: t("os.close"), icon: <RiCloseLine className="size-5" />, onSelect: () => wm.close(windowId), danger: true },
        ];
  return <MenuList items={items} onDone={onDone} />;
}

/** [...] on the workspace itself: switching between open apps. */
export function WorkspaceMenu({ onDone }: { onDone: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const ff = useFormFactor();
  const wm = useWM();
  const open = wm.order.map((id) => wm.windows[id]!).filter(Boolean);
  const items: MenuItem[] = open.map((w) => ({
    id: `open-${w.appId}`,
    label: APP_REGISTRY[w.appId].name[lang],
    icon: <RiApps2Line className="size-5" />,
    onSelect: () => wm.focus(w.id),
  }));
  if (ff === "mobile" && open.length) {
    items.unshift({ id: "switcher", label: t("os.switcher"), icon: <RiStackLine className="size-5" />, onSelect: () => wm.setSwitcher(true) });
  }
  if (!open.length) {
    return <div className="px-3 py-3 text-[14px] text-text-secondary">{t("os.noRunning")}</div>;
  }
  return (
    <div>
      <div className="px-3 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{t("os.runningNow")}</div>
      <MenuList items={items} onDone={onDone} />
      {ff === "desktop" && (
        <MenuList
          items={[{ id: "close-all", label: t("os.closeAll"), icon: <RiCloseLine className="size-5" />, danger: true, onSelect: () => wm.closeAll() }]}
          onDone={onDone}
        />
      )}
    </div>
  );
}
