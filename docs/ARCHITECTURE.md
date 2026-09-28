# VOIDEX — Step 1 architecture

VOIDEX is a personal digital space that looks and behaves like its own operating
system but ships as an application (phone app stores, desktop app, web). Step 1
builds the foundation every later app will stand on: **one VOIDEX Account, one
server-side source of truth, an OS shell with a window system and an app
registry, and two real system apps — Settings and Mail.**

---

## 1. Audit (starting point)

| Area | Finding |
|---|---|
| This repository | Empty — no commits. Greenfield. |
| Existing product: VOIDEX messenger ([Voyzen](https://github.com/Dimazubankov-sketch/Voyzen)) | Next.js 16 + React 19 + Tailwind v4 + motion + Remix Icons. **Front-end only** (static export to GitHub Pages); accounts, auth and data live in `localStorage` (mock). |
| Reused | Visual language: grey canvas `#ececed`, white surfaces, violet accent `#6c5cff`, soft radii; the same UI libraries (React 19, Tailwind v4, motion, Remix Icons) so both products feel like one ecosystem. |
| Not reused | The messenger's auth and data layer — it is decorative (client-side only) and can't provide security, sync or ownership checks. |
| Missing (built in Step 1) | Backend, database, real authentication, sessions/devices, SMS verification, legal consents, OS shell, app registry, Settings, internal Mail. |

**Decision:** a new pnpm monorepo. Next.js was not carried over: VOIDEX is an
app shell that will be wrapped by native containers (Capacitor for iOS/Android,
Tauri/Electron for desktop), which want a static SPA plus a separate API — so
the client is Vite + React and the server is Fastify + PostgreSQL.

## 2. Repository layout

```
apps/server      Fastify API, Drizzle ORM, PostgreSQL, SSE — the source of truth
  src/db           schema.ts (all tables), migrations in ../drizzle
  src/services     accounts, sessions, verification (OTP), challenges, mail, apps, legal, events, sms/
  src/routes       auth, account/security/apps/events, mail, system
  legal/           versioned legal documents (<key>/<version>.<lang>.md)
  test/            integration tests against a real PostgreSQL
apps/web         Vite + React 19 + Tailwind v4 client (the OS shell and apps)
  src/os           workspace, window manager, app registry, system menu, events
  src/apps         settings/, mail/ — code-split system apps
  src/auth         welcome, sign-up, sign-in, new-device challenge, recovery
  src/ui           design-system components; src/styles tokens
  e2e/             Playwright end-to-end tests (phone + desktop layouts)
packages/shared  validation rules, request schemas, DTOs, app registry, legal registry
                 used by BOTH server (authoritative) and client (instant feedback)
```

## 3. Identity, sessions and security

```
VOIDEX ACCOUNT (users row)
        │
  VOIDEX BACKEND  ── PostgreSQL (source of truth)
        │  REST + Server-Sent Events
  ┌─────┴──────┐
iPhone        PC        … every device reads/writes the same account
  └────SYNC────┘
```

* **Passwords** — scrypt (N=2^15, r=8, p=1, 64-byte key, per-user salt). Encoded
  with parameters so they can be raised and re-hashed on next sign-in.
* **Access token** — JWT (HS256, 15 min) carrying `sub` + `sid`. Every protected
  request also checks that the session is alive, so sign-out and
  "sign out of all devices" are **immediate**.
* **Refresh token** — 256-bit random, stored only as SHA-256, **rotated on every
  use**. Re-use of an old token (outside a 20 s multi-tab grace) revokes the
  session (theft detection). Sliding idle expiry 30 days, absolute 180 days.
* **Web storage** — refresh token and device secret are `httpOnly`,
  `SameSite=Strict`, `Secure` (prod) cookies scoped to `/api/auth`; the access
  token lives only in memory. Native shells send `X-Voidex-Client: native` and
  receive the tokens in the body for OS secure storage (Keychain/Keystore).
* **Devices** — each browser/app has a random device secret (hash stored). A
  device becomes *trusted* after passing a second factor.
* **New-device sign-in** — password **plus** either an SMS code to the account
  phone or approval on an already signed-in trusted device (real-time prompt).
* **Recovery** — same challenge, then a new password; all sessions are revoked.
* **Brute force** — per-IP route limits (`@fastify/rate-limit`), per-account
  exponential lockout after 5 failures, OTP: 5 attempts, 10 min TTL, 60 s resend,
  8/hour per number, codes stored as HMAC with a server pepper.
* **CSRF** — SameSite=Strict cookies + mandatory `X-Voidex-Client` header on
  every mutating request (forces a CORS preflight foreign origins fail) +
  Origin check. **XSS** — React escaping, no `dangerouslySetInnerHTML`, strict
  CSP (`script-src 'self'`), mail bodies rendered as text, legal docs rendered by
  a safe Markdown→React renderer.
* **Ownership** — identity always comes from the token (`req.auth`), never from
  ids in the request. Mail content is reachable only through a `mail_entries`
  row owned by the caller's mail account. Tested: user A cannot read, act on,
  reply to, edit, send or search user B's data.
* **Audit** — `security_events` (sign-ins, failures, password/phone changes,
  approvals, refresh-token re-use).

### SMS — production dependency

`SmsProvider` interface with `ConsoleSmsProvider` (development), `TwilioSmsProvider`
and `SmsRuProvider`. In development the code is logged and returned to the client
**flagged as development** (shown in a yellow notice). The server **refuses to
start in production** with the console provider — it never pretends to send SMS.
Credentials: `TWILIO_*` or `SMSRU_API_ID` (see `apps/server/.env.example`).

## 4. Data model

`users` · `user_avatars` · `user_preferences` (synced settings) · `consents`
(document key + version + time + IP) · `devices` · `sessions` ·
`phone_verifications` · `auth_challenges` · `security_events` · `installed_apps` ·
`mail_accounts` · `mail_threads` · `mail_messages` · `mail_recipients` ·
`mail_entries` · `mail_attachments` (schema reserved).

Mail stores a message **once**; every mailbox that can see it has its own
`mail_entries` row with folder, read and star state. Threads group replies;
visibility is never granted by the thread — only by entries (a person added
later to a conversation doesn't see earlier messages). `transport` columns keep
room for an external (SMTP) transport later; today only `internal` exists and
external recipients are refused.

## 5. OS shell

* **Workspace** — grey desk, white home surface with installed apps (concept
  IMG_6616 without bottom navigation, user button or "Recents"); top-right `[...]`
  system menu and the 9-dot launcher.
* **Window manager** (`os/window-manager.ts`) — one model, two presentations:
  desktop windows (move, resize, maximize, minimize, z-order, open from icon,
  minimize to launcher) and mobile multitasking (one foreground app, home
  indicator: swipe up = home, swipe up and hold = app switcher, cards swipe up to
  close). Apps stay mounted in the background. Window layout is per device; data
  inside apps is what syncs.
* **`[...]` menu** — desktop: Minimize / Maximize / Workspace / Close. Phone:
  Workspace / Open apps / Close — no meaningless desktop controls.
* **App Registry** — manifests in `packages/shared/src/apps.ts` (id, names,
  version, kind, permissions, window defaults, status); installed apps per account
  in `installed_apps` (server). Client half in `apps/web/src/os/app-registry.tsx`
  maps ids to code-split components. Only registry apps can ever be installed —
  the closed ecosystem the future App Market will plug into.

**Adding an app:** manifest in `shared/apps.ts` → folder `web/src/apps/<id>` →
entry in `os/app-registry.tsx` → server endpoints under `/api/<id>` guarded by
`app.authenticate` and scoped to `req.auth`.

## 6. Cross-device sync

The server is the only source of truth. Each signed-in device keeps one SSE
stream (`GET /api/events`, fetched with the Authorization header). Events:
`mail.received`, `mail.changed`, `account.updated`, `preferences.updated`,
`sessions.updated`, `approval.requested/resolved`, `session.revoked`. Clients
invalidate the matching React Query caches; on reconnect everything is refetched,
so nothing missed while offline stays stale. `EventHub` is in-process; for
several server instances back it with Redis/NATS pub-sub (same interface).

## 7. Internationalisation & regions

`LANGUAGES` (en, ru) in shared + one dictionary file per language in
`web/src/lib/i18n`. The account's language syncs to every device. Country names
come from `Intl.DisplayNames`. `regionPolicy(country)` is the single place where a
country affects behaviour (default language, minimum age, feature flags).

## 8. Native packaging (next step)

The web build is a static SPA talking to `/api`. For stores: wrap with Capacitor
(iOS/Android) and Tauri or Electron (Windows/macOS), set `VITE_API_BASE`, add the
shell origin to `ALLOWED_ORIGINS`, and store tokens via the native path
(`X-Voidex-Client: native`). Push notifications (APNs/FCM) will be a new
`notifications` transport next to SSE.

## 9. Not in Step 1 (by design)

App Market, Browser, Messenger integration, Files, Photos, Music, cloud drive,
external e-mail, payments, AI, 2FA apps/passkeys/biometrics. Attachments have a
reserved schema but no UI — nothing is shown that doesn't work.
