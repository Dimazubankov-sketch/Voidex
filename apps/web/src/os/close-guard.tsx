import { create } from "zustand";
import { useT } from "@/lib/i18n";
import { Button } from "@/ui/controls";
import { Sheet } from "@/ui/overlays";

type Answer = "save" | "discard" | "cancel";

const useCloseGuard = create<{ app: string | null; resolve: ((a: Answer) => void) | null }>(() => ({ app: null, resolve: null }));

/**
 * Step 2.5: "Unsaved changes — save before closing?" for a window that is
 * being closed (WindowManager before-close hook). Shown by the shell, so it is
 * visible wherever the close came from (window menu, overview, app switcher).
 */
export function askUnsaved(app: string): Promise<Answer> {
  return new Promise((resolve) => {
    useCloseGuard.getState().resolve?.("cancel");
    useCloseGuard.setState({ app, resolve });
  });
}

export function CloseGuard() {
  const t = useT();
  const { app, resolve } = useCloseGuard();
  const answer = (a: Answer) => {
    resolve?.(a);
    useCloseGuard.setState({ app: null, resolve: null });
  };
  return (
    <Sheet
      open={app !== null}
      onClose={() => answer("cancel")}
      title={t("closeGuard.title")}
      width={440}
      testId="close-guard"
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => answer("cancel")} data-testid="close-guard-cancel">
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => answer("discard")} data-testid="close-guard-discard">
            {t("closeGuard.discard")}
          </Button>
          <Button onClick={() => answer("save")} data-testid="close-guard-save">
            {t("closeGuard.save")}
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-text-secondary">{t("closeGuard.body", { app: app ?? "" })}</p>
    </Sheet>
  );
}
