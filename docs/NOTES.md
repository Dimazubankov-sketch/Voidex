# Voidex Notes (Step 2.5)

Voidex Notes is a system app (`notes`, category Work) built from the
delivered package `packages/notes` (Voidex-Notes-Claude-Light). It runs
natively in a VOIDEX window: no iframe, no second React root, its own lazy
chunk (`apps/web/src/apps/notes/notes-app.tsx`), so the shell does not load it
until Notes is opened.

## What changed in the package

The editor was kept; changes are small and marked `VOIDEX` in the code:

| Change | Why |
|---|---|
| Sources formatted with Prettier (commit "as delivered") | reviewable diffs |
| `NotesAdapter.media(src)` and `MediaContext` | images are private; they are read with the session and shown from object URLs (also in HTML / JSON export) |
| `NotesConflictError` + conflict dialog | a save refused with 409 offers: keep both / mine / theirs — never a silent overwrite |
| `remoteRevision` | a save from another device is shown when nothing here is unsaved |
| `controllerRef` (`isDirty`, `flush`) | the window asks before closing with unsaved changes |
| `share`, `shareLink`, `headerEnd` props | deep link `#notes/share/<token>`, window menu in the header |
| Page breaks (continuous sheet) | insert after a block, move up / down, remove (pages join) |
| "Разбить на страницы" toolbar toggle | paged view of the same pages |
| Image sizes S / M / L / full, align left / centre / right in the selection bar; paste / drop insert after the selected block; 12-column grid only while an image is selected | |
| Media path `/api/notes/media?id=<uuid>` | the Notes API of VOIDEX |
| UI kit: `z-[160]` portals, VOIDEX tokens, no `next-themes` | stays above windows, follows light / dark |
| Strict-mode TypeScript fixes | the web app's compiler settings |

The model (projects → spaces → pages → blocks), presentations, formats,
flows, transitions, presenter / teleprompter, speaker notes, undo / redo
(40 steps), JSON import / export and HTML export are unchanged.

## Continuous and paged

A note is one continuous sheet by default (`paged: false`). Its pages are
still stored as pages; in the sheet the boundary between two pages is a
"page break" with three controls: move it up (the last block before it goes
below), down (the first block after it goes above), remove (the two pages
join; speaker notes are joined too). "Разрыв страницы после блока" splits
the page after the selected block. Turning on "Разбить на страницы" shows the
same boundaries as separate pages. Nothing is dropped in either direction.

## Backend (`/api/notes`, signed-in only)

| Route | |
|---|---|
| `GET /api/notes` | `{ data, revision }` of the signed-in account (empty workspace, revision 0 the first time) |
| `PUT /api/notes` | `{ data, revision }` → `{ revision }`; 409 `notes_conflict` (details.revision) when another device saved first; 8 MB limit; the document is validated (`validNotesWorkspace`) |
| `POST /api/notes/media` | image bytes → `{ url }`; JPEG / PNG / WebP / GIF by content, ≤ 12 MB, SVG refused |
| `GET /api/notes/media?id=` | the owner, or any signed-in user when one of the owner's shares shows that image |
| `POST /api/notes/shares` | a space or project → `{ token }` (24 random bytes, base64url); speaker notes removed on the server |
| `GET /api/notes/shares` | my links `{ token, name, created }` |
| `GET /api/notes/shares/:token` | the snapshot (any signed-in user with the link) |
| `DELETE /api/notes/shares/:token` | owner only (404 for anyone else) |

The user id always comes from the session. Tables (migration
`0008_notes_vibex_views.sql`): `notes_workspaces`, `notes_media` (bytes in
`blobs`, purpose `notes`), `notes_shares`. Tests: `apps/server/test/notes.test.ts`
(isolation between accounts, CAS, image types, share snapshots, speaker notes,
revoking).

## Limits

- The editor's interface text is Russian (as delivered).
- Images that are no longer referenced are not garbage-collected yet.
- A shared link needs a VOIDEX sign-in (VOIDEX is closed); the downloaded HTML
  file opens anywhere.
