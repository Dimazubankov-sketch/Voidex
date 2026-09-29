/**
 * SMS delivery abstraction. The verification service never talks to a vendor
 * directly — swapping one gateway for another means one new class.
 *
 * Two kinds of gateway:
 *  • message gateways (Twilio, SMS.ru): VOIDEX makes the code, keeps its HMAC
 *    and asks the gateway to deliver a text (`send`);
 *  • hosted-OTP gateways (otp.com): the gateway makes, delivers and checks the
 *    code (`hosted`); VOIDEX keeps only the gateway's verification id.
 */
export interface SmsProvider {
  readonly name: string;
  /** True only for the development provider that does not really send anything. */
  readonly isDevelopment: boolean;
  /** False when no gateway is configured: verification must be refused, not faked. */
  readonly enabled: boolean;
  /** Present on gateways that generate and check the code themselves. */
  readonly hosted?: HostedOtp;
  send(toE164: string, text: string): Promise<void>;
}

export interface HostedOtpSent {
  /** The gateway's id for this verification (otp.com `otp_id`). */
  ref: string;
  channel: string;
  maskedRecipient: string;
}

export interface HostedOtpCheck {
  matched: boolean;
  /** Gateway status after the check: approved | pending | failed | expired. */
  status: string;
}

export interface HostedOtp {
  start(input: { to: string; clientIp: string | null; locale?: string; idempotencyKey: string }): Promise<HostedOtpSent>;
  check(ref: string, code: string): Promise<HostedOtpCheck>;
}

/** Structured logger (pino-compatible). Must never receive codes, keys or full numbers. */
export interface OtpLog {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export class SmsDeliveryError extends Error {}
