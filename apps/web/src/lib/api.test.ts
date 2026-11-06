import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@voidex/shared";
import { api, ApiError, isUnreachable, refreshSession } from "./api";
import { useSession } from "./session";
import { criticalOperationsRunning } from "./critical-ops";

const SESSION = {
  accessToken: "access-token-1",
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  sessionId: "s1",
  user: { id: "u1", language: "ru", username: "ivan", firstName: "Иван", lastName: "П", address: "ivan@voidops" },
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, details?: unknown) => json(status, { error: { code, message: code, details } });

beforeEach(() => {
  useSession.setState({ status: "booting", locked: false, accessToken: null, accessTokenExpiresAt: 0, sessionId: null, user: null, signedOutReason: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("refresh", () => {
  it("many concurrent refreshes make ONE request and share its result (no refresh-token race)", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return json(200, SESSION);
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.all(Array.from({ length: 8 }, () => refreshSession()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.accessToken)).size).toBe(1);
    expect(useSession.getState().status).toBe("signedIn");
  });

  it("an expired / unauthenticated refresh token signs out with the right reason", async () => {
    useSession.getState().setSession(SESSION as never);
    vi.stubGlobal("fetch", vi.fn(async () => err(401, ErrorCode.SessionExpired)));
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().status).toBe("signedOut");
    expect(useSession.getState().signedOutReason).toBe("expired");
  });

  it("a revoked session ends as 'revoked'", async () => {
    useSession.getState().setSession(SESSION as never);
    vi.stubGlobal("fetch", vi.fn(async () => err(401, ErrorCode.SessionRevoked)));
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().signedOutReason).toBe("revoked");
  });

  it("423 locks the app (lock screen) and does not retry in a loop", async () => {
    const fetchMock = vi.fn(async () => err(423, ErrorCode.SessionLocked));
    vi.stubGlobal("fetch", fetchMock);
    await expect(refreshSession({ lock: true })).rejects.toMatchObject({ status: 423 });
    expect(useSession.getState().status).toBe("locked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a server outage does NOT sign the person out", async () => {
    useSession.getState().setSession(SESSION as never);
    vi.stubGlobal("fetch", vi.fn(async () => err(503, ErrorCode.Internal)));
    await expect(refreshSession()).rejects.toSatisfy((e: unknown) => isUnreachable(e));
    expect(useSession.getState().status).toBe("signedIn");
  });

  it("a network failure is 'unreachable' and keeps the session", async () => {
    useSession.getState().setSession(SESSION as never);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    await expect(refreshSession()).rejects.toSatisfy((e: unknown) => isUnreachable(e));
    expect(useSession.getState().status).toBe("signedIn");
  });

  it("a stalled connection ends with a timeout error instead of waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))));
    const p = refreshSession({ lock: true });
    const assertion = expect(p).rejects.toMatchObject({ status: 0, code: "network", details: { timeout: true } });
    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
    expect(useSession.getState().status).toBe("booting"); // unchanged: the app decides what to show
  });
});

describe("requests", () => {
  it("classifies unreachable errors", () => {
    expect(isUnreachable(new ApiError(0, "network", "x"))).toBe(true);
    expect(isUnreachable(new ApiError(502, ErrorCode.Internal, "x"))).toBe(true);
    expect(isUnreachable(new ApiError(429, ErrorCode.RateLimited, "x"))).toBe(true);
    expect(isUnreachable(new ApiError(401, ErrorCode.SessionExpired, "x"))).toBe(false);
    expect(isUnreachable(new ApiError(423, ErrorCode.SessionLocked, "x"))).toBe(false);
    expect(isUnreachable(new Error("x"))).toBe(false);
  });

  it("a mutating request is a critical operation while it runs; a GET is not", async () => {
    useSession.getState().setSession(SESSION as never);
    let during = -1;
    vi.stubGlobal("fetch", vi.fn(async () => {
      during = criticalOperationsRunning();
      return json(200, { ok: true });
    }));
    await api.post("/api/notes", { a: 1 });
    expect(during).toBe(1);
    await api.get("/api/notes");
    expect(during).toBe(0);
    expect(criticalOperationsRunning()).toBe(0);
  });

  it("an expired access token is refreshed once and the request is retried", async () => {
    useSession.getState().setSession({ ...SESSION, accessTokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() } as never);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls++;
      if (url.endsWith("/api/auth/refresh")) return json(200, { ...SESSION, accessToken: "access-token-2" });
      return calls === 1 ? err(401, ErrorCode.Unauthenticated) : json(200, { ok: 1 });
    }));
    await expect(api.get("/api/me")).resolves.toEqual({ ok: 1 });
    expect(useSession.getState().accessToken).toBe("access-token-2");
  });
});
