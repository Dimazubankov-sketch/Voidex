import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode, type MeDto, type SessionResponse } from "@voidex/shared";
import type { z } from "zod";
import type { Config } from "./config.js";
import { AppError, fail } from "./lib/errors.js";
import type { RequestMeta } from "./services/context.js";
import type { IssuedSession } from "./services/sessions.js";

export const REFRESH_COOKIE = "vx_rt";
export const DEVICE_COOKIE = "vx_did";
const AUTH_COOKIE_PATH = "/api/auth";

/** Validates input with a zod schema, mapping issues to per-field error codes. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.code === "invalid_type" && issue.input === undefined ? "required" : "invalid";
  }
  throw new AppError(ErrorCode.ValidationFailed, "Some fields are invalid.", { fields });
}

export function isNative(req: FastifyRequest) {
  return req.headers["x-voidex-client"] === "native";
}

export function requestMeta(req: FastifyRequest, deviceName?: string): RequestMeta {
  const native = isNative(req);
  const headerDevice = req.headers["x-voidex-device"];
  const deviceToken = native
    ? typeof headerDevice === "string" && headerDevice.length <= 200
      ? headerDevice
      : undefined
    : req.cookies[DEVICE_COOKIE];
  return {
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"],
    native,
    deviceName,
    deviceToken: deviceToken && /^[A-Za-z0-9_-]{20,200}$/.test(deviceToken) ? deviceToken : undefined,
  };
}

export function readRefreshToken(req: FastifyRequest): string | undefined {
  if (isNative(req)) {
    const h = req.headers["x-voidex-refresh"];
    return typeof h === "string" ? h : undefined;
  }
  return req.cookies[REFRESH_COOKIE];
}

function cookieBase(config: Config) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: "strict" as const, path: AUTH_COOKIE_PATH };
}

/**
 * Hands a new session to the client. Web: refresh + device secrets go into
 * httpOnly cookies scoped to /api/auth (never readable by page scripts).
 * Native shells: returned in the body for the OS secure storage.
 */
export function sendSession(
  req: FastifyRequest,
  reply: FastifyReply,
  config: Config,
  issued: Pick<IssuedSession, "accessToken" | "accessTokenExpiresAt" | "sessionId" | "refreshToken" | "absoluteExpiresAt"> & {
    deviceToken?: string;
  },
  user: MeDto,
): SessionResponse & { deviceToken?: string } {
  const native = isNative(req);
  if (!native) {
    reply.setCookie(REFRESH_COOKIE, issued.refreshToken, { ...cookieBase(config), expires: issued.absoluteExpiresAt });
    if (issued.deviceToken) {
      reply.setCookie(DEVICE_COOKIE, issued.deviceToken, { ...cookieBase(config), maxAge: 400 * 86_400 });
    }
  }
  return {
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    sessionId: issued.sessionId,
    user,
    ...(native ? { refreshToken: issued.refreshToken, deviceToken: issued.deviceToken } : {}),
  };
}

export function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(REFRESH_COOKIE, cookieBase(config));
}

/**
 * CSRF defence for state-changing requests. Cookies are SameSite=Strict, and
 * every mutating request must carry the custom `X-Voidex-Client` header —
 * which a cross-site form or image cannot send, and which forces a CORS
 * preflight that foreign origins fail. When an Origin header is present it
 * must be our own host or an explicitly allowed native origin.
 */
export function assertSameOrigin(req: FastifyRequest, config: Config) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const client = req.headers["x-voidex-client"];
  if (client !== "web" && client !== "native") {
    throw fail(ErrorCode.CsrfFailed, "Request blocked by CSRF protection.");
  }
  const origin = req.headers.origin;
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* invalid origin */
    }
    const ownHost = req.host;
    if (host !== ownHost && !config.allowedOrigins.includes(origin)) {
      throw fail(ErrorCode.CsrfFailed, "Request blocked: unexpected origin.");
    }
  }
}
