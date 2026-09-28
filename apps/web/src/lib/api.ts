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

async function doRefresh(): Promise<SessionResponse> {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await rawRequest("POST", "/api/auth/refresh", {});
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

/** Renews the session using the refresh cookie. Used on boot and on expiry. */
export function refreshSession(): Promise<SessionResponse> {
  inflight ??= doRefresh()
    .then((s) => {
      useSession.getState().setSession(s);
      return s;
    })
    .catch((err: ApiError) => {
      if (err.code === ErrorCode.SessionExpired || err.code === ErrorCode.SessionRevoked || err.code === ErrorCode.Unauthenticated) {
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
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const token = opts.anonymous ? null : await accessToken();
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
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? await res.json() : await res.blob()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("PUT", path, body, opts),
  patch: <T>(path: string, body: unknown = {}, opts?: RequestOptions) => request<T>("PATCH", path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}
