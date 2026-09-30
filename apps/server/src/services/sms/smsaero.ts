import { maskPhone } from "@voidex/shared/phone";
import { SmsDeliveryError, type OtpLog, type SmsProvider } from "./types.js";

/**
 * SMS Aero (https://smsaero.ru/integration/documentation/api/), API v2.
 *
 * A plain delivery gateway: VOIDEX makes the code, keeps its HMAC and checks
 * it; SMS Aero only carries the text. `POST /v2/sms/send` with a JSON body
 * (number, sign, text) and HTTP Basic auth — login = account email, password =
 * API key — as in the official clients. Success is `{"success": true, ...}`.
 *
 * Never logged: the API key, the message text (it contains the code) and the
 * full phone number.
 */

/**
 * Default gateway. gate.smsaero.org / gate.smsaero.net are the official API v2
 * gateways (the official clients list .ru/.org/.net); gate.smsaero.ru does not
 * complete a TLS handshake from the production server, so it is not the default.
 * Override with SMS_AERO_API_BASE. There is deliberately no automatic failover:
 * a hidden retry on another gateway could send the same SMS twice.
 */
export const SMSAERO_API_BASE = "https://gate.smsaero.org/v2";
const TIMEOUT_MS = 10_000;

export type SmsAeroErrorKind =
  | "invalid_number" // not E.164, or 400 "number: incorrect"
  | "unauthorized" // 401: wrong email / API key
  | "no_money" // 402 Not enough money
  | "ip_not_allowed" // 404 Invalid ip-address (IP allow-list in the cabinet)
  | "validation" // other 400 (e.g. sign or text rejected)
  | "rejected" // accepted by HTTP but success=false, or message status "reject"/"undelivered"
  | "rate_limited" // 429
  | "unavailable" // 5xx
  | "bad_response" // 2xx that is not the documented JSON
  | "timeout"
  | "network";

export class SmsAeroError extends SmsDeliveryError {
  constructor(
    readonly kind: SmsAeroErrorKind,
    readonly info: { status?: number; detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(`SMS Aero: ${kind}${info.status ? ` (${info.status})` : ""}`);
  }
}

export interface SmsAeroOptions {
  email: string;
  apiKey: string;
  /** Sender name approved in the SMS Aero cabinet ("SMS Aero" is the shared test name). */
  sign: string;
  /** API v2 base, e.g. https://gate.smsaero.org/v2 (SMS_AERO_API_BASE). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  log?: OtpLog;
}

interface SmsAeroMessage {
  id?: unknown;
  status?: unknown;
  extendStatus?: unknown;
  channel?: unknown;
}
interface SmsAeroResponse {
  success?: unknown;
  data?: unknown;
  message?: unknown;
  result?: unknown;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** API messages may quote the number: never let digits runs reach the logs. */
function scrub(text: unknown): string | undefined {
  if (typeof text !== "string" || !text) return undefined;
  return text.replace(/\+?\d[\d\s()-]{5,}\d/g, "[number]").slice(0, 300);
}

/** Pulls the error text out of any documented error shape without echoing data. */
function errorText(json: SmsAeroResponse | null): string | undefined {
  if (!json) return undefined;
  const parts: string[] = [];
  if (typeof json.message === "string") parts.push(json.message);
  if (typeof json.result === "string") parts.push(json.result);
  // Validation errors: { data: { number: ["incorrect"] } } — keep only field names and messages.
  if (json.data && typeof json.data === "object" && !Array.isArray(json.data)) {
    for (const [field, v] of Object.entries(json.data as Record<string, unknown>)) {
      if (["id", "text", "number", "from", "cost"].includes(field) && !Array.isArray(v)) continue;
      const msgs = Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" ? [v] : [];
      if (msgs.length) parts.push(`${field}: ${msgs.join(", ")}`);
    }
  }
  return scrub(parts.join("; "));
}

export class SmsAeroProvider implements SmsProvider {
  readonly name = "smsaero";
  readonly isDevelopment = false;
  readonly enabled = true;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sign: string;
  private readonly log?: OtpLog;
  readonly #authorization: string;

  constructor(opts: SmsAeroOptions) {
    this.#authorization = `Basic ${Buffer.from(`${opts.email}:${opts.apiKey}`).toString("base64")}`;
    this.sign = opts.sign;
    this.baseUrl = (opts.baseUrl ?? SMSAERO_API_BASE).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.fetchImpl = opts.fetch ?? fetch;
    this.log = opts.log;
  }

  private fail(err: SmsAeroError, recipient: string): never {
    const quiet = err.kind === "invalid_number" || err.kind === "rate_limited";
    this.log?.[quiet ? "warn" : "error"](
      { provider: "smsaero", op: "send", kind: err.kind, status: err.info.status, detail: err.info.detail, recipient },
      `SMS Aero send failed: ${err.kind}`,
    );
    throw err;
  }

  /**
   * One attempt only: SMS Aero has no idempotency key, so retrying after a
   * timeout could text the user a second code. VerificationService's
   * cooldown and hourly limit apply before this is ever called.
   */
  async send(toE164: string, text: string): Promise<void> {
    const recipient = maskPhone(toE164);
    if (!E164.test(toE164)) this.fail(new SmsAeroError("invalid_number", { detail: "not an E.164 number" }), recipient);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/sms/send`, {
        method: "POST",
        headers: { Authorization: this.#authorization, Accept: "application/json", "Content-Type": "application/json" },
        // SMS Aero takes the number as digits without "+": +79161234567 → 79161234567.
        body: JSON.stringify({ number: toE164.slice(1), sign: this.sign, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      this.fail(new SmsAeroError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network"), recipient);
    }

    const json = (await res.json().catch(() => null)) as SmsAeroResponse | null;
    const detail = errorText(json);

    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const kind: SmsAeroErrorKind =
        res.status === 401 || res.status === 403
          ? "unauthorized"
          : res.status === 402
            ? "no_money"
            : res.status === 429
              ? "rate_limited"
              : res.status >= 500
                ? "unavailable"
                : res.status === 404 && /ip/i.test(detail ?? "")
                  ? "ip_not_allowed"
                  : res.status === 400 && /number/i.test(detail ?? "")
                    ? "invalid_number"
                    : res.status === 400
                      ? "validation"
                      : "rejected";
      this.fail(
        new SmsAeroError(kind, {
          status: res.status,
          detail,
          retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
        }),
        recipient,
      );
    }

    if (!json || typeof json !== "object") this.fail(new SmsAeroError("bad_response", { status: res.status, detail: "response is not JSON" }), recipient);
    if (json.result === "no credits") this.fail(new SmsAeroError("no_money", { status: res.status, detail }), recipient);
    if (json.success !== true) this.fail(new SmsAeroError("rejected", { status: res.status, detail }), recipient);

    // Single send: data is the message object (some responses wrap it in a list).
    const msg = (Array.isArray(json.data) ? json.data[0] : json.data) as SmsAeroMessage | undefined;
    if (!msg || typeof msg !== "object" || (typeof msg.id !== "number" && typeof msg.id !== "string")) {
      this.fail(new SmsAeroError("bad_response", { status: res.status, detail: "no message id in response" }), recipient);
    }
    // Documented statuses: 0 queue, 1 delivery, 2 undelivered, 3 sent, 4 wait, 6 reject, 8 moderation.
    const status = Number(msg.status);
    const extendStatus = typeof msg.extendStatus === "string" ? msg.extendStatus : "unknown";
    if (status === 2 || status === 6) {
      this.fail(new SmsAeroError("rejected", { status: res.status, detail: `message ${extendStatus}` }), recipient);
    }
    const entry = { provider: "smsaero", op: "send", messageId: msg.id, status, extendStatus, channel: typeof msg.channel === "string" ? msg.channel : undefined, recipient };
    if (status === 8) this.log?.warn(entry, "SMS Aero: message accepted, waiting for manual moderation (may take 5–10 minutes)");
    else this.log?.info(entry, "SMS Aero: message accepted");
  }
}
