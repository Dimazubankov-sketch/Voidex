import { ErrorCode } from "@voidex/shared";

const STATUS: Partial<Record<ErrorCode, number>> = {
  [ErrorCode.ValidationFailed]: 400,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.RateLimited]: 429,
  [ErrorCode.ServiceUnavailable]: 503,
  [ErrorCode.Forbidden]: 403,
  [ErrorCode.Unauthenticated]: 401,
  [ErrorCode.SessionExpired]: 401,
  [ErrorCode.SessionRevoked]: 401,
  [ErrorCode.InvalidCredentials]: 401,
  [ErrorCode.AccountLocked]: 429,
  [ErrorCode.RefreshRace]: 409,
  [ErrorCode.CsrfFailed]: 403,
  [ErrorCode.ReauthRequired]: 403,
  [ErrorCode.WrongPassword]: 403,
  [ErrorCode.PhoneTaken]: 409,
  [ErrorCode.UsernameTaken]: 409,
  [ErrorCode.CodeResendTooSoon]: 429,
  [ErrorCode.CodeAttemptsExceeded]: 429,
  [ErrorCode.SmsNotConfigured]: 503,
  [ErrorCode.SmsSendFailed]: 502,
  [ErrorCode.SmsCountryUnsupported]: 422,
  [ErrorCode.SmsNetworkBlocked]: 403,
  [ErrorCode.ChallengePending]: 409,
  [ErrorCode.ChallengeDenied]: 403,
  [ErrorCode.ChallengeExpired]: 410,
  [ErrorCode.CodeExpired]: 410,
  [ErrorCode.AccountNotFound]: 404,
  [ErrorCode.RecipientNotFound]: 422,
  [ErrorCode.RecipientExternal]: 422,
  [ErrorCode.NoRecipients]: 422,
  [ErrorCode.DraftAlreadySent]: 409,
  [ErrorCode.AppNotInRegistry]: 404,
  [ErrorCode.AppNotRemovable]: 403,
};

/** An error that is safe to show to the client. Anything else becomes a 500. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: { status?: number; fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.status = options.status ?? STATUS[code] ?? 400;
  }
}

export const fail = (code: ErrorCode, message: string, options?: AppError["options"]) =>
  new AppError(code, message, options);

export const validationError = (fields: Record<string, string>, message = "Some fields are invalid.") =>
  new AppError(ErrorCode.ValidationFailed, message, { fields });

export const notFound = (what = "Resource") => new AppError(ErrorCode.NotFound, `${what} not found.`);
