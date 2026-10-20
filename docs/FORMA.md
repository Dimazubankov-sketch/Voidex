# Forma: the Voidex app builder

Forma is the visual app builder of Voidex. A person builds the **frontend** of an
app visually (screens, components, sounds, transitions, events, separately for
phone and computer); an authorised **AI agent** writes the **backend** and binds
it to the interface through typed operations. Forma makes apps only (no sites).

Route: Мои проекты → Создать приложение → editor → components and sounds →
events → preview → saved on the server (every device of the account).

Forma 0.1 (React prototype with browser storage and an iframe sound library) was
ported, not rewritten from scratch: its model, commands, 8 px snapping, move
mode, undo/redo, start-screen rule and Soundlab playback rules are kept; the
storage moved to the account, the sound library became native (Voidex CSP
forbids inline scripts), and the model grew to schema 2.

## Code map

| Where | What |
| --- | --- |
| `packages/forma/src/types.ts` | Project schema 2: `frontend` / `backend` / `bindings`, layouts per device with constraints |
| `packages/forma/src/components.ts` | Component library: 34 components in 8 categories, props schema, events, sizes, styles |
| `packages/forma/src/project.ts` | Create, validate (`parseFrontendDocument`, `parseProject`), migrate Forma 0.1 (schema 1) |
| `packages/forma/src/commands.ts` | Frontend commands (the only way the editor and a `frontend.write` agent change the UI), undo/redo |
| `packages/forma/src/layout.ts` | 8 px grid, `resolveLayout` (adaptive constraints), preview sizes |
| `packages/forma/src/runtime.ts` | The runtime state machine shared by the preview and future published apps |
| `packages/forma/src/backend.ts` | Contracts, operations, bindings, agent commands, `checkProject`, contract tests |
| `packages/forma/src/permissions.ts` | Agent scopes and clients |
| `packages/forma/tools/import-sounds.mjs` | Imports the sound library with integrity / duplicate / rights checks |
| `apps/server/src/services/forma.ts` | Projects, layered revisions, agent connections, audit, agent writes |
| `apps/server/src/routes/forma.ts` | Person API (`/api/forma/...`, session auth) |
| `apps/server/src/routes/forma-agent.ts` | Agent tools: REST `/api/forma/agent/v1` + OpenAPI, MCP `POST /api/forma/mcp` |
| `apps/server/drizzle/0014_forma.sql` | Forma's own tables (additive) |
| `apps/web/src/apps/forma/` | The app: `projects.tsx`, `editor/*`, `runtime/*` (renderer, host), `sounds/*` |
| `apps/web/public/forma/sounds/` | 168 sounds (MP3 previews), 12 haptic patterns, `catalog.json` with waveform frames |

Registration in Voidex (minimal registry entries): manifest in
`packages/shared/src/apps.ts` (category `developer`, «Инструменты разработчика»),
client entry in `os/app-registry.tsx`, icon `public/brand/app-forma.png` (the
user's logo, white tile and glow cut away, not redrawn), Store texts in the 10
dictionaries, Store screenshots `public/store/screens/forma-*.jpg`
(`tools/store-screens/forma.spec.ts`).

## Project model (schema 2)

```
Project
 ├── settings      start screen, design frames (phone 390×844, PC 1280×800), accent
 ├── frontend      ← the person (visual editor)
 │    ├── screens  role (main | registration | settings), background, content height
 │    │            per device (taller = scrolls), hideShared, elements, "open" event
 │    ├── shared   menus shown on every screen, stored once
 │    └── resources sounds of the project (library id, file, sha256)
 ├── backend       ← authorised AI agents only
 │    └── operations name (auth.login), input/output contracts, errors, handler
 │                   source, contract tests, who/when
 ├── bindings      ← authorised AI agents only: element event → operation,
 │                   input mapping, output target, loading, error target, onSuccess/onError
 └── publishing    appId / version / status (prepared for Appex Store)
```

* Every element has a layout **per device** (`x y width height`) plus constraints
  `h: left | right | center | stretch | scale`, `v: top | bottom | center | stretch | scale`,
  `minWidth / maxWidth`, `hidden`. `resolveLayout` places it on any screen size; the
  preview offers 360/390/430 phones and 1024/1280/1440 computers.
* Editor state (device, open screen, panels) is not part of the project; it is
  kept per device in `localStorage`.
* Events are typed: `press, change, submit, itemPress, confirm, cancel, finish` and
  the screen's `open`. Actions: `navigate, back, playSound, setValue, toggleValue,
  openDialog, closeDialog, showToast, timer`. No user JavaScript runs in the editor.

## Storage and versions

`forma_projects` keeps the frontend and the backend layer in two JSONB columns,
each with its **own revision**. A write must name the revision it is based on;
an older one is refused with `409 forma_conflict`. The person and an agent work
on different layers, so they never conflict with each other; two editors of the
same layer do (the editor shows «Загрузить последнюю / Оставить мою»).

* Autosave 0.9 s after the last change, retries every 5 s on failure, warns in a
  banner; Ctrl/Cmd+S saves a checkpoint.
* `forma_revisions`: a snapshot per backend write (always) and per frontend
  checkpoint (explicit save, agent write, or at most every 10 minutes); the last
  50 per layer are kept. The person can restore an interface version; an agent
  can roll back the backend.
* While the editor is open it checks the revisions every 8 s and takes an
  agent's backend change without touching the interface.

## Who can change what

| | Person (session) | AI agent (project token) |
| --- | --- | --- |
| Read the project | yes | `project.read` (always) |
| Interface (frontend) | yes | only with `frontend.write` (off by default), via the editor's own commands |
| Backend operations | **read and copy only** | `backend.write` |
| Bindings | read only | `bindings.write` |
| Checks / contract tests | in the Backend panel | `tests.run` |

The backend rule is enforced by the server: there is no session route that
writes the backend (`PUT/PATCH/POST/DELETE /api/forma/projects/:id/backend`
answer `403 forma_backend_read_only`), and the frontend save validates and stores
only `{ name, settings, frontend }`, whatever else the client sends.

## Agent connections

A person creates a connection in Forma → Backend и AI → Подключить AI: client
(Claude Code, ChatGPT, Voidex AI, other), scopes, lifetime (1 h, 1 day, 7 days,
30 days). The token (`fma_` + 40 characters) is shown once; the server keeps only
its SHA-256. A token:

* works for **one project** only, only on `/api/forma/agent/*` and `/api/forma/mcp`;
* is never accepted by any other Voidex route, and session tokens are never
  accepted by agent routes;
* expires, can be revoked at once, records its last use;
* every call (success or failure) goes to `forma_audit`, visible in Forma → Журнал.

Limits: 100 projects per account, 20 active connections per project, 120 agent
requests per minute, 256 KB per agent request, 64 KB per handler, 100 operations,
300 bindings, 50 commands per batch.

### Claude Code (MCP)

```bash
claude mcp add --transport http forma https://voidex.su/api/forma/mcp \
  --header "Authorization: Bearer fma_..."
```

The MCP endpoint is stateless Streamable HTTP with JSON responses
(`initialize`, `tools/list`, `tools/call`, `ping`). `tools/list` shows only the
tools the connection's scopes allow. Tool failures come back as results with
`isError: true` and the Forma error code, so the model can fix and retry.

### REST and ChatGPT

`https://voidex.su/api/forma/agent/v1/openapi.json` describes the same tools as
REST (OpenAPI 3.1, bearer auth).

CSRF: the agent routes (`/api/forma/agent/v1/*` and `/api/forma/mcp`) are the
only routes exempt from the `X-Voidex-Client` CSRF header, and only for
requests that carry `Authorization: Bearer fma_...`. They authenticate by that
project-bound token alone (hash lookup, expiry, revocation, scopes) and never
read the session cookie, so a forged cross-site request has nothing to ride on.
The exemption matches the registered route pattern, not the raw URL. Every
other route, Forma's own person routes included, keeps the CSRF check
(`apps/server/src/http.ts`, `isFormaAgentRequest`; tests in
`apps/server/test/forma.test.ts`). CORS is unchanged: no wildcard origin.

ChatGPT: a GPT with Actions imports that OpenAPI document with «API Key → Bearer»
and can read and write within the connection's scopes. ChatGPT's developer-mode MCP connectors require OAuth,
which Voidex does not offer yet.

### Voidex AI

The future Voidex agent uses the same connections, scopes, tools and audit
(client `voidex-ai`); nothing in Forma is specific to one provider.

### Tools

| Tool | REST | Scope |
| --- | --- | --- |
| `forma_get_project` | `GET /project` | read |
| `forma_get_info` | `GET /project/info` | read |
| `forma_list_screens` | `GET /screens` | read |
| `forma_get_screen_tree` | `GET /screens/{screenId}/tree` | read |
| `forma_get_element` | `GET /elements/{elementId}` | read |
| `forma_list_events` | `GET /events` | read |
| `forma_list_components` | `GET /components` | read |
| `forma_get_bindings` | `GET /bindings` | read |
| `forma_get_backend` | `GET /backend` | read |
| `forma_upsert_operation` | `PUT /backend/operations/{name}` | backend.write |
| `forma_delete_operation` | `DELETE /backend/operations/{name}?baseRevision=` | backend.write |
| `forma_backend_commands` | `POST /backend/commands` | backend.write / bindings.write |
| `forma_upsert_binding` | `PUT /bindings/{id}` | bindings.write |
| `forma_delete_binding` | `DELETE /bindings/{id}?baseRevision=` | bindings.write |
| `forma_check` | `POST /check` | read |
| `forma_run_tests` | `POST /tests/run` | tests.run |
| `forma_list_revisions` | `GET /revisions?layer=` | read |
| `forma_get_revision` | `GET /revisions/{layer}/{revision}` | read |
| `forma_diff` | `GET /diff?layer=&from=&to=` | read |
| `forma_rollback_backend` | `POST /backend/rollback` | backend.write + bindings.write |
| `forma_frontend_commands` | `POST /frontend/commands` | frontend.write |

Example (the `auth.login` contract the instructions describe): the agent reads
the login screen tree, creates `auth.login` with input `{ phone: string pattern,
password: string min 8 }`, output `{ userName }`, errors `invalid_credentials`,
then binds the «Войти» button: `input.phone ← element Телефон`,
`input.password ← element Пароль`, `errorTargetId ← Сообщение об ошибке`,
`onSuccess: navigate(main)`. This is an app's own operation: it never touches
Voidex's own sign-in.

## Running the backend (security model)

Agent-written code is **stored and checked, never executed** today:

* syntax check: V8 compiles the handler (`new vm.Script`, never run); imports are refused;
* `checkProject`: contracts, tests against contracts, every binding (element,
  event, operation, field mapping and value types), action targets;
* `forma_run_tests`: the contract half of every test; reports `executed: false,
  reason: sandbox_unavailable`.

The preview calls bound operations through a gateway that validates the input
against the contract and then shows an explicit diagnostic state («Backend ещё не
исполняется»): it never invents a successful answer. The interface can be
checked without any backend.

Planned isolated runtime (not part of the Voidex server process): a separate
worker container per execution pool with no access to Voidex secrets or the
database; per call limits on CPU time (e.g. 1 s), memory (64 MB), wall time
(5 s), output size; no network except an explicit allow-list per project; a
per-project key-value store as the only state; inputs and outputs validated
against the contracts on both sides; logs to the project's audit. Until it
exists, `backend.runtime` stays `sandbox-pending`.

## Sounds

`packages/forma/tools/import-sounds.mjs` imported the Forma 0.1 library: 168
resources (156 sounds + 12 haptic patterns) as MP3 previews and pattern JSON,
each checked (MP3 header, catalog checksum of the source WAV, no duplicate bytes).
Alert B (a third-party Honk recording with an added tail, rights not confirmed)
is **left out** of the published library. The canonical WAV masters (37 MB) are
not shipped; the catalog keeps the SHA-256 of every shipped file.

Playback keeps the Soundlab rules: one press, one playback; a playing sound does
not restart; different sounds play together; nothing loops; natural tails are
kept; no bottom player, no downloads; the 9 bars follow the real playback
position through the catalog's animation frames. On devices with the Vibration
API haptic patterns also vibrate.

## Not yet / next

* Executing backend operations (isolated runtime above) and publishing apps to
  Appex Store (`publishing` is already in the project).
* ChatGPT writes (see above), OAuth for MCP connectors.
* The Forma interface is in Russian (other Voidex languages: the Store card and
  category are translated, the editor is not yet).
* Images are drawn components (cover / avatar / icon); uploading pictures to a
  project is not available yet.
* Containers are visual (panel, card, dialog); nested layouts and per-element
  scroll areas come later (screens scroll as a whole).
