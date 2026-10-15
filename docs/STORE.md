# Appex Store (Steps 2.11, 2.12)

Appex Store is the VOIDEX app catalog, a native app of the shell (`apps/web/src/apps/store`).
It was adapted from the delivered static prototype: no iframe, no separate sign-in,
no backend of its own. It uses the VOIDEX session and API.

## Catalog
- The list is the App Registry (`packages/shared/src/apps.ts`): every registered,
  available app except the Store itself and Settings. Nothing is made up; apps that
  are not registered (Camera, Weather, Clock, Calls, Calendar) do not appear.
- The Store's own words (subtitle, description, features, what is new) are i18n keys
  in `apps/store/catalog.ts`; the carousel and the collections only use registry apps.
- Screenshots are real: `tools/store-screens/store-screens.spec.ts` (development only,
  `playwright.screens.config.ts`) opens each app on the local stack with fresh test
  accounts and made-up content and saves JPEGs to `public/store/screens`. They are
  shipped as static files; nothing is seeded in production.
- Step 2.12: `screenshots: { phone, desktop }` per app, three of each
  (`<app>-phone-N.jpg` at 390 x 844, `<app>-desktop-N.jpg` at 1440 x 900). A phone
  shows only phone shots, a computer only desktop shots (no switch).

## Install / open / update
- State per account: on the desktop and current = «Открыть»; an older version recorded
  in `installed_apps` = «Обновить»; removed from the desktop = «Загрузить»; while it
  works «Установка...» / «Обновление...». The state comes from the server, so it
  survives a reload and is the same on every device.
- Install / update downloads the app's code (its lazy chunk), then
  `POST /api/store/apps/:id/install` records the registry version, then the app goes
  back on the desktop and the launcher. The browser reports no percent for a code
  download, so the button shows a spinner, never made-up numbers.
- Step 2.12: there is no remove button in the Store; an app leaves through the
  desktop's own editing, and the Store then offers «Загрузить».

## Reviews
- One review per person and app (`store_reviews`), editable and deletable; the author
  is the account (surname, name, @voidops address), never a form field.
- Likes / dislikes: one vote per person (`store_review_votes`), a second press takes it back.
- Reports: Спам / Оскорбление / Не по теме / Другое with a required description
  (`store_review_reports`, once per person), for moderation.
- API: `GET /api/store/stats`, `GET /api/store/apps/:id/reviews?sort=date|helpful|high|low`,
  `PUT|DELETE /api/store/apps/:id/review`, `POST /api/store/apps/:id/reviews/:reviewId/vote`,
  `POST /api/store/apps/:id/reviews/:reviewId/report`.

## Step 2.12

### Search
One soft grey pill (no frame, `--store-search`), the magnifier on the left, an X inside
while it is focused or has text (clears; on an empty field it leaves the search).
Results while typing, by name, category, developer and keywords; an honest
«Ничего не найдено». No search history.

### An app's page
- Header: only Back (left) and Share (right), no card, no repeated title.
- Share: a phone opens the system share sheet (else the link is copied); a computer
  shows a menu: «Скопировать ссылку», «Отправить в Vibex». The link
  `https://<host>/#store/app/<id>` opens the Store on that app's page.
- «Что нового» with the current version and a link to the version history (a page of
  its own: every version, «Текущая версия», the date, what changed).
- «Ещё для вашего пространства»: the other catalog apps (never this one, the Store or
  Settings) with their own button.
- Per-app auto-update switch when the app is installed.

### Versions and updates
- `APP_RELEASES` (shared/apps.ts): every app's versions with dates; release notes per
  version in `catalog.ts` (`releases`). `compareVersions` / `updateAvailable` are shared.
- `installed_apps` (migration 0013, additive): `updated_at` (when the version really
  increased), `auto_update` (the app's own choice; null follows the global one),
  `notified_version` (one notification per new version).
- Preferences `store: { autoUpdate, updateNotifications }`, both on by default.
- `GET /api/apps` reconciles: an installed app older than the registry is updated at
  once when auto-update is on (Settings and the Store always), else it waits for
  «Обновить». With update notifications on, one `store.update` notification
  (`kind: updated | available`) per new version; off: no notification and no pop-up,
  the update still shows in the Store. An app taken off the desktop is left alone.
- `PUT /api/store/apps/:id/auto-update { autoUpdate: true | false | null }`.

### Account
The avatar on the Store's home (a badge with pending updates) opens the account:
avatar, name, public @voidops address, installed apps, pending updates; rows
«Обновления» (the update center: «Доступные обновления» with installed → new
version, «Обновить все», «Недавно обновлённые», «Все приложения обновлены»),
«Автообновление», «Уведомления об обновлениях», «Оценки и отзывы» (my reviews from
`GET /api/store/me/reviews`, a tap opens the app; an honest empty state).

## Step 2.13
Notes' Store texts name books (`.book`) beside notes and presentations; Files'
caption and keywords name `.book`. The Mail logo in the screenshots is the new
envelope.
