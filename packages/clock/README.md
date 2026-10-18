# @voidex/clock

The core of VOIDEX Clock, ported from Voidex-Clock (`dist/engine.js`,
`wheels.js`, `swipe.js` and the state handling of `app.js`) to TypeScript.
No React here: the UI is in `apps/web/src/apps/clock`.

- `engine.ts`: next alarm (wall clock, DST-safe), durations, deadlines, zones
- `cities.ts`: the world clock's cities (Russian and English names)
- `wheels.ts`: the number drums (cyclic, snap, keys, flush, silent restore)
- `swipe.ts`: swipe-to-reveal trash rows (keyboard too)
- `model.ts`: the state and every change to it, the scheduler tick
- `adapters.ts`: `ClockStorageAdapter` (device) and `ClockSchedulerAdapter` (browser / native bridge)
- `sounds.ts`: the 13 sounds of `assets/` (Alert B default)

Tests: `pnpm --filter @voidex/clock test`. See `docs/CLOCK.md`.
