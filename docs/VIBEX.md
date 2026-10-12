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
* Brand: `public/brand/app-vibex.png` (`VibexGlyph`).

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

## Step 2.3 — one identity, profile, follows, threads, media, recordings

- **Account model**: one VOIDEX account = one Vibex profile, created on first
  use. No Vibex sign-in, no account switching, no second identity; the session
  is the identity. `POST /api/vibex/activate` remains as a no-op answering like
  `/me` for older clients. People search lists every active VOIDEX account.
- **Profile** (`vibex_profiles`: bio, website, city, cover, settings): editor in
  the Voyzen layout; names are the VOIDEX account's (`PATCH /vibex/profile`
  forwards them to the account), the avatar is the VOIDEX avatar. Avatar and
  cover go through the fullscreen "Adjust photo" editor (`photo-editor.tsx`:
  round / wide mask, drag, pinch / wheel / slider zoom, rotate); the visible
  crop is rendered to a JPEG and uploaded (no crop metadata to keep in sync).
- **Follows** (`vibex_follows`): follow / unfollow, counters, followers /
  following lists, "follows you".
- **Settings** (Vibex's own screen, `vibex_profiles.settings`): who can write
  (everyone / followers / nobody), who sees the profile details and the posts
  (everyone / followers), read receipts (both ways), blocked people (no
  messages, no follow); which notifications are sent; media autoplay and
  quality preference. Enforced by `VibexService`.
- **Profile tabs**: Posts · Reposts · Photo / Video (Photo | Video), built from
  the person's posts automatically (`GET /people/:id/media`); posts can carry
  videos (mp4 / webm / mov, ≤ 25 MB). Media viewer: swipe (phone), arrows and
  keyboard (PC), no author caption.
- **Comments**: TikTok-style threads — `root_id`, `reply_to_id`,
  `reply_to_user_id`; every reply belongs to one top-level comment, shows
  "@name" when it answers another reply; "View replies (N)" / hide.
- **Chats**: replies (quote), voice messages and video circles recorded with
  MediaRecorder (purposes `voice` / `circle`, type and size checked server
  side, circles ≤ 60 s), pinned chats as before.
- **Calls**: audio / video buttons and a sheet that says calls are not
  available yet — there is no signalling / TURN infrastructure, and no call is
  ever faked. The data model and the UI hook (`calls.tsx`) are the foundation.
- **Notifications**: message (one card per chat), comment, reply, like, follow →
  Notification Center (docs/NOTIFICATIONS.md); a tap opens the chat, the post
  with its comments or the profile.
- **Side menu**: Home, My page, Messages, Search, Bookmarks, History | Settings;
  left-edge swipe opens it on phones.
- **Demo data** — development / test only: `pnpm seed:vibex-demo [address]`
  (same as `pnpm --filter @voidex/server db:seed:dev [address]`). Code:
  `apps/server/src/db/demo-seed.ts` (`seedVibexDemo()`, covered by
  `test/demo-seed.test.ts`), CLI `seed-dev.ts`. It refuses to run in
  production twice over: the CLI exits on `NODE_ENV=production`, and the
  function throws on a production config. Nothing in the deploy pipeline runs it.
  - Demo people: Алина, Марк, Sofia, Тимур (Step 2.2), Demo Anna / Alex / Mia
    (avatars, covers, details); password `Demo-Vibex-2026`.
  - Feed: short and long posts, posts with one and several pictures, a repost,
    a post with many comments and reply threads, likes, follows.
  - Chats: read and unread (several messages), pinned, a reply, a picture, a
    file, a voice message.
  - With `address`: that account gets its own set — a pinned chat with a reply
    thread, a read chat, unread chats (one with a picture and a file), follows
    and a comment of its own with an answer.
  - Idempotent: each block runs once (new accounts, a marker post / message);
    re-running adds nothing. An unknown address is reported, not created.
    Video posts are not seeded (no sample video is generated).

## Step 2.4 — group chats

- **Pencil button** on the chat list (a round button, like the feed's "+"):
  "New chat". Pick one person → a direct chat, the same as before. Pick
  several (up to 49) → name the group (required, ≤ 64 characters), add an
  optional picture (JPEG / PNG / WebP, a Vibex file of purpose `group`,
  readable by members only), then "Начать чат".
- Server: conversation kind `group` with `title`, `avatar_file_id`,
  `created_by`; member `role` owner / member. `POST /api/vibex/groups`,
  `PATCH /api/vibex/groups/:id` (creator only: name, picture),
  `POST /api/vibex/groups/:id/leave` (the creator's role passes on; the last
  one out removes the group). Adding someone respects their "who can message
  me" setting (403 with the person's id). `VibexChatDto.peer` is `null` for
  groups; `group` carries title, picture, members and my role.
- In the chat: the group's picture or initials, "Участники: N", the sender's
  name above the first bubble of a run, and a group sheet (members, rename and
  picture for the creator, leave). No calls in groups.
- Notifications: `vibex.group` ("Добавил(а) вас в группу") when added; group
  messages show the group name and "Sender: text".
- Fix: the phone tab bar (and the chat / mail composers) added the iPhone
  safe area a second time inside a window that already keeps it below the
  app. The tab bar was squeezed, and its icons crossed the divider.

## Step 2.5 — deleting messages, voice player, circles, views

- **Delete my message** (`DELETE /api/vibex/messages/:id`): text, files,
  voice and circles. Sender only (others: 403; non-members: 404). The text
  and files are removed for good; the message stays as "Сообщение удалено"
  so replies keep their place (their quote shows the placeholder). Members
  get `vibex.message.deleted`; the message's notifications are removed.
  Column `vibex_messages.deleted_at` (migration 0008).
- **Voice player**: play / pause, progress on the waveform, drag and
  keyboard seeking, duration; one voice message or circle plays at a time;
  an unplayed dot until listened to (remembered on the device).
- **Video circles**: the composer button has its own glyph (a round message
  with its progress ring — not a camera). The front camera is used first;
  with a second camera a switch button appears. Switching drops the
  unfinished clip, releases the old tracks and starts again.
- **Post views** (`POST /api/vibex/views { postIds }`): unique signed-in
  viewers (`vibex_post_views`), never the author; a post counts once it was
  half on screen for a second. `VibexPostDto.views`.
- **Action row**: like · comment · share as icon + number (0 shown), equal
  columns; views (eye) apart on the right. `shares` = reposts + sends into
  chats. The share button is an icon only ("Поделиться" for screen readers).

## Voice and circle playback under the CSP (Step 2.6)

Recordings are read with the session and played from `blob:` object URLs.
The page's Content-Security-Policy (Helmet, served with `index.html`) must
therefore allow `media-src 'self' blob:` and `connect-src 'self' blob:` (the
waveform reads the same blob). Before Step 2.6 there was no `media-src`, so
production fell back to `default-src 'self'` and refused to play; the dev
server sends no CSP, which hid it. `apps/server/test/csp.test.ts` asserts the
policy; `apps/web/e2e/step26-media.spec.ts` serves the app with the server's
real policy and plays a real recording for sender and recipient.

## Step 2.9: chats, stories, circles, recorder

- **Name**: «Сообщения» is «Чаты» everywhere (navigation, headings,
  translations, aria labels, search keywords).
- **Sections** (`chatSections(list, order)` in `packages/shared/src/vibex.ts`):
  «Закреплённые» always first, then «Чаты» and «Группы». The filter button
  (`chat-filter`) offers Чаты сверху / Группы сверху / Вперемешку; the choice
  is the account setting `settings.chats.order` (default `chats-first`).
- **Search** (`GET /api/vibex/chats/search?q=`): chat and person names,
  addresses in both spellings (`@voidops` / `@voidops.ru`), group titles and
  message text (plain substring over the caller's own conversations,
  respecting `cleared_at`). On phones it appears with a light pull on the list.
- **Long press (phone) / right click (PC)**: Открыть, Предпросмотр,
  Уведомления вкл/выкл, Закрепить, Профиль, Удалить. On PC the preview opens
  only after choosing Предпросмотр. Delete expands in place into
  «Удалить у себя» and, when allowed, «Удалить у всех».
- **Preview never reads**: `GET /chats/:id/messages` never marks anything
  read (reading is the explicit `POST /chats/:id/read`); the preview simply
  does not send it. e2e checks the unread count before and after.
- **Mute** (`PATCH /api/vibex/chats/:id { muted }`, `vibex_members.muted`):
  no notification and no banner; the unread badge turns grey.
- **Delete** (`POST /api/vibex/chats/:id/delete { scope }`):
  - `me`: `cleared_at` + `hidden` for the caller only; earlier messages
    disappear for them; a new message unhides the chat.
  - `all`: a direct chat (either member) or a group (owner only, others
    403). The conversation, its messages and files are removed for everyone.
- **Stories** (migration 0010: `vibex_stories`, `vibex_story_views`):
  - each story lives 24 hours (`VIBEX_STORY_TTL_MS`), then stays in the
    author's archive (`GET /stories/archive`);
  - `GET /stories` returns groups for me, people I follow and my direct-chat
    partners, under their posts privacy; mine first, then unseen;
  - `POST /stories { fileId }` takes a photo or video uploaded with
    purpose `story` (VOIDEX Media or the device); `POST /stories/:id/view`,
    `GET /stories/:id/viewers` (owner only), `DELETE /stories/:id`;
  - the chat header shows stacked avatars when collapsed; pulling further
    expands the row with «Моя история» (+);
  - the viewer has progress bars, tap left / right, swipe down to close,
    hold to pause, a viewers list for my own stories.
  - No fake stories are seeded in production.
- **Video circles** (`circle-player.tsx`):
  - In the chat a circle plays muted and looped, but only while it is on
    screen (IntersectionObserver); it loads with `preload="metadata"`.
  - Tapping it opens the expanded player with sound. That player has:
    - a progress ring that can be dragged to seek;
    - a collapse X to the left of the ring;
    - a speed button cycling 1x, 1.5x, 2x (kept in the Vibex store while the
      app is open);
    - tap to play or pause.
  - Starting it pauses any other sound (`takeOver`).
- **One record button** (`record-button.tsx`), state machine idle → holding
  → recording → cancel / locked → sending:
  - **Phone**:
    - a quick tap switches between voice and circle;
    - holding records;
    - releasing sends a clip of at least 0.6 s;
    - sliding left past 130 px cancels;
    - sliding up past 96 px locks the recording, and then send and trash
      buttons appear.
  - **PC**: holding the button or right-clicking it switches the mode; a
    click starts a locked recording with trash on the left and send on the
    right. Releasing the mouse never sends.
  - The recorder stops every track and closes its audio context on cancel,
    send and unmount.
- **Gesture ownership**: elements marked `data-gesture-owner` (the voice
  waveform, the circle ring, the carousel) keep their drags. The chat
  swipe-back (`SlidePage`, `edge-swipe.ts`) does not start on them; it stays
  on everywhere else.
- **Feed and profile**:
  - The feed search is a round button that expands in place into the field;
    its X collapses it.
  - A floating + (new post) appears on the phone feed and profile.
  - «Закладки» moved into «История» (tabs Понравившиеся / Закладки); the
    stored bookmarks are unchanged.
  - The composer has a Media button (VOIDEX Media or the device) and a
    paperclip for Files / ViCloud only (purpose `postfile`), with no
    arbitrary device files.
  - Profile tabs: Публикации (one grid of photos and videos with a mark;
    `GET /people/:id/publications`), Посты, Репосты. A publication opens with
    its text folded under «Показать текст»: it is the same post, nothing is
    duplicated.
  - Photo carousel: three slides rendered at a time, the index wraps
    (`wrapIndex`), touch and mouse drag, arrows and a counter.
- **Desktop**: a two-column layout, with the chat list at
  `clamp(300px, 30%, 360px)` and the conversation beside it.

## Step 2.10: gestures, chats, message actions, circles, Search and Notifications

### Shell

- **Phone gesture bar** (`os/gesture-bar.ts`, `os/window-frame.tsx`). The app follows the finger and shrinks progressively.
  - **Decision** (`gestureBarAction`):
    - a small move (< 48 px) puts the app back;
    - dragging high (> 40 % of the screen) or a quick flick (> 1400 px/s) goes home;
    - anything in between (a short smooth swipe, or held in the middle) glides into the switcher;
    - sideways switches apps.
  - **Fixed x**: every window binds its own transform and resets it to 0 whenever it is not under the finger. The shared `barDrag` values also keep a permanent observer: motion stops an animation nobody listens to, which used to freeze the app 1-2 px sideways after the switcher.
- **Gesture priority** (`os/gesture-priority.ts`), highest first:
  1. circle seek;
  2. voice seek;
  3. swipe to reply;
  4. chat scroll;
  5. chat swipe back;
  6. gesture bar.

  Owners mark their element `data-gesture-owner`. `mayStart()` / `ownedByChild()` are used by swipe-to-reply, `SlidePage` and the edge swipe.
- **Shared UI**:
  - `ui/edge-swipe.ts`: a swipe to the right that pulls a `PushDrawer` (Vibex and Mail). It may start anywhere on the screen, not only at the left edge. These stay out:
    - the top edge (Notification Center);
    - players and carousels (`data-gesture-owner`);
    - sideways scrollers (the stories strip);
    - text fields;
    - a pinned chat lifted to reorder;
    - moves that are not clearly horizontal.

    The main screens' vertical lists are `touch-action: pan-y`, so the browser leaves sideways moves to the page.
  - **PushDrawer**: while the menu is out, the screen's contents fade to 50 % opacity; its background colour does not change.
  - `ui/expanding-search.tsx`: the round search button that grows into the field (Vibex feed and Mail).

### Chats

- The header starts folded on phones and PC.
  - A pull, or a wheel up at the top, opens one level at a time: first the search, then the stories.
  - Scrolling, pushing up, or a wheel down folds it again.
- The pencil creates a group (one person or more). A private chat starts from the chat search, a profile or a shared post.
- Chats are separate rounded cards on the `--chat-card` token:
  - grey on a white app or the PC column;
  - white on the grey or violet looks;
  - dark in the dark look.
- **Preview** (long press, or right click → Предпросмотр):
  - not full screen, and the whole history scrolls;
  - nothing is read: no read receipt and no `lastReadAt` change (server and e2e A/B tests);
  - a tap on a message or a control opens the real chat;
  - there is no «Открыть» item.

### Messages

Long press (phones) or right click (PC) opens the actions. The chat dims and the message stays lifted in place.

- **Actions**: Ответить, Скопировать, Редактировать (mine, text), Закрепить (direct chats: both people; groups: the owner), Переслать, Удалить, Выбрать.
- **Delete**:
  - «Удалить у себя» works on any message (`vibex_message_hides`).
  - «Удалить у всех» works on my own messages only, checked per message; a batch with someone else's message is refused.
- **Multi-select**: round selectors; the composer becomes Переслать / Удалить / Закрыть.
- **Swipe left to reply**: a finger gesture with a threshold and a tick. PC replies from the hover button or the menu.
- **API**:
  - `PATCH /messages/:id`
  - `POST /messages/delete {ids, scope}`
  - `POST /messages/forward {messageIds, conversationIds}`: copies, with their own files, showing «Переслано от …».
  - `PUT /chats/:id/pin {messageId|null}`
- **Events**: `vibex.message.updated`.

### Video circles

- **Recording** (`circle-camera.ts`):
  - A MediaRecorder records a canvas fed by the current camera, plus the microphone. A camera switch only swaps the feed: one file, and the timer goes on.
  - Pause and resume are supported; the time counts only what was recorded.
  - Zoom is the camera's own `zoom` constraint, from max(1, min). It is hidden when the camera has none.
- **While recording**: the composer stays, with «Отмена» in its middle, and the camera covers only the chat above it.
- **Player**: opens in place in the chat.
  - X sits on the right of the ring.
  - A tap on the video plays or pauses.
  - Speed and ring seek are kept.
  - It closes at the end.

### Search and Notifications tabs

- **Phone bar**: Главная | Поиск | Уведомления | Чаты | Профиль. Below 380 px only the icons show (labels stay for screen readers).
- **Search** (`search-tab.tsx`): a large field.
  - **Empty field**: a lazy grid of everyone's public photo and video posts (`GET /explore`).
  - **Query**: accounts first (exact @username or address, then names), then posts by text or `#tag` (`GET /search`).
- **Notifications** (`activity-tab.tsx`): `vibex_activity` holds follow, like, repost, comment, reply, group, a followed person's post and their story.
  - **Grouping**: Актуальное / Вчера / Последние 7 дней / Более ранние.
  - **Each item**: avatars (likes of one post are grouped), text, relative time, and a thumbnail or Подписаться / Сообщение.
  - **Read state**:
    - Opening the tab reads everything on the server.
    - The badge is live through `vibex.activity`, never polled.
  - Undoing a like, follow or repost removes its item.
  - This tab is separate from the system Notification Center.
- **Migration** `0011_vibex_message_actions_activity` is additive only.
