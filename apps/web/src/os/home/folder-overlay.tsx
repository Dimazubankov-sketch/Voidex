import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { renameFolder, type LayoutItem, type WorkspaceLayout } from "@voidex/shared";
import { useFormFactor } from "@/lib/form-factor";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import type { LabelTone } from "./appearance";
import { HomeItem, type IconMetrics, type LabelStyle } from "./icons";
import { updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * An open folder: frosted panel over the blurred desktop with its apps. Tap an
 * app to open it, tap the name to rename, drag to reorder, drag out of the
 * panel to take an app out. Tap outside closes it.
 */
export function FolderOverlay({
  layout,
  editing,
  onOpen,
  tone,
}: {
  layout: WorkspaceLayout;
  editing: boolean;
  onOpen: (item: LayoutItem, el: HTMLElement) => void;
  /** Title colour against the wallpaper behind the folder. */
  tone: LabelTone;
}) {
  const t = useT();
  const ff = useFormFactor();
  const open = useHomeUi((s) => s.openFolder);
  const renaming = useHomeUi((s) => s.renamingFolder);
  const drag = useHomeUi((s) => s.drag);
  const folder = open ? layout.folders.find((f) => f.id === open.id) : undefined;
  const close = () => useHomeUi.getState().setOpenFolder(null);

  useEffect(() => {
    if (!folder) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && !useHomeUi.getState().renamingFolder && close();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [folder]);

  // The folder vanished (last app taken out / ungrouped elsewhere).
  useEffect(() => {
    if (open && !folder && !drag) close();
  }, [open, folder, drag]);

  const cols = ff === "mobile" ? 3 : Math.min(4, Math.max(3, Math.ceil(Math.sqrt(folder?.apps.length ?? 1))));
  const metrics: IconMetrics = ff === "mobile" ? { tile: 62, cell: 88, gapX: 0, gapY: 18 } : { tile: 64, cell: 104, gapX: 0, gapY: 18 };
  const label: LabelStyle = { tone: "dark", size: layout.appearance.labelSize, captions: false };
  const origin = open?.origin;
  const from = origin
    ? { opacity: 0, scale: 0.3, x: origin.left + origin.width / 2 - window.innerWidth / 2, y: origin.top + origin.height / 2 - window.innerHeight / 2 }
    : { opacity: 0, scale: 0.9, x: 0, y: 0 };

  return createPortal(
    <AnimatePresence>
      {folder && (
        <motion.div className="fixed inset-0 z-[120] flex items-center justify-center p-4" exit={{ pointerEvents: "none" }} data-testid="folder-overlay">
          <motion.div
            className="vx-glass-scrim absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={{ duration: 0.22 }}
            onClick={() => !useHomeUi.getState().drag && close()}
            data-testid="folder-backdrop"
          />
          <motion.div
            className="relative flex w-full flex-col items-center"
            style={{ maxWidth: cols * metrics.cell + 48 }}
            initial={from}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={from}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <FolderTitle id={folder.id} name={folder.name || t("home.folder")} renaming={renaming === folder.id} tone={tone} />
            <div
              data-folder-panel
              className="vx-glass w-full rounded-[36px] p-5"
            >
              <div
                className="grid justify-center"
                style={{ gridTemplateColumns: `repeat(${cols}, ${metrics.cell}px)`, rowGap: metrics.gapY }}
                data-home-container={`folder:${folder.id}`}
              >
                {folder.apps.map((id, i) => (
                  <HomeItem
                    key={id}
                    item={{ kind: "app", id }}
                    layout={layout}
                    metrics={metrics}
                    label={label}
                    index={i}
                    editing={editing}
                    placeholder={drag?.item.kind === "app" && drag.item.id === id && !!drag.fromFolder}
                    inFolder={folder.id}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function FolderTitle({ id, name, renaming, tone }: { id: string; name: string; renaming: boolean; tone: LabelTone }) {
  const t = useT();
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      setValue(name);
      requestAnimationFrame(() => input.current?.select());
    }
  }, [renaming]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const v = value.trim();
    if (v && v !== name) updateLayout((l) => renameFolder(l, id, v));
    useHomeUi.getState().setRenamingFolder(null);
  };
  if (renaming) {
    return (
      <input
        ref={input}
        value={value}
        maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") useHomeUi.getState().setRenamingFolder(null);
        }}
        aria-label={t("home.folderName")}
        className="mb-4 w-full max-w-[300px] rounded-2xl border border-white/70 bg-white/70 px-4 py-2 text-center text-[22px] font-bold tracking-tight outline-none backdrop-blur-xl focus:ring-4 focus:ring-primary/25"
        data-testid="folder-name-input"
      />
    );
  }
  return (
    <button
      type="button"
      className={cx(
        "mb-4 max-w-full truncate rounded-2xl px-4 py-1.5 text-[24px] font-bold tracking-tight hover:bg-white/20",
        tone === "light" ? "text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.25)]" : "text-text [text-shadow:0_1px_8px_rgba(255,255,255,0.6)]",
      )}
      onClick={() => useHomeUi.getState().setRenamingFolder(id)}
      title={t("home.rename")}
      data-testid="folder-name"
    >
      {name}
    </button>
  );
}
