import { useEffect, useState } from "react";
import { APP_LABEL_MAX, APP_REGISTRY, SPACE_NAME_MAX, renameApp, renameSpace, type WorkspaceLayout } from "@voidex/shared";
import { useLanguage, useT } from "@/lib/i18n";
import { Button, TextField } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";
import { appLabel } from "./actions";
import { updateLayout } from "./layout";
import { useHomeUi } from "./ui-store";

/** Renames an icon label (the app keeps its name) or a PC desktop. */
export function RenameSheet({ layout }: { layout: WorkspaceLayout }) {
  const t = useT();
  const lang = useLanguage();
  const target = useHomeUi((s) => s.renaming);
  const close = () => useHomeUi.getState().setRenaming(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!target) return;
    setValue(target.kind === "app" ? appLabel(layout, target.id) : (layout.desktop.spaces.find((s) => s.id === target.id)?.name ?? ""));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!target) return;
    if (target.kind === "app") {
      const v = value.trim() === APP_REGISTRY[target.id].name[lang] ? "" : value;
      updateLayout((l) => renameApp(l, target.id, v));
    } else updateLayout((l) => renameSpace(l, target.id, value));
    close();
  };

  return (
    <Sheet open={!!target} onClose={close} title={target?.kind === "space" ? t("home.rename") : t("home.renameApp")} width={420} testId="rename-sheet">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label={target?.kind === "space" ? t("home.spaces") : t("home.renameApp")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={target?.kind === "space" ? SPACE_NAME_MAX : APP_LABEL_MAX}
          autoFocus
          data-testid="rename-input"
        />
        {target?.kind === "app" && <p className="mt-2 text-[13px] text-text-secondary">{t("home.renameAppHint")}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" data-testid="rename-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
