import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { App } from "./app";
import "./styles/index.css";
import { applyStoredTheme } from "@/lib/theme";
import { trackKeyboard } from "@/lib/keyboard";

applyStoredTheme();
trackKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// A1: the bundle runs — the boot guard (public/boot-guard.js) must not show its fallback.
(window as unknown as { __vxBoot?: { dismiss?: () => void; ok?: boolean } }).__vxBoot?.dismiss?.();
