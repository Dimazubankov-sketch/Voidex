import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, rawPost } from "./api";

/**
 * Face ID in VOIDEX = WebAuthn with the device's own platform authenticator
 * and mandatory user verification. The device checks the face (or the
 * fingerprint / Windows Hello) itself and signs the server's challenge with a
 * key that never leaves it; VOIDEX never receives a picture or a template.
 * Where the browser has no such authenticator, Face ID is simply not offered —
 * the code-password always works.
 */

const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

export type FaceIdSupport = "available" | "no-authenticator" | "unsupported-browser" | "insecure-origin";

/** Can this browser on this device set up Face ID for VOIDEX? */
export async function faceIdSupport(): Promise<FaceIdSupport> {
  // WebAuthn needs a secure context on a domain (not a bare IP address).
  if (!window.isSecureContext || IP_HOST.test(window.location.hostname)) return "insecure-origin";
  if (!browserSupportsWebAuthn()) return "unsupported-browser";
  try {
    return (await platformAuthenticatorIsAvailable()) ? "available" : "no-authenticator";
  } catch {
    return "no-authenticator";
  }
}

/**
 * The system prompt ended without a result. Browsers deliberately report a
 * cancelled prompt and a failed face check the same way (NotAllowedError), so
 * VOIDEX can't tell them apart and says "not confirmed" for both.
 */
export function faceIdNotConfirmed(err: unknown) {
  if (err instanceof WebAuthnError) return err.code === "ERROR_CEREMONY_ABORTED" || (err.cause instanceof DOMException && err.cause.name === "NotAllowedError");
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
}

/** Sets up Face ID on this device (needs a recent confirmation — the API asks for it). */
export async function registerFaceId() {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>("/api/security/face-id/options");
  const response = await startRegistration({ optionsJSON: options });
  return api.post("/api/security/face-id", { response });
}

/** A signed assertion for the step-up confirmation (signed-in, unlocked session). */
export async function faceIdAssertion() {
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>("/api/security/step-up/options", {}, { noStepUp: true });
  return startAuthentication({ optionsJSON: options });
}

/** A signed assertion for the lock screen (the session is locked: refresh-cookie routes). */
export async function faceIdUnlockAssertion() {
  const options = await rawPost<PublicKeyCredentialRequestOptionsJSON>("/api/auth/lock/options");
  return startAuthentication({ optionsJSON: options });
}
