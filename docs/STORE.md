# Appex Store (Step 2.11)

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

## Install / open / update / remove
- State per account: on the desktop and current = «Открыть»; an older version recorded
  in `installed_apps` = «Обновить»; removed from the desktop = «Загрузить».
- Install / update downloads the app's code (its lazy chunk), then
  `POST /api/store/apps/:id/install` records the registry version, then the app goes
  back on the desktop and the launcher. The browser reports no percent for a code
  download, so the button shows a spinner, never made-up numbers.
- Remove uses the system's own mechanism (`offloadApp` + `removeAppsFromDesktop`).

## Reviews
- One review per person and app (`store_reviews`), editable and deletable; the author
  is the account (surname, name, @voidops address), never a form field.
- Likes / dislikes: one vote per person (`store_review_votes`), a second press takes it back.
- Reports: Спам / Оскорбление / Не по теме / Другое with a required description
  (`store_review_reports`, once per person), for moderation.
- API: `GET /api/store/stats`, `GET /api/store/apps/:id/reviews?sort=date|helpful|high|low`,
  `PUT|DELETE /api/store/apps/:id/review`, `POST /api/store/apps/:id/reviews/:reviewId/vote`,
  `POST /api/store/apps/:id/reviews/:reviewId/report`.
