import { ErrorCode, type ApiErrorBody, type SessionResponse } from "@voidex/shared";
import { useSession } from "./session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network",
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function rawRequest(method: string, path: string, body?: unknown, token?: string | null, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers: {
      // Required on every call: the server's CSRF guard rejects requests without it.
      "X-Voidex-Client": "web",
      ...(body !== undefined && !(body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "network", "Network error");
  }
  return res;
}

async function toError(res: Response): Promise<ApiError> {
  let data: ApiErrorBody | null = null;
  try {
    data = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON */
  }
  const e = data?.error;
  return new ApiError(res.status, e?.code ?? ErrorCode.Internal, e?.message ?? res.statusText, e?.fields, e?.details);
}

// ---------------------------------------------------------------------------
// Token refresh — single flight per tab, serialized across tabs (the refresh
// cookie rotates on every use, so two tabs must not refresh concurrently).

let inflight: Promise<SessionResponse> | null = null;

async function doRefresh(lock: boolean): Promise<SessionResponse> {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      // { lock: true } on app start: with a passcode set, a new start opens on the lock screen.
      const res = await rawRequest("POST", "/api/auth/refresh", lock ? { lock: true } : {});
      if (res.ok) return (await res.json()) as SessionResponse;
      const err = await toError(res);
      if (err.code === ErrorCode.RefreshRace) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw err;
    }
    throw new ApiError(409, ErrorCode.RefreshRace, "Refresh race");
  };
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request("vx-refresh", run);
  }
  return run();
}

/**
 * Renews the session using the refresh cookie. Used on boot (`lock`: the app
 * starts locked when a passcode is set) and on expiry.
 */
export function refreshSession(opts: { lock?: boolean } = {}): Promise<SessionResponse> {
  inflight ??= doRefresh(!!opts.lock)
    .then((s) => {
      useSession.getState().setSession(s);
      return s;
    })
    .catch((err: ApiError) => {
      if (err.code === ErrorCode.SessionLocked) useSession.getState().lockLocal();
      else if (err.code === ErrorCode.SessionExpired || err.code === ErrorCode.SessionRevoked || err.code === ErrorCode.Unauthenticated) {
        const had = useSession.getState().status === "signedIn";
        useSession.getState().signOutLocal(err.code === ErrorCode.SessionRevoked ? "revoked" : had ? "expired" : null);
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Returns a valid access token, refreshing shortly before expiry. */
export async function accessToken(): Promise<string | null> {
  const s = useSession.getState();
  if (!s.accessToken) return null;
  if (s.accessTokenExpiresAt - Date.now() < 30_000) {
    try {
      return (await refreshSession()).accessToken;
    } catch {
      return null;
    }
  }
  return s.accessToken;
}

export interface RequestOptions {
  /** Skip auth header (public endpoints). */
  anonymous?: boolean;
  headers?: Record<string, string>;
  /** Don't ask for a code-password confirmation on `step_up_required` (the caller handles it). */
  noStepUp?: boolean;
}

/**
 * Asks the person to confirm with the code-password or Face ID (the step-up
 * sheet registers itself here). Resolves true once confirmed, false if dismissed.
 */
let stepUpHandler: (() => Promise<boolean>) | null = null;
export function setStepUpHandler(h: (() => Promise<boolean>) | null) {
  stepUpHandler = h;
}

const lockedError = () => new ApiError(423, ErrorCode.SessionLocked, "Locked");

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  // A locked session gets nothing from the server: don't even try (the lock screen is up).
  if (!opts.anonymous && useSession.getState().locked) throw lockedError();
  const res = await send(method, path, body, opts);
  if (!res.ok) {
    const err = await toError(res);
    if (err.code === ErrorCode.SessionLocked) useSession.getState().lockLocal();
    // Sensitive change: confirm (code-password / Face ID) and repeat once.
    if (err.code === ErrorCode.StepUpRequired && !opts.noStepUp && stepUpHandler && (await stepUpHandler())) {
      return request<T>(method, path, body, { ...opts, noStepUp: true });
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? await res.json() : await res.blob()) as T;
}

async function send(method: string, path: string, body: unknown, opts: RequestOptions): Promise<Response> {
  const token = opts.anonymous ? null : await accessToken();
  if (!opts.anonymous && !token && useSession.getState().locked) throw lockedError();
  let res = await rawRequest(method, path, body, token, opts.headers);
  if (res.status === 401 && token) {
    const err = await toError(res);
    if (err.code === ErrorCode.SessionRevoked) {
      useSession.getState().signOutLocal("revoked");
      throw err;
    }
    // Access token expired or server restarted with new keys: refresh once and retry.
    const fresh = await refreshSession();
    res = await rawRequest(method, path, body, fresh.accessToken, opts.headers);
  }
  return res;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("PUT", path, body, opts),
  patch: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("PATCH", path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
};

/**
 * POST without an access token: the lock-screen routes (/api/auth/lock/*)
 * identify the session by its refresh cookie, because a locked session has no
 * access token.
 */
export async function rawPost<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await rawRequest("POST", path, body);
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** GET a file without an access token (the lock-screen wallpaper). */
export async function rawGetBlob(path: string): Promise<Blob> {
  const res = await rawRequest("GET", path);
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}
