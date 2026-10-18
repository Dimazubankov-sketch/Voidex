# Clock (Step 2.14)

Voidex Clock («Часы», id `clock`) is a built-in VOIDEX app: world clock,
alarms, stopwatch and timers. It is the Voidex-Clock app ported natively
into the monorepo: no iframe, no page or server of its own.

## Where the code is

| Part | Place |
| --- | --- |
| Engine, drums, swipe rows, state model, adapters, sound catalog (TypeScript, no React) | `packages/clock/src` |
| The 13 alarm WAVs, the wheel tick, the Soundlab manifest (`sounds.json`, SHA-256 per file) | `packages/clock/assets` |
| Ported tests (engine, wheels, swipe, sounds, model / interactions) | `packages/clock/test` (`pnpm --filter @voidex/clock test`) |
| React UI of the window (lazy chunk) | `apps/web/src/apps/clock/clock-app.tsx` and siblings |
| Shell runtime: scheduler loop, ring queue, ring sheet | `apps/web/src/apps/clock/runtime.ts`, `ring-sheet.tsx` (mounted in `app.tsx`) |
| Registry manifest, release | `packages/shared/src/apps.ts` |
| Notification source `clock.alarm` / `clock.timer` | `packages/shared/src/notifications.ts`, `POST /api/notifications/clock` |

## How it fits VOIDEX

- **Icon**: `public/brand/app-clock.png` (the provided artwork, white tile and
  glow cut away), `ClockGlyph` with optical factor 1.1. It is a system icon
  only: desktop, dock, launcher, switcher, Settings → Applications, Appex
  Store, notifications. The Clock UI never draws it (an e2e test checks).
- **Look**: every colour comes from the semantic tokens, so the theme (light,
  dark, system) applies.
- **Layout**: phone (or a window narrower than 720 px): sections at the
  bottom, above the gesture bar. PC: a sidebar and wide panels; Ctrl/Cmd + 1..4
  switch sections, arrows move in the sidebar.
- **Settings → Applications → Часы**: Face ID / passcode lock, notifications
  (Clock sends them), storage on this device, offload (closes the window,
  keeps the alarms: they are data, not cache).

## Data and scheduling

- `ClockStorageAdapter`: the state is kept on the device, one localStorage key
  per account (`voidex-clock-v1:<userId>`). Nothing is synced between devices
  yet; the adapter is where account / ViCloud sync will plug in.
- `ClockSchedulerAdapter`: `scheduleAlarm`, `cancelAlarm`, `snoozeAlarm`,
  `scheduleTimer`, `cancelTimer`. The browser fallback (`background: false`)
  rings while VOIDEX is open on the device; a native shell can provide
  `window.VoidexClock` with the same calls (real OS alarms). The scheduler is
  always asked first; a refused registration leaves the state unchanged.
- The loop runs every 250 ms and when the tab becomes visible. An alarm found
  less than 5 minutes late still rings; an older one is reported as missed.
  Timers and the stopwatch count from deadlines (no drift).

## Rings

The ring sheet is part of the shell (it shows over any app, the home screen
and the lock screen): name, current time, «Ещё N мин» (when the alarm repeats
its signal), «Остановить». The sound loops; when the browser holds sound back
(no gesture yet) the sheet says so and offers «Включить звук». Each ring is
also posted to the account's Notification Center (`clock.alarm` /
`clock.timer`); the pop-up shows only on the device that rang and not while
Clock is in front. A tap opens Clock on that alarm or timer.

## Sounds

13 alarm sounds (Alert B first, the default) and the wheel tick, bundled by
Vite as files (WAVs are never inlined: the CSP allows `fetch` from `'self'`
only). Preview: one play per tap, the same sound cannot restart while it
plays, another sound stops it, leaving the picker stops it. The tick plays
only on a real step of a drum, at most every 28 ms.

## Widget

`clock` in the system widget catalogue (`WIDGET_TYPES` / `WIDGET_CELLS` in
`packages/shared/src/workspace.ts`, the body in `apps/web/src/os/home/widgets.tsx`):
a large analog clock taking a 2 x 2 block (the place of four icons), like the
Calculator widget. It is added from Widgets in the edit mode of the home
screen (phone and PC), stored in the synced workspace layout, moved and removed
like any widget. It shows this device's time, re-rendered on every second
(aligned to the clock, refreshed when the tab returns); the face, ticks and
hands use the theme tokens (light and dark), the second hand the accent. No
logo inside. A tap opens Clock on the world clock.

## Known limits

- No background alarms in the browser: VOIDEX has to be open on the device.
- Alarms and timers are per device; other devices only see the notification.
- Alert B is a third-party reference recording kept from the Soundlab export
  (see `assets/sounds.json`, field `rights`).

## Step 2.15
- **Tab bar** (phone): the system glass tab bar shared with Vibex (`ui/glass-tab-bar.tsx`);
  a swipe along it moves the capsule and chooses the tab under it.
- **Drums** (`wheels.ts`): turned by the pointer itself (no native scroll snap). A drag follows
  the finger 1:1; a flick spins on, further the faster it was (at most 14 rows, under a second)
  and rests exactly on a row; the mouse wheel steps one row per notch (a trackpad adds up);
  keys and the wheel turn on endlessly (58, 59, 00, 01 … and back). The chosen value is darker
  text on a soft band, no outline.
- **Sound preview**: choosing a melody plays it (the list stays open); the same one is not
  started over itself; another one stops it; a preview that could not be heard never blocks the
  next tap.
- **Rings**: a centred overlay over any app (the rest blurred), Stop and, for alarms, Snooze;
  no «Включить звук»: the sound starts by itself (the first tap anywhere unlocks it; it is
  retried while the page may not yet play sound).
- **Stopwatch** ticks quietly while it runs and Clock is in front; it stops in the background.
- **New alarms** have no day chosen: they ring once at the next such time (today or tomorrow).
- Timer setup centred on a PC; grey round Сброс / + / × buttons; fields without a focus frame.
