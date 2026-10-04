import { z } from "zod";
import type { Wallpaper } from "./workspace.js";

/**
 * Step 2.4 — lock screen, code-password and Face ID.
 *
 * - Code-password ("passcode"): 6 digits, stored only as a hash on the server,
 *   with an escalating lockout. It unlocks the lock screen and confirms
 *   sensitive changes (step-up).
 * - Face ID: WebAuthn with the device's own platform authenticator and
 *   mandatory user verification (Face ID / Touch ID on Apple devices, Windows
 *   Hello, fingerprint or face unlock on Android). VOIDEX never sees a face or
 *   a fingerprint: the device checks it and signs a challenge with a key that
 *   never leaves it; the server verifies the signature with the stored public
 *   key. It is bound to one device and always has the passcode as fallback.
 * - Lock: a locked session gets no API access until unlocked (server side).
 */
export const PASSCODE_LENGTH = 6;
export const PasscodeSchema = z.string().regex(/^\d{6}$/, "The code-password is 6 digits.");

/** Auto-lock after this many minutes without activity (0 = only on start / manually). */
export const AUTO_LOCK_OPTIONS = [0, 2, 5, 15, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];
export const DEFAULT_AUTO_LOCK: AutoLockMinutes = 5;

/** How long a confirmation (passcode / Face ID) opens sensitive sections and changes. */
export const STEP_UP_TTL_MS = 5 * 60_000;

export interface SecurityStatusDto {
  passcodeEnabled: boolean;
  /** First setup after registration: the passcode must be created before the desktop. */
  passcodeSetupRequired: boolean;
  /** Face ID is set up on this device. */
  faceIdOnThisDevice: boolean;
  /** Devices of this account with Face ID. */
  faceIdDevices: number;
  autoLockMinutes: AutoLockMinutes;
  /** Sensitive sections are open (a recent confirmation) until this moment. */
  stepUpUntil: string | null;
  /** Too many wrong codes: the passcode is blocked until this moment. */
  passcodeLockedUntil: string | null;
}

/** What the lock screen needs while the session is locked (no other API works then). */
export interface LockStateDto {
  locked: boolean;
  /** Face ID is set up on this device: offer it first. */
  faceId: boolean;
  passcodeLockedUntil: string | null;
  firstName: string;
  /** The lock-screen wallpaper (null: the same as the desktop's). */
  wallpaper: Wallpaper | null;
}

export const SetPasscodeSchema = z.object({ passcode: PasscodeSchema });
export const AutoLockSchema = z.object({
  minutes: z.number().refine((m): m is AutoLockMinutes => (AUTO_LOCK_OPTIONS as readonly number[]).includes(m), "Unsupported auto-lock interval."),
});
/** Unlock / step-up: the passcode or a WebAuthn assertion (JSON from the browser). */
export const VerifySchema = z.union([
  z.object({ passcode: PasscodeSchema }),
  z.object({ webauthn: z.record(z.string(), z.unknown()) }),
]);
export type VerifyInput = z.infer<typeof VerifySchema>;
export const FaceIdRegisterSchema = z.object({ response: z.record(z.string(), z.unknown()) });
