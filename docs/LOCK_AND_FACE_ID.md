# Lock screen, code-password and Face ID (Step 2.4)

One VOIDEX account is one identity everywhere: the lock screen, the
code-password and Face ID protect the existing VOIDEX session. Vibex and the
other apps have no sign-in of their own.

## What is real

| Piece | How it works | Where |
|---|---|---|
| **Code-password** | 6 digits. Only a scrypt hash is stored (`users.passcode_hash`). After 5 wrong codes it is blocked for 30 s, doubling up to 15 min; the 10th wrong code signs this device out (the session is revoked). | `apps/server/src/services/security.ts` |
| **Lock** | `sessions.locked_at`. While a session is locked **the server refuses every API call (423 `session_locked`)**, the refresh does not issue tokens and the event stream closes. It is not just a curtain over the page. | `services/sessions.ts`, `routes/security.ts` |
| **App start** | The client refreshes with `{ lock: true }`. When the account has a code-password, a new start (reload, new tab, reopening the PWA) opens on the lock screen. | `apps/web/src/lib/api.ts` |
| **Auto-lock** | The server locks a session idle longer than the chosen interval (2 / 5 / 15 / 60 min, default 5) plus 2 minutes of grace. The client also locks on its own timer. A heartbeat (`POST /api/security/activity`) is sent while the person uses the page. "Only at start" turns the timer off. | `os/lock/auto-lock.ts` |
| **Face ID** | **WebAuthn** with the device's own platform authenticator (`authenticatorAttachment: platform`, `userVerification: required`, attestation `none`). The device does the face, fingerprint or Windows Hello check and signs a one-time server challenge (2 min, single use) with a key that never leaves it. The server verifies the signature, origin, RP id, the user-verified flag and the counter with `@simplewebauthn/server`. VOIDEX stores only the public key (`webauthn_credentials`), one per device. | `services/security.ts`, `lib/faceid.ts` |
| **Step-up** | Personal data, password, phone, security, devices and sessions (and approving sign-ins, export, revoking sessions) need a confirmation from the last 5 minutes (`sessions.step_up_at`). The server answers `403 step_up_required`; the client shows "Подтвердите, что это вы" (code-password or Face ID) and repeats the request once. A fresh sign-in or unlock counts as a confirmation. Without a code-password nothing is asked. | `os/lock/step-up.tsx`, `apps/settings` |

## What is the fallback, and what Face ID is *not*

- The code-password is always the fallback. Face ID cannot exist without it:
  turning the code-password off removes Face ID on all devices.
- "Face ID" is the name in VOIDEX. Under the hood it is whatever the device
  offers to the browser: Face ID or Touch ID (Apple), Windows Hello, or
  Android biometrics. VOIDEX never gets a photo or a biometric template.
- Browsers report a cancelled system prompt and a failed face check the same
  way (`NotAllowedError`, on purpose, for privacy). VOIDEX therefore says
  "Face ID не подтверждён" and offers to retry or use the code-password. The
  automatic first try on the lock screen waits quietly for a tap instead.
- Face ID is offered only where it can really work: a secure context on a
  domain (`https://voidex.su`; `localhost` in development), a browser with
  WebAuthn and a platform authenticator. Otherwise the setup screen says so
  plainly and VOIDEX unlocks with the code-password.
- The RP id is `voidex.su` in production (`WEBAUTHN_RP_ID`). It only works
  on that domain and its subdomains, and credentials are bound to it.

## Limits

- The lock screen hides the workspace and makes it inert. Open windows and
  drafts stay in this tab's memory, so nothing is lost when unlocking. A
  person with developer tools on an unlocked computer could read what was
  already loaded, but no new data comes from the server while locked.
- Several tabs share one session: locking in one tab locks them all through
  the server and the event stream, and unlocking in one tab unlocks the
  others (BroadcastChannel and a re-check on focus).
- Forgotten code-password: "Забыли код-пароль? Выйти" signs this device out.
  Signing in again uses the password plus SMS / approval as before, and the
  code-password can then be changed in Settings.
- Face ID can't be tested in a browser without biometrics. The e2e tests use
  Chromium's virtual authenticator, which goes through the real WebAuthn
  ceremony against the real server.

## First setup

New accounts (`users.passcode_setup_required`) see a non-dismissable screen
before the desktop:

1. Create the code-password. Trivial codes (000000, 123456…) are refused.
2. Repeat it.
3. Face ID: "Продолжить" runs the device prompt, "Настроить позже" skips it.

Accounts that existed before Step 2.4 have no code-password. Nothing changes
for them until they turn it on in Settings → "Экран блокировки и обои".

## API

Lock-screen routes use the refresh cookie because a locked session has no
access token:

- `POST /api/auth/lock/state`
- `POST /api/auth/lock`
- `POST /api/auth/lock/options`
- `POST /api/auth/lock/unlock` → a fresh session
- `GET /api/auth/lock/wallpaper?slot=lock|desktop`

Signed-in routes:

- `GET /api/security/status`
- `POST /api/security/activity`
- `POST` / `DELETE /api/security/passcode`
- `POST /api/security/auto-lock`
- `POST /api/security/step-up/options`
- `POST /api/security/step-up`
- `POST /api/security/face-id/options`
- `POST` / `DELETE /api/security/face-id`

Migration: `0007_lock_faceid_groups.sql` (additive only).

## Design

The Face ID symbol is VOIDEX's own: a rounded hexagon holding a wireframe
bust (a scan mesh) with a moving scan beam. It has no corner brackets and no
eyes, nose or smile. It turns rose with a cross on failure and fills with a
check on success (`os/lock/face-glyph.tsx`). The keypad uses soft rounded
keys with digits only.
