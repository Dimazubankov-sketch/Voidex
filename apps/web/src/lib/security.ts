import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import type { SecurityStatusDto } from "@voidex/shared";
import { api } from "./api";
import { qk, queryClient } from "./query";
import { useSession } from "./session";

/** Code-password / Face ID / auto-lock state of this account and device. */
export function useSecurityStatus(enabled = true) {
  const locked = useSession((s) => s.locked);
  return useQuery({
    queryKey: qk.security,
    queryFn: () => api.get<SecurityStatusDto>("/api/security/status"),
    enabled: enabled && !locked,
    staleTime: 15_000,
  });
}

export const setSecurityStatus = (s: SecurityStatusDto) => queryClient.setQueryData(qk.security, s);

// ---------------------------------------------------------------------------
// Step-up: "confirm it's you" with the code-password or Face ID before
// sensitive sections and changes. The server enforces it (403
// step_up_required); this only asks at the right moment.

interface StepUpState {
  open: boolean;
  waiters: ((ok: boolean) => void)[];
  finish: (ok: boolean) => void;
}

export const useStepUp = create<StepUpState>((set, get) => ({
  open: false,
  waiters: [],
  finish: (ok) => {
    const waiters = get().waiters;
    set({ open: false, waiters: [] });
    for (const w of waiters) w(ok);
  },
}));

/** Opens the confirmation (one sheet even if several requests ask at once). Resolves true once confirmed. */
export function requestStepUp(): Promise<boolean> {
  return new Promise((resolve) => useStepUp.setState((s) => ({ open: true, waiters: [...s.waiters, resolve] })));
}

/** Is a fresh confirmation needed right now? (No passcode → never.) */
export function stepUpNeeded(s: SecurityStatusDto | undefined) {
  if (!s?.passcodeEnabled) return false;
  return !s.stepUpUntil || new Date(s.stepUpUntil).getTime() - Date.now() < 5_000;
}

/** Before opening a sensitive section: confirm if needed. Resolves false if the person cancelled. */
export async function ensureStepUp(): Promise<boolean> {
  const status = await queryClient.fetchQuery({ queryKey: qk.security, queryFn: () => api.get<SecurityStatusDto>("/api/security/status"), staleTime: 0 });
  if (!stepUpNeeded(status)) return true;
  return requestStepUp();
}
