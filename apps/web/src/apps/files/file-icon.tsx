import { cx } from "@/lib/cx";

/** .txt / .prsn / .book tile used by the share dialog and the attach chooser. */
export function FileTypeIcon({ kind, className }: { kind: "txt" | "prsn" | "book"; className?: string }) {
  return (
    <span
      className={cx(
        "grid size-12 shrink-0 place-items-center rounded-[12px] text-[11px] font-bold uppercase tracking-wide",
        kind === "prsn" ? "bg-[#fff1e6] text-[#c25a12]" : kind === "book" ? "bg-[#e9f7ef] text-[#1f8a4c]" : "bg-[#efedff] text-[#5b4af0]",
        className,
      )}
    >
      .{kind}
    </span>
  );
}
