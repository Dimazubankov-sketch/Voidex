# Files and Media (Step 2.7)

Two system apps, preinstalled for every account (existing accounts get them
on their next start; a customised dock is not rewritten):

| App | Package | Window | Source |
| --- | --- | --- | --- |
| **Файлы / Files** (`files`) | `packages/files` | `apps/web/src/apps/files/files-app.tsx` | the portable "Voidex-Files-Claude" module |
| **Медиатека / Media** (`media`) | `packages/media` | `apps/web/src/apps/media/media-app.tsx` | `voidex-module` of "Voidex-Media-Claude-Light" |

Both are lazy chunks (the editors inside them too); their Tailwind classes
come in through `@source` in `apps/web/src/styles/index.css`.

## What is kept from the modules

- **Files**: sections Файлы / Недавние / Избранное / Корзина, folders,
  categories Все / .txt / .prsn / Скачанные / Папки (folders only in Все and
  Папки), grid / list, selection, context menu, the .txt and .prsn editor.
  Only .txt and .prsn. No manual creation: files arrive through
  `FilesAdapter.receive` (e.g. a .txt / .prsn attachment in Vibex or Mail →
  «Открыть в Файлах»). No "Добавить скачанные файлы", no "Доступ по ссылкам".
- **Media**: gallery, collections and albums, search, selection, viewer,
  photo editor, video player and editor, filters, favourites, hidden,
  recently deleted, screenshots, grid / list / mosaic, gestures, pinch and
  Ctrl+wheel density. Files are added inside an album. No global Add, no
  "Не в альбоме", no classification settings.

The modules' own tests run as the package tests (`pnpm test`):
Files `gestures` + `files` (backend reference in `packages/files/reference`),
Media `model`, `gestures`, `editor`, `api`, `zip` (`packages/media/reference`).
The reference backends (Cloudflare / Next) are kept only for those tests and
as a behaviour reference; nothing of them runs in VOIDEX.

## VOIDEX Cloud: not running yet

`apps/web/src/os/cloud/cloud.ts` describes the future cloud: one object
store and **one 5 GB quota per account for Files and Media together**
(`VoidexCloudStorage`: `status`, `put`, `get`, `remove`). Today
`voidexCloud.status().available` is `false` and every operation is refused
(`CloudUnavailableError`). Nothing pretends otherwise:

- no quota bar or "N из 5 ГБ", no "Сохранено / синхронизировано", no
  uploads, no files from other devices, no cloud library;
- Files and Media show «Не сохранено в Облаке VOIDEX: только на этот сеанс»
  and an «Облако VOIDEX» link that opens the one system **Cloud dialog**
  (`VoidexCloudDialog`, also used by the attach chooser);
- what is opened in Files / added in Media lives in memory for this session
  of this account (`os/cloud/session.ts`: `sessionFiles()`,
  `sessionMedia()`), never in browser storage, and is gone after sign-out
  or reload. Media previews are `blob:` URLs (allowed by the CSP).

When the cloud ships, only the adapters change: they keep their objects in
`VoidexCloudStorage`; the apps and the UI stay as they are. No database
tables exist for it yet (no migration in Step 2.7).

## Sharing and attachments

- **VoidexShareDialog** (`os/share/share-dialog.tsx`) is the one share flow
  of Notes, Files and Media: Vibex or VoidOps Mail → real search → people →
  comment → send. Notes adds its own options (Разрешить редактирование, link,
  Users); Files and Media have none and send the **real file** as an
  attachment through the existing safe upload paths (`os/share/send-files.ts`:
  type allow-list, size limits, server-side content checks).
- **«Откуда выбрать?»** (`os/share/attach-source.tsx`): the paperclip in
  Vibex and Mail offers Файлы VOIDEX, Медиатека VOIDEX and С устройства. The
  VOIDEX sources list only what this session really holds and say that the
  cloud is not available when there is nothing; the device is the real file
  picker with the app's own rules.
- `.prsn` (`application/vnd.voidex.prsn+json`) is an allowed attachment
  type; the server accepts it only when the content is a VOIDEX presentation
  (`{ format: "voidex.prsn", version: 1, space }`).

Centred dialogs (share, Users, Cloud, attach chooser) sit in the visual
viewport on phones (above the keyboard, safe-area aware) and are a Radix
layer above the Files editor / Media viewer, so those stay open underneath.
