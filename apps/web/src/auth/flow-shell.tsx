import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cx } from "@/lib/cx";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The white working surface on the grey desk that hosts every step-by-step
 * flow (welcome, sign-up, sign-in, recovery). The surface stays put; steps
 * slide inside it, and the navigation buttons stay anchored at the bottom.
 */
export function FlowShell({ children, footer, header }: { children: ReactNode; footer?: ReactNode; header?: ReactNode }) {
  return (
    <div className="flex h-dvh w-full items-stretch justify-center bg-background p-2.5 pt-[max(var(--safe-top),10px)] pb-[max(var(--safe-bottom),10px)] sm:items-center sm:p-6">
      {/* soft brand light behind the surface */}
      <div aria-hidden className="pointer-events-none fixed left-1/2 top-[-18%] h-[60vh] w-[80vw] max-w-[760px] -translate-x-1/2 rounded-full bg-primary/12 blur-[110px]" />
      <div className="relative flex w-full max-w-[540px] flex-col overflow-hidden rounded-[30px] bg-surface shadow-surface sm:h-[min(760px,92dvh)]">
        <div aria-hidden className="absolute inset-x-16 top-0 h-[3px] rounded-b-full bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-glow" />
        {header}
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
        {footer}
      </div>
    </div>
  );
}

/** Slides steps horizontally: forward = old leaves left, new enters right; back = reverse. */
export function StepStage({ stepKey, direction, children }: { stepKey: string; direction: 1 | -1; children: ReactNode }) {
  return (
    <AnimatePresence initial={false} custom={direction} mode="popLayout">
      <motion.div
        key={stepKey}
        custom={direction}
        className="absolute inset-0 flex flex-col"
        variants={{
          enter: (d: number) => ({ x: `${d * 100}%`, opacity: 0.4 }),
          center: { x: "0%", opacity: 1 },
          exit: (d: number) => ({ x: `${d * -100}%`, opacity: 0.4 }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.38, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Scrollable step body with the title block. */
export function StepBody({ title, subtitle, children, className, icon }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cx("scroll-area flex-1 px-6 pb-6 pt-8 sm:px-10 sm:pt-12", className)}>
      {icon && <div className="mb-5">{icon}</div>}
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-text sm:text-[30px]">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">{subtitle}</p>}
      <div className="mt-7">{children}</div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-5 sm:px-10 sm:pt-7">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-secondary">
        <motion.div className="h-full rounded-full brand-gradient" animate={{ width: `${Math.round(value * 100)}%` }} transition={{ duration: 0.4, ease: EASE }} />
      </div>
      {label && <div className="shrink-0 text-[12px] font-medium tabular-nums text-text-tertiary">{label}</div>}
    </div>
  );
}

/** Bottom navigation bar: ← on the left, the big → on the right. */
export function FlowFooter({ left, right, center }: { left?: ReactNode; right?: ReactNode; center?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-5 pt-3 sm:px-8 sm:pb-7">
      <div className="flex min-w-14 justify-start">{left}</div>
      <div className="flex min-w-0 flex-1 justify-center">{center}</div>
      <div className="flex min-w-16 justify-end">{right}</div>
    </div>
  );
}
