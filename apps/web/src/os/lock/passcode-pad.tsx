import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { RiDeleteBack2Line } from "@remixicon/react";
import { PASSCODE_LENGTH } from "@voidex/shared";
import { cx } from "@/lib/cx";
import { useFormFactor } from "@/lib/form-factor";
import { useT } from "@/lib/i18n";

/**
 * Six-digit code-password entry: six dots and a VOIDEX keypad (soft rounded
 * keys, digits only). On PC the keyboard types too (digits, Backspace).
 * `onSubmit` resolves true when the code was accepted; otherwise the dots
 * shake and clear.
 */
export function PasscodePad({
  title,
  hint,
  error,
  disabled,
  onSubmit,
  extraKey,
  testId = "passcode-pad",
  autoFocusKeyboard = true,
  extraLabel,
}: {
  title: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  onSubmit: (code: string) => Promise<boolean>;
  /** The bottom-left key (e.g. Face ID); empty when not given. */
  extraKey?: ReactNode;
  testId?: string;
  autoFocusKeyboard?: boolean;
  /** PC: the text of the link made of `extraKey` (e.g. "Use Face ID / Windows Hello"). */
  extraLabel?: string;
}) {
  const t = useT();
  // Step 2.5: PC gets a keyboard-first field; phones keep the keypad.
  const keyboardFirst = useFormFactor() === "desktop";
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const codeRef = useRef(code);
  const root = useRef<HTMLDivElement>(null);
  codeRef.current = code;

  const press = (d: string) => {
    if (disabled || busy || codeRef.current.length >= PASSCODE_LENGTH) return;
    const next = codeRef.current + d;
    codeRef.current = next;
    setCode(next);
    if (next.length === PASSCODE_LENGTH) {
      setBusy(true);
      onSubmit(next)
        .then((ok) => {
          if (!ok) setShake((n) => n + 1);
        })
        .catch(() => setShake((n) => n + 1))
        .finally(() => {
          setBusy(false);
          codeRef.current = "";
          setCode("");
          // A wrong code: the field is cleared and keeps the keyboard.
          if (keyboardFirst) window.setTimeout(() => input.current?.focus(), 0);
        });
    }
  };
  const back = () => {
    if (busy) return;
    codeRef.current = codeRef.current.slice(0, -1);
    setCode(codeRef.current);
  };

  // PC: type the code on the keyboard.
  useEffect(() => {
    if (!autoFocusKeyboard) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Two pads on screen (a confirmation over a sheet): only the newest one types.
      const pads = document.querySelectorAll("[data-passcode-pad]");
      if (pads.length > 1 && pads[pads.length - 1] !== root.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // PC: focus the field when it appears and again once a block is over.
  useEffect(() => {
    if (!keyboardFirst || disabled) return;
    const id = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [keyboardFirst, disabled]);

  if (keyboardFirst) {
    return (
      <div ref={root} className="flex w-full flex-col items-center" data-testid={testId} data-passcode-pad data-variant="keyboard" onPointerDown={() => window.setTimeout(() => input.current?.focus(), 0)}>
        <div className="text-center text-[17px] font-semibold tracking-tight text-text">{title}</div>
        {hint && <div className="mt-1 max-w-[300px] text-center text-[13px] text-text-secondary">{hint}</div>}
        <motion.label
          key={shake}
          className={cx("relative mt-5 flex cursor-text gap-2", disabled && "opacity-50")}
          animate={shake ? { x: [0, -10, 10, -7, 7, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
          data-testid="passcode-dots"
          data-filled={code.length}
        >
          <input
            ref={input}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={PASSCODE_LENGTH}
            value={code}
            disabled={disabled || busy}
            aria-label={typeof title === "string" ? title : t("lock.enterCode")}
            aria-invalid={!!error || undefined}
            className="absolute inset-0 z-10 size-full cursor-text opacity-0"
            data-testid="passcode-input"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, PASSCODE_LENGTH);
              if (digits.length < codeRef.current.length) {
                codeRef.current = digits;
                setCode(digits);
                return;
              }
              for (const d of digits.slice(codeRef.current.length)) press(d);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter confirms a complete code (it is also sent by itself on the sixth digit).
                if (codeRef.current.length === PASSCODE_LENGTH && !busy) {
                  const full = codeRef.current;
                  codeRef.current = full.slice(0, -1);
                  press(full.slice(-1));
                }
              }
            }}
          />
          {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cx(
                "grid h-[52px] w-11 place-items-center rounded-[14px] border bg-surface/70 transition-colors",
                i === code.length && !disabled ? "border-primary ring-2 ring-primary/25" : "border-border-strong",
                shake > 0 && code.length === 0 && error && "border-danger/60",
              )}
            >
              {i < code.length && <span className="size-2.5 rounded-full bg-text" />}
            </span>
          ))}
        </motion.label>
        <div className="mt-2 min-h-[20px] text-center text-[13px] font-medium text-danger" role="alert" data-testid="passcode-error">
          {error}
        </div>
        <div className="text-[12px] text-text-tertiary">{t("lock.keyboardHint")}</div>
        {extraKey && (
          <div className="mt-4 flex items-center gap-1 text-[13.5px] font-medium text-primary" data-testid="passcode-extra">
            {extraKey}
            {extraLabel && (
              <span aria-hidden className="cursor-pointer hover:underline" onClick={(e) => e.currentTarget.parentElement?.querySelector("button")?.click()}>
                {extraLabel}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={root} className="flex w-full flex-col items-center" data-testid={testId} data-passcode-pad data-variant="keypad">
      <div className="text-center text-[17px] font-semibold tracking-tight text-text">{title}</div>
      {hint && <div className="mt-1 max-w-[280px] text-center text-[13px] text-text-secondary">{hint}</div>}
      <motion.div
        key={shake}
        className="mt-5 flex gap-3.5"
        animate={shake ? { x: [0, -10, 10, -7, 7, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
        data-testid="passcode-dots"
        data-filled={code.length}
        aria-label={t("lock.digitsEntered", { n: code.length, total: PASSCODE_LENGTH })}
      >
        {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cx(
              "size-3.5 rounded-full border-[1.5px] transition-all duration-150",
              i < code.length ? "scale-110 border-primary bg-primary" : "border-primary/45 bg-transparent",
              shake > 0 && code.length === 0 && error && "border-danger/60",
            )}
          />
        ))}
      </motion.div>
      <div className="mt-2 min-h-[20px] text-center text-[13px] font-medium text-danger" role="alert" data-testid="passcode-error">
        {error}
      </div>
      <div className={cx("mt-2 grid grid-cols-3 gap-3", disabled && "pointer-events-none opacity-45")}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => press(d)} label={d} testId={`key-${d}`}>
            {d}
          </Key>
        ))}
        <div className="grid size-[68px] place-items-center">{extraKey}</div>
        <Key onClick={() => press("0")} label="0" testId="key-0">
          0
        </Key>
        <button
          type="button"
          onClick={back}
          aria-label={t("lock.erase")}
          data-testid="key-back"
          className="grid size-[68px] place-items-center rounded-[22px] text-text-secondary transition-colors hover:bg-white/50 active:scale-95"
        >
          <RiDeleteBack2Line className="size-6" />
        </button>
      </div>
    </div>
  );
}

function Key({ children, onClick, label, testId }: { children: ReactNode; onClick: () => void; label: string; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="grid size-[68px] place-items-center rounded-[22px] border border-white/80 bg-white/60 text-[26px] font-light text-primary-strong shadow-[0_1px_0_#fff_inset,0_6px_18px_-10px_rgba(90,70,200,0.45)] backdrop-blur-md transition-[transform,background-color] duration-100 hover:bg-white/80 active:scale-95 active:bg-primary/15"
    >
      {children}
    </button>
  );
}
