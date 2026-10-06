# Voidex Notes (Step 2.6)

Notes is a system app (`notes`, category Work), written as VOIDEX screens in
`apps/web/src/apps/notes` (its own lazy chunk; the editor is a second lazy
chunk). `packages/notes` keeps only pure, tested document logic (pages,
formats, Note → Presentation, slide reflow). Step 2.5's delivered UI with
spaces, Prompter, note backgrounds and HTML export is gone.

## Model

```
Project (cover, name, owner, position)
 └─ Document  kind = note | presentation  (name, cover, format, data, revision, position)
```

Tables (migration `0009_notes_projects_sharing.sql`, additive):
`notes_projects`, `notes_documents`, `notes_members`, `notes_prefs`; extended
`notes_shares`; `notes_workspaces.migrated_at`; `vibex_messages.notes_card`,
`mail_messages.notes_cards`.

- **Note body**: `{ kind: "note", format: "vertical" | "square", pages: [{ id, blocks }] }`.
  Blocks: text, heading, subheading, quote, checklist, bullet, code, image
  (`src`, `width` 10–100 %, `align`). One page = one continuous sheet of
  unlimited length.
- **Presentation body**: `{ kind: "presentation", format: "rect" | "square", slides: [{ id, transition, layers }] }`.
  Layers (title / text / image) are placed in % of the slide, so they reflow
  between 16:9 and 1:1.

### Migration from Step 2.5

The old workspace JSON (projects → spaces) is converted lazily and once, the
first time its owner opens Notes (`ensureMigrated`, guarded by
`migrated_at`): every space becomes a document of its project, keeping
order, content, images, revisions; name collisions become "Идеи (2)"; old
share snapshots keep working. The old JSON stays untouched (no DROP).

## Screens

- **Projects** — grid or list (cover, name, file count, last change), sort:
  custom (drag on PC, "Move up / down" on touch), modified, created, name —
  remembered on the server (`notes_prefs`). "Доступно мне" lists documents
  shared on their own.
- **Project** — its notes (`.txt`) and presentations (`.prsn`).
- **Bottom bar** — search (context: projects or documents) and the one "+"
  (new project / new note or presentation). Phone safe-area aware.
- The Notes logo has a fixed place in browser headers; Back has its own slot
  and never moves it. Editors have no logo, only floating controls.
- **Cover and name** sheet (like the Photos album sheet): JPEG / PNG / WebP,
  downscaled before upload; without a picture a generated cover is shown.

The route lives in its own store (`route.ts`). Step 2.5's "thrown back to
Projects" came from `useT()` returning a new function every render: the
adapter was rebuilt, the loading effect re-ran and reset the route. Nothing
that loads data depends on render identity now; an e2e test guards it.

## Editor

Clean paper (no frames, grid or backgrounds), a minimal toolbar (style,
list, checklist, picture, bold, italic) that rides above the phone keyboard.
Markdown shortcuts: `# `, `## `, `- `, `[] `, `> `, ```` ``` ````.

- **Vertical**: portrait sheets downwards. **Square**: square pages sideways,
  text flows on to the next page by itself, the wheel scrolls sideways.
  Switching keeps everything.
- **Pages**: no page-break button. "+" → New page / Split here / Delete page.
  Step 2.7: a page after the first is deleted with its content (asking first
  when it has any) and the page before it is shown; the first page is
  cleared instead ("Очистить страницу"), whether or not others follow.
  Backspace in an empty page still joins it to the previous one.
  ‹ 2 / 6 › navigation.
- **Pictures**: upload, paste, drop; resize by the corner or 25/50/75/100 %;
  align; move; remove. Shown from object URLs (images are private).
- **Saving**: debounced, compare-and-swap on `revision`. A save that finds a
  newer revision shows a banner (load theirs / keep mine) — never a silent
  overwrite. Remote saves apply live while nothing is unsaved.
- **Presentations**: sidebar Slides / Layers / Transitions; drag and resize
  layers; transitions None / Fade / Slide / Scale with preview (reduced motion
  respected); 16:9 ↔ 1:1 with an overflow warning; fullscreen show (arrows,
  swipe, Esc). "Превратить в презентацию" makes a new `.prsn`, the note stays.

## Sharing

Only the owner shares. Roles: owner, editor, viewer.

- **Copy** (default): a snapshot at share time; the recipient adds their own
  independent copy ("Полученные").
- **Разрешить редактирование**: access to the original as Editor; the owner
  switches Viewer ↔ Editor or removes people in **Пользователи**.
- Removing someone or deleting the original closes it on their devices at
  once ("Доступ ограничен — Владелец больше не предоставляет вам доступ…");
  the server refuses their reads and writes.
- Share sheet (the common VoidexShareDialog since Step 2.7): search, then
  **Vibex** or **Почта VoidOps**, then people; copy link; Users. Centred on
  phones too. It arrives as a file card **Name.txt** (notes, projects) or
  **Name.prsn** (presentations). Tapping a card opens Notes and resolves the
  link. Cards are built as files (`NotesCardDto`) so download / cloud / Files
  can be added later.
- Tokens are random, unguessable, revocable (`notes_shares.revoked_at`).

Deep links (sign-in and access still required): `#notes/project/<id>`,
`#notes/doc/<id>`, `#notes/share/<token>`.

## Events (no polling)

`notes.document.updated`, `notes.access.revoked`, `notes.resource.deleted`,
`notes.share.updated`, `notes.projects.changed`.

## API

`/api/notes/projects` (GET, POST), `/projects/:id` (GET, PATCH, DELETE),
`/projects/:id/documents` (POST), `/documents/:id` (GET, PUT body+revision,
PATCH name/cover/position, DELETE), `/access/:type/:id` (members),
`/access/:type/:id/:userId` (PATCH role, DELETE), `/access/:type/:id/links`,
`/shares` (POST), `/shares/:token` (GET, DELETE), `/shares/:token/accept`,
`/prefs` (GET, PUT), `/media` (POST, GET `?id=`).

## Tests

`packages/notes/test`, `packages/shared/src/notes.test.ts`,
`apps/server/test/notes.test.ts`, `apps/web/e2e/step26-notes.spec.ts`.
