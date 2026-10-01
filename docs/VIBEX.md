# Vibex — messenger and feed of VOIDEX (Step 2.1)

Vibex is a VOIDEX system app (`AppId "vibex"`, preinstalled, category "communication").
It was built from the Voyzen prototype (Next.js, mock data in `localStorage`): the UI
ideas were kept, everything else was rewritten on the VOIDEX stack — same accounts,
sessions, sync, design tokens, glass, i18n (10 languages) and file storage. The OS is
still called VOIDEX; Vibex is only the app's name.

Not carried over from Voyzen (on purpose): Plus/Premium, Support, Analytics, Monetization,
calls, voice messages, games, polls, groups, mock data, local accounts, the demo SMS code,
placeholder ("coming soon") buttons.

## What a user can do

* **Feed** — everyone's posts and reposts, newest first. Post = text (≤ 2000) and up to 10
  pictures (JPEG/PNG/WebP/GIF, ≤ 10 MB each).
* **Like**, **bookmark** (private: only you see your bookmarks), **share**.
* **Share sheet** (VK-style): search people (your chats first), pick several, add a
  comment → *send in a message*; *on my page* (repost), *copy link* (`/#vibex/post/<id>`
  opens the post in VOIDEX), *to bookmarks*.
* **Reposts** render as the reposter's header + "shared" + the original as a nested card
  (it keeps the original id; likes/bookmarks on a repost apply to the original). One repost
  per person per post; it can be removed.
* **Chats** — direct chats with any VOIDEX user (find them in *People* by name or
  VOIDEX Mail address), text up to 4000 characters, up to 10 files per message (the
  same allow-list as Mail: images, documents, archives, audio/video; no HTML/SVG/
  executables), image previews and a viewer, downloads, read receipts (✓ sent, ✓✓ read),
  unread counters, live delivery and banners.
* **Pinned chats** — pin/unpin from the row menu (right-click / `…` on PC, press-and-hold
  on phones). Press-and-hold a pinned chat to lift it: it scales up with a shadow, the
  other chats fade, the pinned chats slide around it as you drag, and it settles on
  release; the order is saved to the account. Regular chats are never moved by hand —
  their order follows activity.
* **History** — tabs *Liked* and *Bookmarks*; a deleted post shows "Post unavailable".
* **People / profiles** — a person's page with their posts and reposts and a "Message"
  button; *My page* with a composer.

Layouts: PC — side rail (Feed, Chats, People, History, My page, New post), chat list +
conversation side by side. Phones/tablets — glass tab bar, chats and pages slide in
(swipe right to go back), floating "new post" button.

## API (`/api/vibex`, signed-in only)

| Method | Path | |
|---|---|---|
| GET | `/people?q=` | search other active users (name, @handle, address) |
| GET | `/people/:id`, `/people/:id/posts?before=&limit=` | profile, their posts |
| GET | `/chats` | my chats: pinned (my order), then by last activity |
| POST | `/chats/direct` `{userId}` | open (or create) the direct chat |
| PUT | `/chats/pins` `{conversationIds}` | my pinned chats, in order |
| GET | `/chats/:id`, `/chats/:id/messages?before=` | chat, history (newest first) |
| POST | `/chats/:id/messages` `{text, fileIds}` | send |
| POST | `/chats/:id/read` | mark read (read receipts for the other side) |
| POST | `/files?purpose=message\|post` | upload (raw body, name in `X-File-Name`) |
| DELETE | `/files/:id` | discard an unsent upload |
| GET | `/files/:id` | download (`attachment`, `nosniff`, `CSP: sandbox`) |
| GET | `/feed?before=` | feed |
| POST / GET / DELETE | `/posts`, `/posts/:id` | create / read / delete (author only, soft) |
| POST / DELETE | `/posts/:id/like`, `/posts/:id/bookmark`, `/posts/:id/repost` | toggle |
| POST | `/posts/:id/share` `{userIds, text}` | send the post into direct chats |
| GET | `/history?kind=liked\|bookmarks&before=` | liked / bookmarked, newest first |

Cursors are opaque (`before`), pages of 30 by default. Writes have their own rate limits (on top of the global one).
Real time: SSE events `vibex.message` (to both members) and `vibex.chats` (read receipts,
pins).

## Access rules (enforced by `VibexService`, covered by `apps/server/test/vibex.test.ts`)

* Chats and their files: members only (others get 404, as if it didn't exist).
* Uploads are private to the uploader until sent; a file can be attached once, only by its
  owner and only for its purpose (post pictures must be images).
* Post pictures: any signed-in user while the post exists; after deletion only the author.
* Bookmarks are never visible to anyone else; likes are public counts.
* Only the author deletes a post; deletion is soft so reposts, shared messages and history
  can say "Post unavailable".

## Storage

Migration `0004_vibex.sql` (additive, nothing existing changes):
`vibex_conversations` (one direct chat per pair via `direct_key`), `vibex_members` (read
marker, personal pinned position), `vibex_messages`, `vibex_posts` (kind `post`/`repost`,
`repost_of_id`, `deleted_at`), `vibex_files`, `vibex_likes`, `vibex_bookmarks`.

File bytes go to the shared `blobs` table (purpose `vibex`) — the same storage as Mail
attachments and wallpapers. Mail's limits (10 MB / 10 files / 25 MB per message) and its
validation are unchanged; the type allow-list and the content sniffing (`looksLike`, now
in `src/lib/file-types.ts`) are shared. Unsent Vibex uploads older than a day are removed
on the uploader's next upload.

## Code map

* `packages/shared/src/vibex.ts` — limits, DTOs, request schemas.
* `apps/server/src/services/vibex.ts`, `src/routes/vibex.ts`, `drizzle/0004_vibex.sql`.
* `apps/web/src/apps/vibex/` — `vibex-app.tsx` (shell), `chats.tsx` (list, pinned drag,
  conversation, composer), `posts.tsx` (cards, composer), `share-sheet.tsx`,
  `people.tsx` (people, profiles, history), `media.tsx` (previews, viewer, files),
  `data.ts` (queries/mutations), `store.ts` (per-window UI state).
* Brand: `public/brand/vibex-mark.png` (`VibexGlyph`).

## Known limits / next

* Direct chats only (no groups); no message editing/deleting yet.
* No follow graph: the feed shows everyone's posts.
* Files are kept in PostgreSQL (`blobs`), like Mail attachments; moving blobs to object
  storage is a storage-layer change (`BlobStorage` interface) for later.

## Step 2.2 — Voyzen structure on the VOIDEX stack

Architecture stays VOIDEX (accounts, sessions, files, realtime, database); the interface follows
the original Voyzen.

* **Vibex sign-in** (`auth.tsx`): Voyzen's auth card, email + password, **no phone**. It turns
  Vibex on for the signed-in VOIDEX account (`POST /api/vibex/activate`, password checked with the
  normal brute-force protection) — never a second account. Another account's email answers
  `vibex_other_account` and the UI offers to switch. Until activation the API answers
  `vibex_not_activated`; only activated people are found / can be messaged. Migration `0005`
  activates everyone who already used Vibex.
* **Switch account**: through VOIDEX sessions — `POST /api/auth/login` with `replaceSession`
  ends this device's current session once the new one is issued; a device that isn't trusted
  for that account still needs the second factor. The device keeps a list of accounts used on it
  (`lib/known-accounts.ts`, no secrets). One email = one VOIDEX account.
* **Side menu** (`sidebar.tsx`): Vibex mark + name, account card (profile / switch), Home,
  Search, Messages, History (only here), Settings (VOIDEX Settings), Sign out. Collapsible rail on
  PC, drawer from the avatar on phones; phone bottom bar Home · New post · Messages. No dark mode,
  Plus/Premium, Support, Analytics, Monetization, calls, games, polls.
* **Post card**: avatar, name, email · time (· edited), `…` (copy link, bookmark; mine: edit,
  delete; others: not interested, report), text + **Translate** (only when the detected language
  differs from the interface language), media, then ❤ · 💬 · Share.
* **Comments** (`comments.tsx`, `GET/POST /posts/:id/comments`, `DELETE /comments/:id` by the
  comment's or the post's author), **edit** (`PATCH /posts/:id`), **not interested**
  (`POST /posts/:id/hide`, also hides reposts of it), **report** (`POST /posts/:id/report`).
* **Translation** (`POST /posts/:id/translate`): source detected by `detectLanguage` (shared),
  target = reader's language; provider `TRANSLATE_PROVIDER=mymemory|disabled` (default mymemory,
  `TRANSLATE_EMAIL` raises its quota). Provider errors → 503, never fake text. Only visible posts
  are sent, results cached in memory.
* **Live feed**: `vibex.feed` events refresh feeds / posts / comments on every device.
* **Demo data** (dev / test only): `pnpm --filter @voidex/server db:seed:dev [your@voidops.ru]` —
  4 people with posts (pictures), comments, likes, chats. Refuses `NODE_ENV=production`.

Migration `0005_vibex_social.sql` (additive): `vibex_profiles`, `vibex_comments`,
`vibex_hidden_posts`, `vibex_reports`, `vibex_posts.edited_at`.
