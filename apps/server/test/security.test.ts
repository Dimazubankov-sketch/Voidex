import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

const MIN = 60_000;
/** A page on http://localhost:5173 (WebAuthn needs a domain; the CSRF check wants Origin = Host). */
const LOCALHOST = { headers: { origin: "http://localhost:5173", host: "localhost:5173" } };
/** Bigger than the 5-minute step-up window and the default 5-minute auto-lock (+ 2 min grace). */
const LONG_IDLE = 8 * MIN;

async function account() {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: "Лок", lastName: "Код" });
  return { d, ...r };
}

describe("code-password, lock screen, step-up (Step 2.4)", () => {
  it("a new account must create a passcode first; creating it needs no confirmation", async () => {
    const { d } = await account();
    const s0 = await d.get("/api/security/status");
    expect(s0.status).toBe(200);
    expect(s0.body).toMatchObject({ passcodeEnabled: false, passcodeSetupRequired: true, faceIdOnThisDevice: false, autoLockMinutes: 5 });
    expect((await d.post("/api/security/passcode", { passcode: "12345" })).status).toBe(400); // 6 digits
    const s1 = await d.post("/api/security/passcode", { passcode: "246810" });
    expect(s1.status).toBe(200);
    expect(s1.body).toMatchObject({ passcodeEnabled: true, passcodeSetupRequired: false });
  });

  it("lock: no API access while locked; the passcode unlocks and issues fresh tokens", async () => {
    const { d } = await account();
    await d.post("/api/security/passcode", { passcode: "135790" });
    expect((await d.post("/api/auth/lock", {})).body).toEqual({ locked: true });
    // Every API call and every refresh is refused while locked.
    expect((await d.get("/api/me")).status).toBe(423);
    const r = await d.post("/api/auth/refresh", {});
    expect(r.status).toBe(423);
    expect(r.body.error.code).toBe("session_locked");
    const state = await d.post("/api/auth/lock/state", {});
    expect(state.body).toMatchObject({ locked: true, faceId: false, passcodeLockedUntil: null, firstName: "Лок" });
    // Wrong code: refused, attempts left reported.
    const wrong = await d.post("/api/auth/lock/unlock", { passcode: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("passcode_invalid");
    expect(wrong.body.error.details.attemptsLeft).toBe(9);
    // Right code: unlocked, new access token, API works again.
    const ok = await d.post("/api/auth/lock/unlock", { passcode: "135790" });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await d.get("/api/me")).status).toBe(200);
    expect((await d.post("/api/auth/lock/state", {})).body.locked).toBe(false);
  });

  it("app start locks ({ lock: true } on refresh) only when a passcode is set", async () => {
    const { d } = await account();
    expect((await d.post("/api/auth/refresh", { lock: true })).status).toBe(200); // no passcode: nothing to unlock with
    await d.post("/api/security/passcode", { passcode: "112233" });
    expect((await d.post("/api/auth/refresh", { lock: true })).status).toBe(423);
    expect((await d.get("/api/me")).status).toBe(423);
    expect((await d.post("/api/auth/lock/unlock", { passcode: "112233" })).status).toBe(200);
  });

  it("auto-lock: the server locks a session idle longer than the interval", async () => {
    const { d } = await account();
    await d.post("/api/security/passcode", { passcode: "445566" });
    env.clock.advance(LONG_IDLE);
    try {
      expect((await d.get("/api/me")).status).toBe(423);
      expect((await d.post("/api/auth/lock/unlock", { passcode: "445566" })).status).toBe(200);
      expect((await d.get("/api/me")).status).toBe(200);
      // "Never" (0) is a sensitive change and only locks on start / manually.
      expect((await d.post("/api/security/auto-lock", { minutes: 7 })).status).toBe(400);
      expect((await d.post("/api/security/auto-lock", { minutes: 0 })).body.autoLockMinutes).toBe(0);
      env.clock.advance(LONG_IDLE * 3);
      // (The access token itself expired meanwhile: the client refreshes — and is not locked.)
      expect((await d.post("/api/auth/refresh", {})).status).toBe(200);
      expect((await d.get("/api/me")).status).toBe(200);
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it("wrong codes: blocked after 5 (doubling), signed out after 10", async () => {
    const { d } = await account();
    await d.post("/api/security/passcode", { passcode: "778899" });
    await d.post("/api/auth/lock", {});
    try {
      for (let i = 1; i <= 4; i++) expect((await d.post("/api/auth/lock/unlock", { passcode: "000000" })).status).toBe(401);
      const fifth = await d.post("/api/auth/lock/unlock", { passcode: "000000" });
      expect(fifth.status).toBe(401);
      expect(fifth.body.error.details.retryAfterSeconds).toBe(30);
      // Even the right code is refused while blocked.
      const blocked = await d.post("/api/auth/lock/unlock", { passcode: "778899" });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("passcode_locked");
      expect((await d.post("/api/auth/lock/state", {})).body.passcodeLockedUntil).toBeTruthy();
      for (let i = 6; i <= 9; i++) {
        env.clock.advance(16 * MIN);
        expect((await d.post("/api/auth/lock/unlock", { passcode: "000000" })).status).toBe(401);
      }
      env.clock.advance(16 * MIN);
      const tenth = await d.post("/api/auth/lock/unlock", { passcode: "000000" });
      expect(tenth.status).toBe(401);
      expect(tenth.body.error.code).toBe("session_revoked");
      expect((await d.post("/api/auth/refresh", {})).status).toBe(401);
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it("step-up: sensitive changes need a recent passcode confirmation (a fresh sign-in counts)", async () => {
    const { d } = await account();
    await d.post("/api/security/passcode", { passcode: "102030" });
    // Right after sign-up / setting the passcode: confirmed.
    expect((await d.patch("/api/account/profile", { firstName: "Новое" })).status).toBe(200);
    env.clock.advance(6 * MIN);
    try {
      // Keep the session active so auto-lock doesn't interfere.
      const r = await d.patch("/api/account/profile", { firstName: "Ещё" });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("step_up_required");
      expect((await d.post("/api/security/passcode", { passcode: "999999" })).status).toBe(403); // changing it too
      expect((await d.post("/api/security/step-up", { passcode: "111111" })).status).toBe(401);
      const ok = await d.post("/api/security/step-up", { passcode: "102030" });
      expect(ok.status).toBe(200);
      expect(ok.body.stepUpUntil).toBeTruthy();
      expect((await d.patch("/api/account/profile", { firstName: "Ещё" })).status).toBe(200);
      expect((await d.get("/api/security/sessions")).status).toBe(200); // reading the list is fine
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it("turning the passcode off is confirmed; without it nothing locks", async () => {
    const { d } = await account();
    await d.post("/api/security/passcode", { passcode: "556677" });
    const off = await d.delete("/api/security/passcode");
    expect(off.status).toBe(200);
    expect(off.body.passcodeEnabled).toBe(false);
    expect((await d.post("/api/auth/lock", {})).body).toEqual({ locked: false });
    expect((await d.get("/api/me")).status).toBe(200);
    // No passcode → no step-up needed for sensitive changes.
    env.clock.advance(10 * MIN);
    try {
      expect((await d.patch("/api/account/profile", { firstName: "Без" })).status).toBe(200);
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it("Face ID needs a passcode first and a real domain (no IP origin)", async () => {
    const { d } = await account();
    const noPasscode = await d.post("/api/security/face-id/options", {}, LOCALHOST);
    expect(noPasscode.status).toBe(409);
    expect(noPasscode.body.error.code).toBe("passcode_not_set");
    await d.post("/api/security/passcode", { passcode: "314159" });
    const ip = await d.post("/api/security/face-id/options", {}, { headers: { origin: "http://127.0.0.1:5173", host: "127.0.0.1:5173" } });
    expect(ip.status).toBe(409);
    expect(ip.body.error.code).toBe("face_id_unavailable");
    const opts = await d.post("/api/security/face-id/options", {}, LOCALHOST);
    expect(opts.status).toBe(200);
    expect(opts.body.rp).toEqual({ name: "VOIDEX", id: "localhost" });
    expect(opts.body.authenticatorSelection).toMatchObject({ authenticatorAttachment: "platform", userVerification: "required" });
    // A forged registration is rejected; nothing is stored.
    const forged = await d.post("/api/security/face-id", { response: { id: "x", rawId: "x", type: "public-key", response: {} } }, LOCALHOST);
    expect(forged.status).toBe(401);
    expect((await d.get("/api/security/status")).body.faceIdOnThisDevice).toBe(false);
    // Unlock with Face ID on a device without it: refused.
    await d.post("/api/auth/lock", {});
    const unlockOpts = await d.post("/api/auth/lock/options", {}, LOCALHOST);
    expect(unlockOpts.status).toBe(409);
  });

  it("the lock screen has its own wallpaper slot, readable while locked", async () => {
    const { d } = await account();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cf00000301010036a2c3a90000000049454e44ae426082", "hex");
    const up = await env.app.inject({
      method: "PUT",
      url: "/api/account/wallpaper?slot=lock",
      payload: png,
      headers: { "content-type": "application/octet-stream", "x-voidex-client": "web", "x-test-client": d.testClientId, authorization: `Bearer ${d.accessToken}` },
    });
    expect(up.statusCode).toBe(200);
    // The desktop slot is separate.
    expect((await d.get("/api/account/wallpaper")).status).toBe(404);
    await d.post("/api/security/passcode", { passcode: "202020" });
    await d.post("/api/auth/lock", {});
    const img = await d.get("/api/auth/lock/wallpaper");
    expect(img.status).toBe(200);
    expect(img.raw.headers["content-type"]).toBe("image/png");
  });
});
