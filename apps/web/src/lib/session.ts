import { create } from "zustand";
import type { MeDto, SessionResponse } from "@voidex/shared";
import { useI18n } from "./i18n";

export type SignedOutReason = "expired" | "revoked" | "signed_out" | null;

interface SessionState {
  status: "booting" | "signedOut" | "signedIn";
  accessToken: string | null;
  accessTokenExpiresAt: number;
  sessionId: string | null;
  user: MeDto | null;
  signedOutReason: SignedOutReason;
  setSession: (s: SessionResponse) => void;
  setUser: (user: MeDto) => void;
  signOutLocal: (reason: SignedOutReason) => void;
}

const HAD_SESSION = "vx.hadSession";

/**
 * In-memory session. The access token never touches storage; the refresh
 * token lives in an httpOnly cookie the page cannot read. Only a boolean
 * "this device had a session" hint is persisted, to word the sign-in screen.
 */
export const useSession = create<SessionState>((set) => ({
  status: "booting",
  accessToken: null,
  accessTokenExpiresAt: 0,
  sessionId: null,
  user: null,
  signedOutReason: null,
  setSession: (s) => {
    try {
      localStorage.setItem(HAD_SESSION, "1");
    } catch {
      /* ignore */
    }
    useI18n.getState().setLanguage(s.user.language);
    set({
      status: "signedIn",
      accessToken: s.accessToken,
      accessTokenExpiresAt: new Date(s.accessTokenExpiresAt).getTime(),
      sessionId: s.sessionId,
      user: s.user,
      signedOutReason: null,
    });
  },
  setUser: (user) => {
    if (useI18n.getState().language !== user.language) useI18n.getState().setLanguage(user.language);
    set({ user });
  },
  signOutLocal: (reason) => {
    try {
      if (reason === "signed_out") localStorage.removeItem(HAD_SESSION);
    } catch {
      /* ignore */
    }
    set({ status: "signedOut", accessToken: null, accessTokenExpiresAt: 0, sessionId: null, user: null, signedOutReason: reason });
  },
}));

export function deviceHadSession() {
  try {
    return localStorage.getItem(HAD_SESSION) === "1";
  } catch {
    return false;
  }
}
