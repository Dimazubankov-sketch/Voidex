import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Step 2.9 — the feed's search (shaped like the Media / Files search).
 * Step 2.10: shared by every header that has one (Vibex feed, Mail).
 *
 * At rest a round outlined magnifier button at the right of the header. A
 * tap grows it, in its own place, into a search field over the header's free
 * space (nothing below moves; no second field appears). The X inside clears
 * the search and shrinks the field back into the button.
 */
export function ExpandingSearch({
  open,
  value,
  onOpen,
  onChange,
  onClose,
  placeholder,
  openLabel,
  closeLabel,
  testId = "vibex-feed-search",
}: {
  open: boolean;
  value: string;
  onOpen: () => void;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder: string;
  openLabel?: string;
  closeLabel?: string;
  testId?: string;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const openText = openLabel ?? t("common.search");
  const closeText = closeLabel ?? t("common.close");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), reduced ? 0 : 180);
  }, [open, reduced]);
  return (
    // The slot: the header's free space; the control grows leftwards inside it.
    <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-end" data-testid={`${testId}-slot`}>
      <motion.div
        className={cx(
          "vx-search-field pointer-events-auto flex h-10 items-center overflow-hidden rounded-full border border-border bg-surface",
          !open && "cursor-pointer hover:bg-surface-hover",
        )}
        initial={false}
        animate={{ width: open ? "100%" : 40 }}
        transition={reduced ? { duration: 0 } : { duration: 0.32, ease: EASE }}
        onClick={() => !open && onOpen()}
        data-testid={testId}
        data-open={open || undefined}
      >
        {open ? (
          <>
            <RiSearchLine className="ml-3 size-[18px] shrink-0 text-text-tertiary" aria-hidden />
            <input
              ref={input}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none placeholder:text-text-tertiary"
              data-testid={`${testId}-input`}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label={closeText}
              title={closeText}
              className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover"
              data-testid={`${testId}-close`}
            >
              <RiCloseLine className="size-[18px]" />
            </button>
          </>
        ) : (
          <button type="button" className="flex size-10 shrink-0 items-center justify-center text-text" aria-label={openText} title={openText} data-testid={`${testId}-open`}>
            <RiSearchLine className="size-[20px]" />
          </button>
        )}
      </motion.div>
    </div>
  );
}
