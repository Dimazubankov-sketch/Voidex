import { useEffect, useRef, useState } from "react";
import { RiFileList3Line } from "@remixicon/react";
import { mountCalculator, type CalculatorController } from "@voidex/calculator/voidex";
import { APP_REGISTRY } from "@voidex/shared";
import { CalculatorGlyph } from "@/brand/brand";
import { useI18n, useT } from "@/lib/i18n";
import { IconButton } from "@/ui/controls";
import { WindowHeader, useWindow } from "@/os/window-context";

/** Below this width the step-by-step solution is a panel over the keypad (same breakpoint as the app's CSS). */
const NARROW = 680;
const OCR_BASE = `${import.meta.env.BASE_URL}apps/calculator/ocr/`;

/**
 * VOIDEX Calculator — the Voidex-Calculator app (packages/calculator) running
 * natively in a VOIDEX window: no iframe, its DOM is mounted into this
 * component and torn down with it. This whole module is a lazy chunk (with
 * KaTeX and mathjs); the OCR runtime loads only when a photo is recognised.
 */
export function CalculatorApp() {
  const t = useT();
  const win = useWindow();
  const language = useI18n((s) => s.language);
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<CalculatorController | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);

  useEffect(() => {
    const el = host.current!;
    const c = mountCalculator(el, { ocrBase: OCR_BASE, onSolutionToggle: setSolutionOpen });
    ctl.current = c;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.destroy();
      ctl.current = null;
    };
  }, []);

  // The focused window gets the keyboard (digits, Enter, Esc, Backspace).
  useEffect(() => {
    if (win.focused && win.formFactor === "desktop") ctl.current?.focus();
  }, [win.focused, win.formFactor]);

  return (
    <div className="vx-app-bg flex min-h-0 flex-1 flex-col" data-testid="calculator-app">
      <WindowHeader
        right={
          // Step 2.8: no History / "how to type" buttons in the title bar.
          narrow && (
            <IconButton label={t("calc.solution")} active={solutionOpen} onClick={() => ctl.current?.toggleSolution()} data-testid="calc-solution-toggle">
              <RiFileList3Line className="size-5" />
            </IconButton>
          )
        }
      >
        <span className="flex min-w-0 items-center gap-2 pl-1.5">
          <CalculatorGlyph className="size-6 shrink-0" />
          <span className="truncate text-[15px] font-semibold">{APP_REGISTRY.calculator.name[language]}</span>
        </span>
      </WindowHeader>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
