import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { App } from "./app";
import "./styles/index.css";
import { applyStoredTheme } from "@/lib/theme";
import { trackKeyboard } from "@/lib/keyboard";
import { installZoomGuard } from "@/lib/zoom-guard";
import { bootFail, bootMark, reportClientEvent, safeInit, stripRecoveryParam } from "@/lib/boot";
import { registerServiceWorker } from "@/lib/sw-register";

bootMark("js");
stripRecoveryParam();

// Each step is independent: a failure in one (storage blocked, an old WebView missing an API) must not stop the shell.
safeInit("theme", applyStoredTheme);
safeInit("keyboard", trackKeyboard);
safeInit("zoom", installZoomGuard);

bootMark("render");
const rootEl = document.getElementById("root");
if (!rootEl) {
  bootFail("no-root");
} else {
  createRoot(rootEl, {
    // A crash that no error boundary caught: React unmounts everything. Say so instead of leaving a blank page.
    onUncaughtError: (error) => {
      reportClientEvent({ kind: "root_crashed", phase: "uncaught", detail: String((error as Error)?.message ?? error) });
      bootFail("react");
    },
  }).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
  // NOT marked as started here: the root component reports it from an effect, after the first commit.
  registerServiceWorker();
}
