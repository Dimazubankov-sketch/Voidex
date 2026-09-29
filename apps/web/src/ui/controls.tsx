import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { RiArrowLeftLine, RiArrowRightLine, RiCheckLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { cx } from "@/lib/cx";

// ---------------------------------------------------------------------------
// Spinner

export function Spinner({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("shrink-0", className)}
      style={{ animation: "vx-spin 0.8s linear infinite" }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Buttons

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-[0_6px_16px_rgba(108,92,255,0.28)] disabled:shadow-none",
  secondary: "bg-surface text-text border border-border hover:bg-surface-hover shadow-[0_1px_2px_rgba(16,16,22,0.04)]",
  ghost: "bg-transparent text-text hover:bg-surface-hover",
  soft: "bg-primary-soft text-primary-strong hover:bg-[#e5e1ff]",
  danger: "bg-danger-soft text-danger hover:bg-[#fbdcdc]",
};
const SIZES = { sm: "h-9 px-3.5 text-[13px] rounded-xl gap-1.5", md: "h-11 px-4 text-[15px] rounded-2xl gap-2", lg: "h-[52px] px-5 text-[16px] rounded-2xl gap-2" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "pressable inline-flex select-none items-center justify-center font-semibold whitespace-nowrap",
        "disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 18} /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" | "lg"; active?: boolean; tone?: "default" | "surface" }
>(function IconButton({ label, size = "md", active, tone = "default", className, children, type = "button", ...rest }, ref) {
  const s = size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "pressable inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary",
        "hover:bg-surface-hover hover:text-text disabled:opacity-40",
        tone === "surface" && "bg-surface shadow-tile hover:bg-surface",
        active && "bg-primary-soft text-primary",
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/**
 * The large round arrow used to move through step-by-step flows. Sits in the
 * bottom-right corner, comfortably reachable by the thumb on phones.
 */
export function RoundNavButton({
  direction = "next",
  onClick,
  disabled,
  loading,
  done,
  label,
  type = "button",
}: {
  direction?: "next" | "back";
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  done?: boolean;
  label: string;
  type?: "button" | "submit";
}) {
  const next = direction === "next";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      title={label}
      data-testid={next ? "step-next" : "step-back"}
      className={cx(
        "pressable inline-flex items-center justify-center rounded-full",
        next
          ? "size-16 bg-primary text-white shadow-glow hover:bg-primary-hover disabled:bg-[#cfcbe9] disabled:shadow-none disabled:opacity-100"
          : "size-14 bg-surface text-text shadow-tile hover:bg-surface-hover disabled:opacity-40",
      )}
    >
      {loading ? (
        <Spinner size={22} />
      ) : done ? (
        <RiCheckLine className="size-7 animate-pop" />
      ) : next ? (
        <RiArrowRightLine className="size-7" />
      ) : (
        <RiArrowLeftLine className="size-6" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Text fields

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  error?: string;
  hint?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  compact?: boolean;
}

/** Inset field with a floating label — the base input across VOIDEX. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, right, left, compact, className, id, value, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const filled = value !== undefined && value !== null && String(value).length > 0;
  return (
    <div className={cx("w-full", className)}>
      <div
        className={cx(
          "group relative flex items-center rounded-2xl border bg-surface-secondary transition-colors",
          "focus-within:border-primary focus-within:bg-surface focus-within:shadow-[0_0_0_4px_rgba(108,92,255,0.12)]",
          error ? "border-danger bg-danger-soft/40" : "border-transparent",
          compact ? "h-12" : "h-[58px]",
        )}
      >
        {left && <div className="pl-4 text-text-secondary">{left}</div>}
        <div className="relative flex-1 self-stretch">
          <input
            ref={ref}
            id={inputId}
            value={value}
            aria-invalid={!!error || undefined}
            aria-describedby={error || hint ? `${inputId}-desc` : undefined}
            placeholder=" "
            className={cx(
              "peer h-full w-full bg-transparent px-4 text-[16px] text-text outline-none placeholder:text-transparent",
              compact ? "pt-0" : "pt-4",
              left && "pl-3",
            )}
            {...rest}
          />
          {!compact && (
            <label
              htmlFor={inputId}
              className={cx(
                "pointer-events-none absolute left-4 origin-left text-text-secondary transition-all duration-150",
                left && "left-3",
                filled
                  ? "top-2 text-[12px]"
                  : "top-1/2 -translate-y-1/2 text-[16px] peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-[12px] peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[12px]",
              )}
            >
              {label}
            </label>
          )}
          {compact && !filled && (
            <label htmlFor={inputId} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-text-tertiary peer-[:not(:placeholder-shown)]:hidden">
              {label}
            </label>
          )}
        </div>
        {right && <div className="flex items-center pr-2">{right}</div>}
      </div>
      {(error || hint) && (
        <div id={`${inputId}-desc`} className={cx("mt-1.5 px-1 text-[13px]", error ? "text-danger animate-fade-up" : "text-text-secondary")}>
          {error || hint}
        </div>
      )}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, "type" | "right"> & { showLabel: string; hideLabel: string }>(
  function PasswordField({ showLabel, hideLabel, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <TextField
        ref={ref}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        right={
          <IconButton label={visible ? hideLabel : showLabel} size="sm" onClick={() => setVisible((v) => !v)} tabIndex={-1}>
            {visible ? <RiEyeOffLine className="size-[18px]" /> : <RiEyeLine className="size-[18px]" />}
          </IconButton>
        }
        {...props}
      />
    );
  },
);

// ---------------------------------------------------------------------------
// OTP

/**
 * Six-digit code entry. A single real input keeps SMS autofill
 * (autocomplete="one-time-code") and paste working; boxes are visual.
 */
export function OtpInput({
  value,
  onChange,
  error,
  disabled,
  autoFocus,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onComplete?: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className={cx("relative block", error && "animate-shake")}>
      <input
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.(v);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Verification code"
        data-testid="otp-input"
        className="absolute inset-0 z-10 w-full opacity-0"
        style={{ caretColor: "transparent" }}
      />
      <div className="flex justify-between gap-2">
        {Array.from({ length: 6 }, (_, i) => {
          const active = focused && (i === value.length || (i === 5 && value.length === 6));
          return (
            <div
              key={i}
              className={cx(
                "flex h-14 flex-1 items-center justify-center rounded-2xl border text-[22px] font-semibold tabular-nums transition-all",
                error ? "border-danger bg-danger-soft/50 text-danger" : active ? "border-primary bg-surface shadow-[0_0_0_4px_rgba(108,92,255,0.12)]" : "border-transparent bg-surface-secondary",
                value[i] && "animate-pop",
              )}
            >
              {value[i] ?? ""}
            </div>
          );
        })}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Checkbox & switch

export function Checkbox({
  checked,
  onChange,
  children,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <label className="flex cursor-default items-start gap-3 py-1">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span
        aria-hidden
        className={cx(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-all duration-150",
          "peer-focus-visible:ring-4 peer-focus-visible:ring-primary/20",
          checked ? "border-primary bg-primary text-white" : "border-border-strong bg-surface",
        )}
      >
        <svg viewBox="0 0 24 24" className="size-4">
          <path
            d="M5 12.5l4.2 4.2L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="30"
            style={{ strokeDashoffset: checked ? 0 : 30, transition: "stroke-dashoffset 220ms var(--ease-out)" }}
          />
        </svg>
      </span>
      <span className="text-[15px] leading-snug text-text">{children}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-primary" : "bg-border-strong",
      )}
    >
      <span
        className="absolute left-[3px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
        style={{ transform: `translateX(${checked ? 20 : 0}px)`, transition: "transform 260ms var(--ease-spring)" }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Misc

export function Notice({ tone = "info", children, className, "data-testid": testId }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string; "data-testid"?: string }) {
  const tones = {
    info: "bg-primary-soft text-primary-strong",
    warning: "bg-warning-soft text-[#8a5a00]",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  };
  return <div className={cx("rounded-2xl px-4 py-3 text-[14px] leading-snug animate-fade-up", tones[tone], className)} role={tone === "danger" ? "alert" : "status"} data-testid={testId}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-xl", className)} />;
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center animate-fade-up">
      <div className="flex size-16 items-center justify-center rounded-3xl bg-surface-secondary text-text-tertiary">{icon}</div>
      <div className="text-[16px] font-semibold text-text">{title}</div>
      {hint && <div className="max-w-xs text-[14px] text-text-secondary">{hint}</div>}
      {action}
    </div>
  );
}
