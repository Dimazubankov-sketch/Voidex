import { useMemo, useState, type RefObject } from "react";
import { RiAddLine } from "@remixicon/react";
import type { InstalledAppDto, WorkspaceLayout } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useLanguage, useT } from "@/lib/i18n";
import { AppTile } from "@/brand/brand";
import { Popover, Sheet } from "@/ui/overlays";
import { availableSystemActions } from "../system-actions";
import { useWM } from "../window-manager";
import { addToDesktop, appLabel, openApp } from "./actions";
import { AppGlyph } from "./icons";
import { searchApps } from "./search";
import { useHomeUi } from "./ui-store";
import { VoidexSearchField } from "@/ui/search-field";

/**
 * The 9-dot menu: every installed app (also the ones removed from the desktop),
 * search, and system actions when there are real ones (see system-actions.ts).
 */
export function Launcher({ anchor, apps, layout }: { anchor: RefObject<HTMLButtonElement | null>; apps: InstalledAppDto[]; layout: WorkspaceLayout }) {
  const t = useT();
  const ff = useFormFactor();
  const lang = useLanguage();
  const open = useHomeUi((s) => s.launcherOpen);
  const setOpen = useHomeUi((s) => s.setLauncherOpen);
  const windows = useWM((s) => s.windows);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => (q.trim() ? searchApps(apps, layout, q, lang) : [...apps].sort((a, b) => appLabel(layout, a.id).localeCompare(appLabel(layout, b.id), lang))),
    [apps, layout, q, lang],
  );
  const actions = availableSystemActions();
  const close = () => {
    setOpen(false);
    setQ("");
  };

  const body = (
    <div data-testid="launcher">
      <VoidexSearchField
        className="mb-2"
        size="sm"
        value={q}
        onChange={setQ}
        onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              close();
              openApp(shown[0].id);
            }
          }}
          placeholder={t("home.search")}
          aria-label={t("home.search")}
          testId="launcher-search"
          autoFocus={ff === "desktop"}
        />
      <div className="px-2 pb-1.5 pt-1 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{t("launcher.all")}</div>
      {!shown.length && <div className="px-2 py-3 text-[14px] text-text-secondary">{t("home.searchNothing")}</div>}
      <div className="grid grid-cols-3 gap-1">
        {shown.map((a) => {
          const running = Object.values(windows).some((w) => w.appId === a.id);
          const hidden = layout.hidden.includes(a.id);
          return (
            <div key={a.id} className="relative">
              <button
                type="button"
                className="pressable flex w-full flex-col items-center gap-1.5 rounded-2xl py-3 hover:bg-surface-hover"
                onClick={(e) => {
                  close();
                  openApp(a.id, e.currentTarget);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  useHomeUi.getState().openMenu({ x: e.clientX, y: e.clientY, target: { kind: "launcher-app", id: a.id } });
                }}
                data-testid={`launcher-${a.id}`}
              >
                <span data-tile>
                  <AppTile size={52}>
                    <AppGlyph id={a.id} />
                  </AppTile>
                </span>
                <span className="max-w-full truncate px-1 text-[13px] font-medium">{appLabel(layout, a.id)}</span>
                <span className={cx("size-1 rounded-full", running ? "bg-primary" : "bg-transparent")} />
              </button>
              {hidden && (
                <button
                  type="button"
                  className="pressable absolute right-2 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow-glow"
                  onClick={() => addToDesktop(a.id)}
                  aria-label={t("home.addToDesktop")}
                  title={t("home.addToDesktop")}
                  data-testid={`launcher-add-${a.id}`}
                >
                  <RiAddLine className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {actions.length > 0 && (
        <>
          <div className="px-2 pb-1.5 pt-3 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{t("launcher.system")}</div>
          <div className="grid grid-cols-3 gap-1">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                className="pressable flex flex-col items-center gap-1.5 rounded-2xl py-3 hover:bg-surface-hover"
                onClick={() => {
                  close();
                  a.run();
                }}
                data-testid={`system-action-${a.id}`}
              >
                <a.Icon className="size-7 text-text-secondary" />
                <span className="text-[13px] font-medium">{t(a.label)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  if (ff === "mobile") {
    return (
      <Sheet open={open} onClose={close} title={t("os.apps")}>
        {body}
      </Sheet>
    );
  }
  return (
    <Popover open={open} onClose={close} anchor={anchor} width={340} testId="launcher-popover">
      <div className="max-h-[70vh] overflow-auto p-1.5">{body}</div>
    </Popover>
  );
}
