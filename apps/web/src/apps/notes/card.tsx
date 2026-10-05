import type { NotesCardDto } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";
import { useWM } from "@/os/window-manager";

/** Opens a shared Notes card: Notes resolves it (open the original or add a copy; no access → says so). */
export const openNotesCard = (token: string) => useWM.getState().open("notes", { params: { share: token } });

/**
 * A Notes share as a file (Step 2.6): the VOIDEX .txt / .prsn icon and
 * "Name.txt". Shown in Vibex messages and VoidOps letters; tapping it opens
 * Notes. Built as a file so it can later be downloaded or kept in Files.
 */
export function NotesFileCard({ card, tone = "default", className }: { card: NotesCardDto; tone?: "default" | "mine"; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openNotesCard(card.token);
      }}
      className={cx(
        "pressable flex w-[248px] max-w-full items-center gap-3 rounded-[18px] p-2 pr-3.5 text-left",
        tone === "mine" ? "bg-white/15 text-white" : "bg-surface-secondary text-text",
        className,
      )}
      data-testid="notes-card"
      data-kind={card.kind}
      title={`${card.title}${card.ext}`}
    >
      <img src={card.ext === ".prsn" ? "/brand/file-prsn.webp" : "/brand/file-txt.webp"} alt="" draggable={false} className="size-14 shrink-0 rounded-[13px] bg-white object-contain" data-system-ui />
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 break-words text-[14.5px] font-semibold leading-tight" data-testid="notes-card-title">
          {card.title}
          {card.ext}
        </span>
        <span className={cx("text-[12.5px]", tone === "mine" ? "text-white/75" : "text-text-tertiary")}>
          {card.kind === "project" ? t("notes.card.project") : card.kind === "presentation" ? t("notes.presentation") : t("notes.card.note")}
        </span>
      </span>
    </button>
  );
}
