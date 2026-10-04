import { useEffect } from "react";
import type { Theme } from "@voidex/shared";

/**
 * Step 2.5: the colour theme (Settings → Personalization). Stored with the
 * account (workspace appearance); the last one used is also kept on the
 * device so the lock screen and the first paint don't flash the other theme.
 * "system" follows the device (prefers-color-scheme) live.
 */
const KEY = "vx.theme";

function resolve(theme: Theme): "light" | "dark" {
  if (theme === "system") return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: Theme) {
  const mode = resolve(theme);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#121218" : "#ececed");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
}

/** Before React renders: the theme this device used last (light for everyone else). */
export function applyStoredTheme() {
  let theme: Theme = "light";
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "system" || v === "light") theme = v;
  } catch {
    /* default */
  }
  applyTheme(theme);
}

/** Keeps the document on the account's theme (and the device's, for "system"). */
export function useTheme(theme: Theme) {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("system");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [theme]);
}
