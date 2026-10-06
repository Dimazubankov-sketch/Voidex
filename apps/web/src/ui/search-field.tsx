import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { RiCloseCircleFill, RiSearchLine } from "@remixicon/react";
import { cx } from "@/lib/cx";
import { useT } from "@/lib/i18n";

export type SearchFieldSize = "sm" | "md" | "lg";

export interface VoidexSearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Replaces the magnifier. */
  icon?: ReactNode;
  /** The clear button while there is text (default on). */
  clearable?: boolean;
  /** Called after the clear button empties the field. */
  onClear?: () => void;
  size?: SearchFieldSize;
  /**
   * "system" / "white" overrides the account's «Фон поиска» for this field;
   * by default every field follows the account (the `data-search` tokens).
   */
  appearance?: "system" | "white";
  className?: string;
  testId?: string;
  /** Extra controls at the end of the pill (a shortcut hint, a filter). */
  trailing?: ReactNode;
}

/**
 * VOIDEX search field (Step 2.7): the one search style of the system, used
 * by the OS search, Settings, Notes, Vibex, Mail, Files, Media, the launcher
 * and the share recipient search. A rounded pill with a soft background and
 * a clean border, not glass. Text is 16px on touch screens (no iOS zoom);
 * it lives in the normal flow, so the phone keyboard never covers it.
 */
export const VoidexSearchField = forwardRef<HTMLInputElement, VoidexSearchFieldProps>(function VoidexSearchField(
  { value, onChange, placeholder, icon, clearable = true, onClear, size = "md", appearance, className, testId, trailing, ...rest },
  ref,
) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  return (
    <label className={cx("vx-search", `vx-search-${size}`, className)} data-appearance={appearance} data-testid={testId ? `${testId}-field` : undefined}>
      {icon ?? <RiSearchLine aria-hidden />}
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        {...rest}
      />
      {clearable && value && (
        <button
          type="button"
          className="vx-search-clear"
          aria-label={t("common.clear")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            onClear?.();
            input.current?.focus();
          }}
          data-testid={testId ? `${testId}-clear` : undefined}
        >
          <RiCloseCircleFill className="size-[18px]" />
        </button>
      )}
      {trailing}
    </label>
  );
});
