import { createContext, useContext, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { RiMoreFill } from "@remixicon/react";
import type { AppId } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor, type FormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { usePopover, Popover } from "@/ui/overlays";
import { WindowMenu } from "./system-menu";

/** What the OS offers to an app running in a window. */
export interface WindowApi {
  windowId: string;
  appId: AppId;
  formFactor: FormFactor;
  focused: boolean;
  maximized: boolean;
  params: Record<string, unknown>;
  paramsVersion: number;
  /** Desktop: pointer-down handler that starts dragging the window. */
  startDrag?: (e: ReactPointerEvent) => void;
  toggleMaximize: () => void;
}

export const WindowContext = createContext<WindowApi | null>(null);

export function useWindow(): WindowApi {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error("useWindow() must be used inside a VOIDEX window");
  return ctx;
}

/** The [...] system menu button, placed by apps at the right of their header. */
export function WindowMenuButton({ className }: { className?: string }) {
  const t = useT();
  const win = useWindow();
  const pop = usePopover();
  return (
    <>
      <IconButton ref={pop.anchor} label={t("os.menu")} onClick={pop.toggle} className={className} data-testid="window-menu">
        <RiMoreFill className="size-5" />
      </IconButton>
      <Popover open={pop.open} onClose={pop.close} anchor={pop.anchor} width={230} testId="window-menu-popover">
        <WindowMenu windowId={win.windowId} onDone={pop.close} />
      </Popover>
    </>
  );
}

/**
 * App header = window title bar. On desktop it is the drag handle
 * (double-click maximizes); on phones it respects the status-bar inset.
 * The [...] menu is always its right-most control.
 */
export function WindowHeader({ children, right, className, menu = true }: { children?: ReactNode; right?: ReactNode; className?: string; menu?: boolean }) {
  const win = useWindow();
  const ff = useFormFactor();
  return (
    <div
      className={cx(
        "flex shrink-0 items-center gap-2 px-3",
        ff === "desktop" ? "h-14" : "h-14 pt-0",
        className,
      )}
      onPointerDown={(e) => {
        if (ff !== "desktop") return;
        if ((e.target as HTMLElement).closest("button, input, a, select, textarea, [data-no-drag]")) return;
        win.startDrag?.(e);
      }}
      onDoubleClick={(e) => {
        if (ff !== "desktop") return;
        if ((e.target as HTMLElement).closest("button, input, a, select, textarea, [data-no-drag]")) return;
        win.toggleMaximize();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex shrink-0 items-center gap-1" data-no-drag>
        {right}
        {menu && <WindowMenuButton />}
      </div>
    </div>
  );
}
