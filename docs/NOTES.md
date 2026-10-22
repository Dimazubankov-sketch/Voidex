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

## Step 2.13: pictures in rows, text around pictures, styles, books

- **Block styles**: the toolbar's selector names the current style: Обычный,
  Заголовок, Подзаголовок, Заголовок 2 (new kind `heading2`), Цитата, Код. It applies
  to the paragraph the cursor is in. Headings are `role=heading` with a level.
- **Pictures side by side**: «Рядом с предыдущим» puts a picture beside the one
  before it (blocks with the same `row` id form a row); each takes its share of the
  width (`width` as a weight), small gaps, rows stay rows on phones. Inside a row the
  arrows move left / right; at a row's edge a picture steps out; «Отдельной строкой»
  takes it back to a line of its own. Logic: `layoutBlocks`, `joinRow`, `leaveRow`,
  `moveInPage` in `packages/notes` (tested).
- **Text around a picture**: a picture aligned left or right with «Обтекание текстом»
  (`wrap`) floats; the text blocks after it stand beside it (they are their own
  formatting contexts), never under it; on phones a wrapped picture takes at most
  55 % of the line. The picture's tools sit in a bar above the toolbar so they never
  cover the text.
- **Books** (`kind: "book"`, `.book`): `{ kind: "book", format: "book", pages }`,
  the same pages and blocks as a note, on the same projects, saving (debounced,
  compare-and-swap on `revision`), realtime events, roles, sharing (copy / access),
  revoke and deep links (`#notes/doc/<id>`). No migration: `kind` is text.
  - Editor: the note editor in book mode. A spread (two pages) on wide screens, one
    page on phones; paper with margins, page bounds and numbers; only the pages shown
    are rendered. Pages come only from «+» (Добавить страницу / Добавить разворот /
    delete or clear), never by themselves. ‹ 1–2 / 6 › and ← / → keys. Text sizes
    12 / 14 / 16 / 18 / 20 / 24 / 32 (`size`), bold, italic, lists, pictures (rows,
    wrap), undo / redo.
  - «Чтение» (`book-reader.tsx`): no toolbar, nothing to edit; real headings,
    paragraphs, quotes and lists; arrows, swipe on phones, ← → PageUp PageDown Space
    Home End; optional fullscreen; «Редактирование» goes back. Viewers open books in
    reading mode.
  - Files: «Сохранить в Файлы (.book)» puts the text into Files as a `.book`
    (`{ format: "voidex.book", version: 1, book }`); Files recognises it (filter
    «.book», preview, pages to read). Mail / Vibex accept `.book` attachments, checked
    by content on the server.
  - Store: Notes' description now names books (it is part of Notes, not an app).

## Stage C: presentations — pictures on the whole slide, the canvas

- **Canvas** (`PresentationBody.canvas`, px; absent = 1920×1080 for `rect`, 1080×1080 for `square`):
  the document «…» lists 16:9, 4:3, 9:16, 1:1 (the current one shows its pixels) and «Свой размер…»
  (64–8192 px, proportions up to 8:1). `format` stays in step (`square` iff the canvas is square), so
  older apps still read a presentation as 16:9 / 1:1. No migration: the field is optional.
- **Changing the canvas** (`setCanvas`, `canvasChangeImpact` in `packages/notes/src/slides.ts`):
  pictures keep their own proportions and place, a filling picture keeps filling, text boxes keep
  their text. When a picture would have to shrink to stay whole or text would no longer fit, it asks
  first; nothing is cut and Undo brings it back.
- **Picture menu** (the «…» on a selected picture, nothing else added): Вписать целиком, Заполнить
  слайд (`fit: "cover"`, cropped on screen only, the file is untouched), Исходные пропорции (shown when
  they are off), Холст по изображению (the canvas takes the picture's proportions, long side ≤ 1920 px,
  and the picture fills it), and the picture's own pixels and the canvas size. New pictures keep their
  proportions (`ratio`, `px` saved when added; older ones are measured when shown).
- **Invisible grid**: pictures move and resize on a 2.5 % grid (nothing drawn), keep their proportions
  while resized and stay on the slide.

## Stage D: text and pictures in one flow (ordinary notes)

Model: `packages/notes/src/flow.ts` (pure, tested, fuzzed). Rendering and gestures:
`apps/web/src/apps/notes/flow-view.tsx`; the editor glue is `note-editor.tsx`.

- **Rows.** Blocks sharing a `row` id form a row: pictures of one size — 100 % (one), 50 % (two) or
  25 % (four) — and at most one text column taking the rest of the line (≥ 25 %), about one character
  (`--vn2-gap`) between text and picture. Overfull lines carry on below in order. A picture alone at
  50 / 25 % leaves the rest of its line as a place to write (a tap there starts the text column).
- **Sizes** (D4): only 100 / 50 / 25 %. «Масштаб»: drag sideways, the corner or two fingers; on release it
  settles on the nearest size (a badge shows it while sizing). The old 25 / 50 / 75 / «Во всю», alignment,
  wrap and up / down buttons are gone.
- **Panel** (D9, above the toolbar): Передвижение / Масштаб (remembered per picture: `tool`), Формат (rows
  of 50 / 25 % and carousels: square → portrait → landscape for all of them), carousel on / off, ← → (only
  with a neighbour), picture ⇄ text (only beside the text column), delete.
- **Display** (D8): 100 % keeps the picture's proportions; 50 % shows it whole in the row's frame (soft
  empty sides); 25 % fills the frame (cropped preview only; the file is untouched). A long press shows the
  whole picture.
- **Gestures**: a picture that isn't chosen lets the page scroll; tap chooses it; long press previews.
  Chosen + Передвижение: a drag lifts it (scale ~1.035, soft shadow, its place faded until the drop),
  holding still previews. Chosen + Масштаб: drags size it. Drop places: a line above / below a block,
  beside a picture or the text column (when it fits, taking the row's size), onto a picture (a carousel).
  Only a thin mark shows the place; no grid is drawn. Near the top / the toolbar the note scrolls.
- **Insert** (D1): new pictures go where the cursor was (the paragraph splits at the caret), 100 % each;
  with a carousel picture chosen they join that carousel next to it and scroll into view.
- **Carousels** (D7): «Добавить карусель» or a picture dropped onto another; one carousel per row;
  pictures stay separate with the same gap; swipe on phones, arrows on PC (one picture per step); any
  number of pictures (100 / size in view). «Убрать карусель» keeps every picture: the ones in view form a
  row, the others go into rows before / after in order.
- **Compatibility**: older notes (widths 10–100 %, left / right pictures with text around them, rows of
  four) are brought into the model by `normalizeBlocks` when shown and on edit — nothing is lost and no
  migration step runs; the stored form changes only with the next edit. New fields (`carousel`, `tool`)
  are optional; older apps ignore them and show the pictures as before.
