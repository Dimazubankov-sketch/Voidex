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
 ├── desktop      virtual desktops (max 6) with their icons; columns 3–8, density,
 │                view grid | categories, order manual | by name
 ├── categories   the user's own category per app (default: the app manifest)
 ├── names        the user's own icon label per app
 └── appearance   wallpaper (default white | colour | gradient | preset | own image),
                  label colour (auto/dark/light), label size, captions
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

## Code map (web)

| File | What |
| --- | --- |
| `os/home/home-screen.tsx` | the home screen: header (clock / brush / ✓ / … / 9 dots), phone pager, PC grid & categories, desktop tabs |
| `os/home/gestures.ts` | one pointer engine for touch and mouse: long press, drag & drop, folders, page edges, pull-down search, right click |
| `os/home/icons.tsx` | app / folder icons, wiggle, edit badges, drag ghost |
| `os/home/folder-overlay.tsx` | open folder: rename, reorder, drag out |
| `os/home/context-menu.tsx` | right-click / long-press menus with sub-menus |
| `os/home/appearance-panel.tsx` | wallpaper, text, arrangement, view — used by the brush and by Settings → Рабочий стол |
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
