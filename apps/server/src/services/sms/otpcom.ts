import { isIP, isIPv4 } from "node:net";
import { maskPhone } from "@voidex/shared/phone";
import { SmsDeliveryError, type HostedOtp, type HostedOtpCheck, type HostedOtpSent, type OtpLog, type SmsProvider } from "./types.js";

/**
 * otp.com (https://www.otp.com/docs): generates, delivers and checks the code
 * itself. VOIDEX never sees the code; it keeps only otp.com's `otp_id`.
 *
 * The delivery channel is chosen by the routing configured in the otp.com
 * dashboard (SMS for VOIDEX) — the API deliberately has no channel parameter.
 * The API key is a server key (`otp_live_…`): it is only ever placed in the
 * Authorization header and never logged or returned.
 */

export const OTPCOM_API_BASE = "https://api.otp.com/api/v1";
const TIMEOUT_MS = 10_000;

/** Why a call to otp.com failed — mapped to user-facing errors by VerificationService. */
export type OtpProviderErrorKind =
  | "invalid_recipient" // 422 InvalidRecipientError, or not E.164
  | "geo_blocked" // 403 GeoBlockedError
  | "ip_blocked" // 403 IpReputationBlockedError (VPN / proxy / abusive IP)
  | "insufficient_funds" // 402
  | "unauthorized" // 401: key missing, invalid or revoked
  | "rate_limited" // 429 RateLimitExceededError / ResendCooldownError
  | "not_found" // 404: otp_id unknown
  | "resend_not_allowed" // 409: no further channel
  | "unsupported_channel" // routing picked a click-to-chat channel (WhatsApp link)
  | "bad_request" // other 4xx
  | "unavailable" // 5xx or malformed response
  | "timeout"
  | "network";

export class OtpProviderError extends SmsDeliveryError {
  constructor(
    readonly kind: OtpProviderErrorKind,
    readonly info: { status?: number; type?: string; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(`otp.com: ${kind}${info.status ? ` (${info.status}${info.type ? ` ${info.type}` : ""})` : ""}`);
  }
  /** Transient failures that may be retried — for send only with the same idempotency key. */
  get retryable() {
    return this.kind === "timeout" || this.kind === "network" || this.kind === "unavailable";
  }
}

export interface OtpComOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  log?: OtpLog;
  /** Pause before the single retry of a send (tests use 0). */
  retryDelayMs?: number;
}

interface SendResponse {
  otp_id?: unknown;
  status?: unknown;
  channel?: unknown;
  masked_recipient?: unknown;
  action_url?: unknown;
}
interface VerifyResponse {
  otp_id?: unknown;
  status?: unknown;
  matched?: unknown;
}
interface StatusResponse {
  otp_id?: unknown;
  status?: unknown;
  masked_recipient?: unknown;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** The end user's address as otp.com expects it, or undefined when unusable. */
export function publicClientIp(ip: string | null | undefined): string | undefined {
  if (!ip) return undefined;
  const v = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  return isIP(v) ? v : undefined;
}

/** otp.com error messages may quote the recipient: never let a full number reach the logs. */
function scrub(text: unknown): string | undefined {
  if (typeof text !== "string" || !text) return undefined;
  return text.replace(/\+?\d[\d\s()-]{5,}\d/g, "[number]").slice(0, 300);
}

function kindFor(status: number, type: string | undefined): OtpProviderErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 402) return "insufficient_funds";
  if (status === 403) return type === "GeoBlockedError" ? "geo_blocked" : type === "IpReputationBlockedError" ? "ip_blocked" : "bad_request";
  if (status === 404) return "not_found";
  if (status === 409) return "resend_not_allowed";
  if (status === 422 && type === "InvalidRecipientError") return "invalid_recipient";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

export class OtpComSmsProvider implements SmsProvider, HostedOtp {
  readonly name = "otpcom";
  readonly isDevelopment = false;
  readonly enabled = true;
  readonly hosted: HostedOtp = this;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;
  private readonly log?: OtpLog;
  readonly #apiKey: string;

  constructor(opts: OtpComOptions) {
    this.#apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? OTPCOM_API_BASE).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.fetchImpl = opts.fetch ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
    this.log = opts.log;
  }

  /** otp.com writes its own message; free-text delivery is not part of its API. */
  async send(): Promise<void> {
    throw new SmsDeliveryError("otp.com generates and delivers its own codes; use start().");
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: object, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      throw new OtpProviderError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }
    const json = (await res.json().catch(() => null)) as ({ error?: { type?: unknown; message?: unknown } } & T) | null;
    if (res.ok) {
      if (!json || typeof json !== "object") throw new OtpProviderError("unavailable", { status: res.status, detail: "response is not JSON" });
      return json;
    }
    const type = typeof json?.error?.type === "string" ? json.error.type : undefined;
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new OtpProviderError(kindFor(res.status, type), {
      status: res.status,
      type,
      detail: scrub(json?.error?.message),
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
    });
  }

  private report(op: string, err: OtpProviderError, extra: Record<string, unknown>) {
    const level = err.kind === "invalid_recipient" || err.kind === "rate_limited" || err.kind === "ip_blocked" ? "warn" : "error";
    this.log?.[level](
      { provider: "otpcom", op, kind: err.kind, status: err.info.status, type: err.info.type, detail: err.info.detail, ...extra },
      `otp.com ${op} failed: ${err.kind}`,
    );
  }

  /**
   * POST /otp/send. `idempotencyKey` is unique per VOIDEX verification, so the
   * one retry after a timeout / 5xx replays the first send instead of texting
   * the user a second code.
   */
  async start(input: { to: string; clientIp: string | null; locale?: string; idempotencyKey: string }): Promise<HostedOtpSent> {
    const masked = maskPhone(input.to);
    if (!E164.test(input.to)) {
      const err = new OtpProviderError("invalid_recipient", { detail: "not an E.164 number" });
      this.report("send", err, { recipient: masked });
      throw err;
    }
    const clientIp = publicClientIp(input.clientIp);
    const locale = input.locale && /^[a-z]{2}$/.test(input.locale) ? input.locale : undefined;
    const body = { recipient: input.to, ...(locale ? { locale } : {}), ...(clientIp ? { client_ip: clientIp } : {}) };
    const headers = { "idempotency-key": input.idempotencyKey.slice(0, 128) };

    let res: SendResponse | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await this.call<SendResponse>("POST", "/otp/send", body, headers);
        break;
      } catch (err) {
        if (err instanceof OtpProviderError && err.retryable && attempt < 2) {
          this.log?.warn({ provider: "otpcom", op: "send", kind: err.kind, recipient: masked }, "otp.com send: retrying once with the same idempotency key");
          if (this.retryDelayMs) await new Promise((r) => setTimeout(r, this.retryDelayMs));
          continue;
        }
        if (err instanceof OtpProviderError) this.report("send", err, { recipient: masked, clientIp: !!clientIp });
        throw err;
      }
    }

    if (typeof res.otp_id !== "string" || !res.otp_id) {
      const err = new OtpProviderError("unavailable", { detail: "response has no otp_id" });
      this.report("send", err, { recipient: masked });
      throw err;
    }
    const channel = typeof res.channel === "string" ? res.channel : "unknown";
    const maskedRecipient = typeof res.masked_recipient === "string" ? res.masked_recipient : masked;
    if (typeof res.action_url === "string" && res.action_url) {
      // WhatsApp click-to-chat: nothing was delivered, the user would have to open a link.
      const err = new OtpProviderError("unsupported_channel", { detail: `routing chose ${channel}; put SMS first in the otp.com app routing` });
      this.report("send", err, { recipient: maskedRecipient, otpId: res.otp_id, channel });
      throw err;
    }
    this.log?.info({ provider: "otpcom", op: "send", otpId: res.otp_id, channel, recipient: maskedRecipient, clientIp: !!clientIp }, "otp.com: code sent");
    return { ref: res.otp_id, channel, maskedRecipient };
  }

  /** POST /otp/verify. Never retried: a repeated wrong code would burn two attempts. */
  async check(ref: string, code: string): Promise<HostedOtpCheck> {
    let res: VerifyResponse;
    try {
      res = await this.call<VerifyResponse>("POST", "/otp/verify", { otp_id: ref, code });
    } catch (err) {
      if (err instanceof OtpProviderError) this.report("verify", err, { otpId: ref });
      throw err;
    }
    const matched = res.matched === true;
    const status = typeof res.status === "string" ? res.status : "unknown";
    this.log?.info({ provider: "otpcom", op: "verify", otpId: ref, matched, status }, "otp.com: code checked");
    return { matched, status };
  }

  /** POST /otp/resend: moves the OTP to the next channel in the app's routing. */
  async resend(ref: string, channel?: "sms" | "whatsapp" | "telegram" | "email"): Promise<HostedOtpSent> {
    try {
      const res = await this.call<SendResponse>("POST", "/otp/resend", { otp_id: ref, ...(channel ? { channel } : {}) });
      return {
        ref: typeof res.otp_id === "string" ? res.otp_id : ref,
        channel: typeof res.channel === "string" ? res.channel : "unknown",
        maskedRecipient: typeof res.masked_recipient === "string" ? res.masked_recipient : "",
      };
    } catch (err) {
      if (err instanceof OtpProviderError) this.report("resend", err, { otpId: ref });
      throw err;
    }
  }

  /** GET /otp/{otp_id}: pending | approved | failed | expired. */
  async status(ref: string): Promise<string> {
    const res = await this.call<StatusResponse>("GET", `/otp/${encodeURIComponent(ref)}`);
    return typeof res.status === "string" ? res.status : "unknown";
  }

  /**
   * Startup self-check that costs nothing and sends nothing: looks up an OTP id
   * that cannot exist. 404 = the key is accepted; 401 = missing/invalid/revoked.
   */
  async probe(): Promise<"ok" | "unauthorized" | "unreachable"> {
    try {
      await this.status("00000000-0000-4000-8000-000000000000");
      return "ok";
    } catch (err) {
      if (err instanceof OtpProviderError && err.kind === "not_found") return "ok";
      if (err instanceof OtpProviderError && err.kind === "unauthorized") return "unauthorized";
      return "unreachable";
    }
  }
}
