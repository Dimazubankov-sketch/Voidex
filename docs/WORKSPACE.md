# VOIDEX — Step 2: the workspace (home screen, folders, wallpaper, mail attachments)

## Data model

One model for every device, stored with the account (`user_preferences.data.workspace.layout`,
JSONB — no new table). Schema, limits and every edit are pure functions in
`packages/shared/src/workspace.ts`, shared by the server and the web client.

```
Workspace layout (per account, synced)
 ├── folders      shared by phone and PC — an app in a folder is in it everywhere
 ├── hidden       apps removed from the desktop (still installed, still in the 9-dot menu)
 ├── mobile       pages (max 3) of top-level items, 3 or 4 icons per row
 ├── desktop      virtual desktops (max 6) with their icons; columns 3–8, scale (density),
 │                view grid | categories, order manual | by name, arrange grid | free
 │                (+ positions), dock (pinned apps), dockDesktops, dockScale s|m|l
 ├── widgets      system widgets: PC free position on a desktop / phone stack on a page
 ├── categories   the user's own category per app (default: the app manifest)
 ├── names        the user's own icon label per app
 └── appearance   wallpaper (VOIDEX default | system preset | own image), glass level
                  (off / medium / on), captions. (Label colour / size retired in 2.2:
                  labels follow the wallpaper contrast and the scale.)
Windows (device-local, localStorage `vx.wm.<userId>`): open apps, sizes, the PC desktop each is on
```

* `normalizeLayout(layout, installedApps)` is the single consistency rule: unknown or
  uninstalled apps disappear, every visible item appears exactly once on the phone and once
  on the PC, empty folders/pages go away. The server runs it on every write
  (`PATCH /api/preferences`), the client on every read and edit — so a bad client can't store
  a broken desktop, and a new app simply appears at the end.
* Edits apply instantly on the device and are saved ~350 ms later (and on page hide).
  Other signed-in devices get the `preferences.updated` event and refresh.
* No layout stored yet = the default layout (every installed app on page 1 / desktop 1),
  so existing accounts need no migration and nobody is signed out by the update.
* The wallpaper image is a blob (`blobs` table, purpose `wallpaper`, one per user, max 8 MB,
  JPEG/PNG/WebP checked by magic bytes, readable only by its owner). The layout keeps just
  `{ kind: "image", version }`.

## Wallpapers and glass (Step 2.1)

* System wallpapers: VOIDEX (default), White, Violet glow, Light grey, Aura and four brand
  waves (violet, milk, milk & violet, grey & violet) — two close shades split by one soft wave,
  after the VOIDEX Mail artwork. Own picture upload stays.
* Step 2 gradients / presets in stored layouts are mapped to the nearest new wallpaper by
  `normalizeLayout` (server and client), so no data migration is needed.
* Glass (`appearance.glass`, default `on`) is applied as `<html data-glass>` and drives the
  `vx-glass*` CSS tokens used by the dock, folders, menus, desktop tabs and search.

## PC dock (Step 2.1)

* `desktop.dock` in the synced layout: pinned apps in order (new and older layouts: every app;
  emptied stays empty). Pin / unpin from the icon's right-click menu, by dragging a desktop icon
  onto the dock, or by dragging a dock icon up and out; drag inside the dock to reorder.
* The bottom bar holds the search field and, next to it, the glass dock; with nothing pinned only
  the search remains. Windows (also maximized) keep clear of the bar.
* The "Desktops" system icon at the end of the dock: hover (or click) for a glass menu with the
  desktops (current one marked) and "New desktop". The tabs at the top stay.

## Code map (web)

| File | What |
| --- | --- |
| `os/home/home-screen.tsx` | the home screen: header (clock / brush / ✓ / … / 9 dots), phone pager, PC grid & categories, desktop tabs |
| `os/home/gestures.ts` | one pointer engine for touch and mouse: long press, drag & drop, folders, page edges, pull-down search, right click |
| `os/home/icons.tsx` | app / folder icons, wiggle, edit badges, drag ghost |
| `os/home/folder-overlay.tsx` | open folder: rename, reorder, drag out |
| `os/home/context-menu.tsx` | right-click / long-press menus with sub-menus |
| `os/home/appearance-panel.tsx` | wallpaper, text, arrangement, view — used by the brush and by Settings → Рабочий стол |
| `os/home/dock.tsx` | PC bottom bar: search + dock (magnification, drag, Desktops menu) |
| `os/home/launcher.tsx` | 9-dot menu: all apps, search, add hidden apps back, system actions |
| `os/home/search.tsx` | app search (name, own label, aliases, caption, category); PC bottom bar, phone pull-down |
| `os/home/layout.ts` | reading the layout and saving edits |
| `os/system-actions.ts` | registry of system actions (none yet — see below) |

## Gestures

| | Phone | PC |
| --- | --- | --- |
| open app / folder | tap | click |
| edit mode | long press on free space | long press on free space, or right click → Изменить |
| leave edit mode | ✓ (top right), tap on free space, Esc | ✓, click on free space, Esc |
| icon menu | long press on an icon | right click |
| move an icon | long press and drag (or drag in edit mode) | drag |
| make a folder | hold an app over another app | same |
| new / other page | drag to the left or right edge and hold | — |
| pages | horizontal swipe, dots | — |
| desktops | — | tabs at the top, `+`, Ctrl+Alt+← / →, drag an icon onto a tab |
| search | pull down on the home screen | bottom search field |

## System actions — Screenshot (planned, not implemented)

The 9-dot menu has a place for OS actions (`os/system-actions.ts`). An action appears only
when it really works. The planned Screenshot action captures the VOIDEX screen and saves it to
the user's **VOIDEX Cloud** (not the device gallery). It needs the Cloud app and its storage
API, which don't exist yet, so nothing is shown and nothing is uploaded today. When Cloud
ships, it plugs into the same `BlobStorage` used by attachments and wallpapers (a `cloud`
purpose with its own quota).

## Mail attachments

* Paperclip in the composer; files are uploaded to the draft right away
  (`POST /api/mail/drafts/:id/attachments`, raw body, name in `X-File-Name`), can be removed
  before sending, and are sent with the message. Forwarding copies them.
* Limits (server-enforced): 10 MB per file, 10 files, 25 MB per message; allow-list of
  types by extension, magic-byte check for images/PDF; SVG/HTML/executables refused.
* Download: `GET /api/mail/attachments/:id` only for participants of the message, served as
  `Content-Disposition: attachment`, `nosniff`, `CSP: sandbox`.

## Database changes

* Migration `0003_blobs.sql` (additive): table `blobs` for file contents
  (attachments and wallpapers). Nothing is dropped or rewritten.
* The layout lives in the existing `user_preferences` JSONB.

## Known limits / next

* Phone pages don't have a fixed capacity: many icons on one page are clipped (there are
  only two apps today). A per-page capacity from the screen size is the next step.
* With a window open on PC, the desktop tabs may be under the window: use Ctrl+Alt+← / →
  or minimise. A "Move window to desktop" item in the window menu is next.
* Categories and name-sorted views are for browsing: switch to the grid / manual order to
  drag icons (menus work everywhere).

## Step 2.2 — desktop, dock, widgets

* **Dock = one glass object**: search field + pinned apps + the "Desktops" system item, width by
  content (`os/home/dock.tsx`). Nothing but the field → no glass. Hover accent is a ~12 %
  transform (`useMagnify`), so the dock never resizes or jumps. Sizes S/M/L
  (`desktop.dockScale`, tiles 40/46/52 px). Windows (also maximized) end right above the dock
  (`dockZone`).
* **Drag in the dock** changes a preview only (`drag.dockIndex`); the layout is written once on
  drop; Esc / pointer cancel change nothing. A drag that started in the dock never hides the
  app's desktop icon (the dock and the desktop are independent views of one app).
* **Desktop tabs, the desktop `…` and the phone view button are gone.** Desktops: dock item,
  "Desktops" widget, phone round glass button (pages), Ctrl+Alt+← / →.
* **Brush** (edit mode, top-left, phone and PC) → Wallpaper · View · Widgets
  (`brush-menu.tsx`). View switches Grid / Categories (PC: also Free) in place and the menu stays.
  PC right click on free space → Wallpaper · View ▸ · Widgets · Edit · New desktop.
* **Widgets** (`widgets.tsx`): built-in catalogue (first: Desktops), search, add / remove, drag
  to move in edit mode; stored in `layout.widgets` (synced, normalized server-side).
* **Free placement** (`desktop.arrange = "free"`): positions are fractions of the desktop area
  minus one cell, so they adapt to any screen and never leave it; the grid order is untouched.
* **Scale** (Settings, PC only): small / standard / moderately larger icons and labels. Phones
  scale by icons per row only.
* **View flip-back fix**: a server copy of the account (our own `preferences.updated` echo) never
  replaces the layout while a local edit is unconfirmed, nor when one of our saves was confirmed
  after the refetch started (`mergeServerUser` in `layout.ts`). Covered by
  `e2e/step22.spec.ts` with a delayed `/api/me` (fails without the fix).
* **Windows**: geometry lives as long as the window; closing forgets it, reopening uses the
  standard size and never inherits maximized.
* **Wallpapers**: neutral built-ins (clean white, white + violet glow, grey) and the VOIDEX wave
  series (purple wave light, milk, milk & purple, grey wave, grey & purple, milk + grey + purple).
  Retired presets map to the nearest new one in `normalizeLayout`.
* **Icons**: every logo fills the same box in its tile (vector marks use their own bounds,
  raster logos are trimmed of transparent margins at runtime). System UI graphics carry
  `data-system-ui` / `data-system-asset`: no save-image callout, no native drag. User content
  (Vibex / Mail pictures, attachments) is not marked.
* **Logo intro**: short VOIDEX intro on full page load only; skipped with reduced motion.

## Step 2.3 — system bar, grid cells, labels, calculator widget

- **PC system bar** (`os/system-bar.tsx`, 40 px): clock and date, the bell
  (Notification Center, unread badge) and the app menu, both small. Background
  `layout.appearance.systemBar`: `glass` or `off`. Windows live between the bar
  and the dock — the window layer starts below the bar and ends above the dock,
  so maximized windows never cover either.
- **Glass**: one material (`.vx-glass` / `.vx-glass-strong`) for the bar, dock,
  Notification Center, brush menu, widgets and floating buttons — real
  translucency (backdrop blur + saturation, thin light edge, inner highlight,
  very light shadow); the Off / Medium / On setting still applies.
- **App names**: `layout.appearance.showLabels` (Settings → Desktop → "Show app
  names"). Off: icons only on the home screen (the name stays the accessible
  label); search, dock and menus always show names.
- **Grid cells** (`gridPlacement`, `placeInCell` in `shared/workspace.ts`,
  `os/home/grid.tsx`): phone pages and PC desktops are grids of cells;
  `mobile.cells` / `desktop.cells` map item / widget keys to `{ c, r }`. A drop
  on an empty cell takes it; on an occupied cell the two swap; resting on an
  icon's centre still makes a folder; empty cells stay empty. Items without a
  stored cell (new apps, cells that no longer fit after the column count
  changed, collisions) flow into the first free cells in reading order, items
  that had a cell first — nothing is lost. Categories view arranges itself
  (no manual placement). The Step 2.2 free pixel placement is retired
  (`arrange` is always `grid`; stored `positions` are ignored).
  Step 2.3.1: while an icon is dragged no grid or drop-cell outline is drawn;
  the icon still snaps to the cell under the pointer (`data-drop-cell` on the
  grid, for tests).
- **Brush → View** is a one-tap toggle (Grid ⇄ Categories), no second panel.
- **Dock click**: closed → open, in the background → focus, focused →
  minimize (next click restores). The search field has the dock's hover lift.
- **Phone**: the round button at the bottom of the home screen opens the app
  switcher (open apps as cards, swipe up to close, tap to open; an empty
  state). It exists only on the home screen. Step 2.3.1: the switcher shows
  only the cards — the "Desktops / Pages" button and the phone pages sheet are
  gone; phone pages are reached by swiping the home screen (and created by
  dragging an icon to the page edge).
- **Widgets**: the Workspaces widget is removed (stored ones are dropped by
  `normalizeLayout`); new **Calculator** widget, 2 × 2 cells, a working mini
  calculator (`shared/mini-calc.ts`, + − × ÷ with precedence, %, ±, ⌫,
  division by zero → "Error"); its title opens the Calculator app (docs/CALCULATOR.md).
  The widget itself loads nothing heavy (no KaTeX, mathjs or OCR).

## Step 2.4

- **PC right-click → View** toggles Grid ⇄ Categories in one tap (no
  submenu), like the phone's brush row; the menu stays open.
- **Double click on the dock's Desktops item** opens the overview of every
  open app on every desktop, grouped by desktop. A card brings the window
  forward on its desktop; × closes the app; Esc or a click outside closes the
  overview. A single click or hover still shows the desktops. The cards show
  the app, not a live picture of the window.
- **New Desktops icon**: the two glass cards from the delivered artwork, cut
  out without redrawing (`public/brand/app-desktops.png`). It is used on the
  PC dock (in a slightly larger box so the wide mark weighs the same as the
  square logos) and on the phone's round button.
- **Lock screen wallpaper** (`appearance.lockWallpaper`, null = as on the
  desktop) with its own image slot (`PUT /api/account/wallpaper?slot=lock`).
  Set in Settings → "Экран блокировки и обои". See docs/LOCK_AND_FACE_ID.md.
- **Settings** redesign: brand line, large title, the profile card, and
  section cards with a line of description ("Приложение", "Безопасность и
  конфиденциальность"). The profile page has personal and account sections
  plus sign-out.
- **Running apps in the PC dock**: an app with an open window (also
  minimized) that isn't pinned shows in the dock after the pinned ones,
  behind a thin divider and in the order it was opened. When its last window
  closes it leaves the dock. Pinned apps always stay. The menu of a running
  icon offers "Закрепить в доке" (it moves to the pinned apps) and "Закрыть".
  Dragging a running icon into the pinned row pins it there. Only pinned
  icons carry `data-dock-app` (the dock order); running-only ones carry
  `data-dock-running`.
