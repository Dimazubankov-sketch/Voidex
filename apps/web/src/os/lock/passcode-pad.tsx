import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { RiDeleteBack2Line } from "@remixicon/react";
import { PASSCODE_LENGTH } from "@voidex/shared";
import { cx } from "@/lib/cx";
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
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const codeRef = useRef(code);
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

  return (
    <div className="flex w-full flex-col items-center" data-testid={testId}>
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
