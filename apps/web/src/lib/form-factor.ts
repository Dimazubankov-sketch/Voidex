import { useSyncExternalStore } from "react";

/**
 * Layout mode. Decided by the viewport and input, not the user agent:
 * a narrow window on a Mac gets the compact layout, an iPad in landscape the
 * desktop one. Desktop and mobile share the design system, not the layout.
 */
export type FormFactor = "mobile" | "desktop";

const query = "(min-width: 900px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(query);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function getFormFactor(): FormFactor {
  return typeof window !== "undefined" && window.matchMedia(query).matches ? "desktop" : "mobile";
}

export function useFormFactor(): FormFactor {
  return useSyncExternalStore(subscribe, getFormFactor, () => "desktop");
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(q);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
