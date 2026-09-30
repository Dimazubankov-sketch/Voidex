import type { Config } from "../../config.js";
import { OtpComSmsProvider } from "./otpcom.js";
import { SmsAeroProvider } from "./smsaero.js";
import { SmsDeliveryError, type OtpLog, type SmsProvider } from "./types.js";

export * from "./types.js";
export { OtpComSmsProvider, OtpProviderError, type OtpProviderErrorKind } from "./otpcom.js";
export { SmsAeroProvider, SmsAeroError, type SmsAeroErrorKind } from "./smsaero.js";

/**
 * Development provider: writes the message to the server log. The API also
 * returns the code to the client (flagged as dev) so the flow can be tested
 * without a gateway. `loadConfig` refuses this provider in production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  readonly isDevelopment = true;
  readonly enabled = true;
  readonly outbox: { to: string; text: string; at: Date }[] = [];
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async send(to: string, text: string) {
    this.outbox.push({ to, text, at: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    this.log(`[sms:dev] to=${to} text=${JSON.stringify(text)}`);
  }
}

/** Twilio Programmable Messaging (global). */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  readonly isDevelopment = false;
  readonly enabled = true;
  constructor(private readonly cfg: { accountSid: string; authToken: string; from: string }) {}
  async send(to: string, text: string) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: this.cfg.from, Body: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new SmsDeliveryError(`Twilio responded ${res.status}`);
  }
}

/** SMS.ru (Russia / CIS). */
export class SmsRuProvider implements SmsProvider {
  readonly name = "smsru";
  readonly isDevelopment = false;
  readonly enabled = true;
  constructor(private readonly cfg: { apiId: string }) {}
  async send(to: string, text: string) {
    const res = await fetch("https://sms.ru/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_id: this.cfg.apiId, to: to.replace(/^\+/, ""), msg: text, json: "1" }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { status?: string; sms?: Record<string, { status?: string }> } | null;
    const perNumber = json?.sms ? Object.values(json.sms)[0] : undefined;
    if (!res.ok || json?.status !== "OK" || perNumber?.status !== "OK") {
      throw new SmsDeliveryError(`SMS.ru rejected the message (${res.status})`);
    }
  }
}

/**
 * Production without an SMS gateway. Nothing is ever "sent" and no code is
 * ever issued; VerificationService refuses before creating a code.
 */
export class DisabledSmsProvider implements SmsProvider {
  readonly name = "disabled";
  readonly isDevelopment = false;
  readonly enabled = false;
  async send(): Promise<void> {
    throw new SmsDeliveryError("SMS delivery is not configured.");
  }
}

export function createSmsProvider(config: Config, log?: OtpLog): SmsProvider {
  switch (config.sms.provider) {
    case "otpcom":
      return new OtpComSmsProvider({ apiKey: config.sms.otpcom.apiKey as string, log });
    case "smsaero":
      return new SmsAeroProvider({ ...(config.sms.smsaero as { email: string; apiKey: string; sign: string }), log });
    case "twilio":
      return new TwilioSmsProvider(config.sms.twilio as { accountSid: string; authToken: string; from: string });
    case "smsru":
      return new SmsRuProvider(config.sms.smsru as { apiId: string });
    case "console":
      return new ConsoleSmsProvider(log && ((m) => log.warn({}, m)));
    case "disabled":
      return new DisabledSmsProvider();
  }
}
