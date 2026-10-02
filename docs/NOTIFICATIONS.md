# VOIDEX Notification Center (Step 2.3)

One notification model for every app. A notification belongs to one VOIDEX
account and comes from an app or from the system.

## Model

`notifications` table (migration 0006):

| column     | meaning                                                                 |
|------------|-------------------------------------------------------------------------|
| `app`      | `mail` · `vibex` · `system`                                             |
| `type`     | registered per app in `packages/shared/src/notifications.ts`            |
| `title`    | who / what (sender name, "VOIDEX 2.3")                                  |
| `body`     | preview (subject, message snippet); hidden in the UI when "show preview" is off |
| `actor_id` | the person who caused it (avatar in the card)                           |
| `target`   | what a tap opens: `{ threadId }`, `{ chatId }`, `{ postId, commentId }`, `{ userId }`, `{ version }` |
| `read_at`  | null = unread                                                           |

Registered types (`NOTIFICATION_SOURCES`):

- **mail** — `mail.new` (a letter from another VOIDEX user → Mail, that thread)
- **vibex** — `vibex.message` (one unread card per chat, updated by new messages),
  `vibex.comment`, `vibex.reply`, `vibex.like`, `vibex.follow`; each can be
  switched off in Vibex Settings → Notifications
- **system** — `system.update` (VOIDEX update notice; operators send it with
  `pnpm --filter @voidex/server notify:update "<title>" "<text>" [version] [user-id]`,
  there is no auto-update backend; `POST /api/notifications/dev/system-update`
  exists only outside production for tests)

Adding a source: its types in `NOTIFICATION_SOURCES`, a `notify()` call where
the event happens (best effort — `tryNotify` never breaks the action), and a
renderer (icon, action text, what a tap opens) in
`apps/web/src/os/notifications/center.tsx`.

## Delivery

`NotificationService.notify` stores the row and pushes `notification.new` over
the account's Server-Sent Events stream to every device; read / clear on one
device sends `notifications.changed` to the others. The client fetches the list
once when the workspace starts (`GET /api/notifications`) and then only merges
live events — no polling. At most 200 notifications are kept per account.

API (signed-in only, always the caller's own list): `GET /api/notifications`,
`POST /api/notifications/:id/read`, `POST /api/notifications/read-all`,
`DELETE /api/notifications/:id`, `DELETE /api/notifications`.

## UI

- **Phone**: a glass sheet pulled down from the very top edge (safe area +
  28 px), on the home screen and inside apps. It follows the finger, opens past
  ~28 % (or a fast flick), closes with a swipe up on its handle or a tap on the
  dimmed area. Cards swipe sideways to remove.
- **PC**: the bell in the system bar opens a right-side glass panel
  (≤ 400 px) between the system bar and the dock; Esc / click outside closes it.
- Each card: app / actor, time, title, action line, preview, unread dot;
  "Read all", "Clear", remove one; a tap marks it read and opens the context.

## Gesture priority (phones)

One rule decides who owns a touch (see `os/notifications/gesture.ts`):

1. starts in the **top edge zone** and moves down → Notification Center;
2. starts in the **left edge zone** inside an app with a side menu (Vibex) and
   moves right → that side menu;
3. anything else → the surface below: home pages, pull-down search, icon drag,
   or the app's own scroll / media swipes.

Edge gestures engage only after a clear move in their direction (12 px and
dominant axis), then block page scrolling for that touch and swallow the
following click; pointer cancel resets them.
