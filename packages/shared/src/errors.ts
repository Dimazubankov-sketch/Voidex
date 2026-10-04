/**
 * Stable, machine-readable error codes returned by the VOIDEX API.
 *
 * The server always answers errors with `{ error: { code, message, fields? } }`.
 * Clients translate `code` into a human message in the user's language; the
 * English `message` is a fallback for logs and non-localised clients.
 */
export const ErrorCode = {
  // generic
  ValidationFailed: "validation_failed",
  NotFound: "not_found",
  Internal: "internal_error",
  RateLimited: "rate_limited",
  ServiceUnavailable: "service_unavailable",
  Forbidden: "forbidden",

  // auth / session
  Unauthenticated: "unauthenticated",
  SessionExpired: "session_expired",
  SessionRevoked: "session_revoked",
  InvalidCredentials: "invalid_credentials",
  AccountLocked: "account_locked",
  RefreshRace: "refresh_race",
  CsrfFailed: "csrf_failed",
  ReauthRequired: "reauth_required",
  WrongPassword: "wrong_password",

  // Step 2.4: lock screen, code-password, Face ID (WebAuthn)
  SessionLocked: "session_locked",
  StepUpRequired: "step_up_required",
  PasscodeInvalid: "passcode_invalid",
  PasscodeLocked: "passcode_locked",
  PasscodeNotSet: "passcode_not_set",
  FaceIdUnavailable: "face_id_unavailable",
  FaceIdFailed: "face_id_failed",

  // registration
  PhoneTaken: "phone_taken",
  UsernameTaken: "username_taken",
  UsernameReserved: "username_reserved",
  UsernameInvalid: "username_invalid",
  PhoneInvalid: "phone_invalid",
  BirthDateInvalid: "birth_date_invalid",
  TooYoung: "too_young",
  PasswordWeak: "password_weak",
  ConsentRequired: "consent_required",
  ConsentOutdated: "consent_outdated",
  PhoneNotVerified: "phone_not_verified",

  // verification / OTP
  CodeInvalid: "code_invalid",
  CodeExpired: "code_expired",
  CodeAttemptsExceeded: "code_attempts_exceeded",
  CodeResendTooSoon: "code_resend_too_soon",
  SmsNotConfigured: "sms_not_configured",
  SmsSendFailed: "sms_send_failed",
  SmsCountryUnsupported: "sms_country_unsupported",
  SmsNetworkBlocked: "sms_network_blocked",

  // challenges (new device / recovery)
  ChallengeInvalid: "challenge_invalid",
  ChallengeExpired: "challenge_expired",
  ChallengePending: "challenge_pending",
  ChallengeDenied: "challenge_denied",
  NoTrustedDevice: "no_trusted_device",
  AccountNotFound: "account_not_found",

  // mail
  RecipientNotFound: "recipient_not_found",
  RecipientExternal: "recipient_external",
  NoRecipients: "no_recipients",
  MessageTooLarge: "message_too_large",
  DraftAlreadySent: "draft_already_sent",
  AttachmentTooLarge: "attachment_too_large",
  AttachmentTypeNotAllowed: "attachment_type_not_allowed",
  AttachmentLimit: "attachment_limit",

  // vibex
  VibexNotActivated: "vibex_not_activated",
  VibexOtherAccount: "vibex_other_account",

  // notes (Step 2.5)
  /** The document changed on another device since this one loaded it. */
  NotesConflict: "notes_conflict",
  NotesTooLarge: "notes_too_large",

  // apps
  AppNotInRegistry: "app_not_in_registry",
  AppNotRemovable: "app_not_removable",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Per-field error codes for form validation. */
    fields?: Record<string, string>;
    /** Extra machine-readable details (e.g. retryAfterSeconds, suggestions). */
    details?: Record<string, unknown>;
  };
}
