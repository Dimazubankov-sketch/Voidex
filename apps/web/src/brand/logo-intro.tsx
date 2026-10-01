import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { VoidexMark } from "./brand";

const EASE = [0.22, 1, 0.36, 1] as const;
/** Total time on screen — short on purpose: a signature, not a splash screen. */
const DURATION_MS = 950;

/**
 * The VOIDEX logo intro: plays once per full page load (first visit or a
 * reload), never when apps open inside VOIDEX. It sits above whatever is
 * loading underneath and never delays it; with reduced motion it is skipped.
 */
export function LogoIntro() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(() => !reduce);
  useEffect(() => {
    if (!show) return;
    const id = window.setTimeout(() => setShow(false), DURATION_MS);
    return () => window.clearTimeout(id);
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="intro"
          className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
          aria-hidden
          data-testid="logo-intro"
          data-system-ui
        >
          <div className="relative flex flex-col items-center gap-4">
            <motion.div
              className="absolute left-1/2 top-[38%] size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25 blur-3xl"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0.7], scale: [0.6, 1.05, 1] }}
              transition={{ duration: 0.8, ease: EASE }}
            />
            <motion.div initial={{ opacity: 0, scale: 0.86, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
              <VoidexMark className="relative size-20" />
            </motion.div>
            <motion.span
              className="relative text-[15px] font-semibold text-text"
              initial={{ opacity: 0, letterSpacing: "0.5em" }}
              animate={{ opacity: 1, letterSpacing: "0.28em" }}
              transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
            >
              VOIDEX
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
