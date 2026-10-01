import { useMutation } from "@tanstack/react-query";
import type { MeDto, Preferences } from "@voidex/shared";
import { api } from "./api";
import { qk, queryClient } from "./query";
import { useSession } from "./session";
import { mergeServerUser } from "@/os/home/layout";

let signingOut = false;
/** True while this device is signing itself out (its own "revoked" event is expected). */
export const isSigningOut = () => signingOut;

/** Signs this device out (server revokes the session, cookie is cleared). */
export async function signOut() {
  signingOut = true;
  try {
    await api.post("/api/auth/logout");
  } finally {
    useSession.getState().signOutLocal("signed_out");
    signingOut = false;
  }
}

/** Signs out of VOIDEX everywhere, this device included. */
export async function signOutEverywhere() {
  signingOut = true;
  try {
    await api.post("/api/auth/logout-all");
    useSession.getState().signOutLocal("signed_out");
  } finally {
    signingOut = false;
  }
}

function applyMe(server: MeDto) {
  // A profile response must not undo a desktop edit that is still being saved.
  const me = mergeServerUser(server);
  useSession.getState().setUser(me);
  queryClient.setQueryData(qk.me, me);
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (patch: Partial<Pick<MeDto, "firstName" | "lastName" | "birthDate" | "country" | "language">>) =>
      api.patch<MeDto>("/api/account/profile", patch),
    onSuccess: applyMe,
  });
}

export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (patch: { notifications?: Partial<Preferences["notifications"]>; workspace?: Partial<Preferences["workspace"]> }) =>
      api.patch<Preferences>("/api/preferences", patch),
    onMutate: (patch) => {
      // Optimistic: toggles respond instantly, server confirms (and syncs other devices).
      const user = useSession.getState().user;
      if (!user) return;
      useSession.getState().setUser({
        ...user,
        preferences: {
          notifications: { ...user.preferences.notifications, ...patch.notifications },
          workspace: { ...user.preferences.workspace, ...patch.workspace },
        },
      });
      return { previous: user };
    },
    onError: (_e, _p, ctx) => ctx?.previous && useSession.getState().setUser(ctx.previous),
  });
}

export { applyMe };

/** Downscales an image to a square JPEG before upload (keeps avatars small). */
export async function prepareAvatar(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.88));
}
