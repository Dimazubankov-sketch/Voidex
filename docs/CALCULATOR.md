# Calculator (system app)

The Calculator is the Voidex-Calculator app (delivered as a ZIP of sources),
running natively in a VOIDEX window — no iframe.

## Where the code lives

| Path | What |
| --- | --- |
| `packages/calculator/src/engine.js` | Original maths engine (mathjs): expressions, exact fractions, surds, equations, steps. Unchanged. |
| `packages/calculator/src/main.js`, `style.css`, `index.html` | Original standalone app, kept as delivered (reference / standalone run). |
| `packages/calculator/tests/engine.test.mjs` | Original engine tests — run as-is by `pnpm test` (`@voidex/calculator`). |
| `packages/calculator/src/voidex/mount.js` | VOIDEX adapter: the logic of `main.js` mounted into a window root (scoped lookups, window-local keyboard, in-window dialogs, cleanup on close, layout fit levels). |
| `packages/calculator/src/voidex/markup.js`, `calculator.css` | `index.html` without the standalone page chrome; `style.css` scoped to `.vxc`, no page scroll. |
| `apps/web/src/apps/calculator/calculator-app.tsx` | React window: header (history, help, solution panel on narrow windows) + mount. |
| `apps/web/scripts/prepare-calculator-ocr.mjs` | Copies the local OCR runtime into `public/apps/calculator/ocr/` (generated, gitignored) on `dev` / `build`. |

Registry: `packages/shared/src/apps.ts` (`calculator`, category tools, preinstalled,
window 900 × 740, min 360 × 560, singleton) and `apps/web/src/os/app-registry.tsx`.
Existing accounts get it automatically (preinstalled system apps are added on
`/api/apps`); a dock that was never customised shows it, a customised one keeps
the user's choice (pin from the right-click menu or by drag).

## Loading

- The app is a lazy chunk (`calculator-app-*.js/.css`, with mathjs and KaTeX).
  A normal VOIDEX load downloads none of it.
- Tesseract is imported only when **Распознать** is pressed; the worker, wasm core
  and English model (`/apps/calculator/ocr/*`, ~25 MB uncompressed, cached by the
  browser) load at that moment. Recognition runs on the device; the photo is
  never sent to the server.
- CSP: `script-src 'self' 'wasm-unsafe-eval'` — needed to compile the OCR
  WebAssembly; JavaScript `eval` stays blocked.

## Layout

Never a page scroll: the root is `overflow: hidden`; only the step-by-step list
and the history list scroll. Wide windows (≥ 680 px): keypad column + solution
pane. Narrow windows / phones: one column, the solution opens as a panel over the
keypad (header button). Keys shrink to a touch-safe minimum, then `data-fit`
levels compact the layout; on short windows the scientific mode shows functions
and digits as two tabs (each with a **Решить** key) instead of scrolling.

## Changes compared to the delivered `main.js`

- element lookup inside the window root; flags on the root instead of `<body>`;
- keys handled while focus is inside the window (not the whole document);
- dialogs inside the window; Esc closes them;
- OCR paths from the VOIDEX origin;
- a file that cannot be decoded as an image shows a message (instead of a broken preview);
- OCR cleanup also turns a capital `X` right after a digit (`2X`) into the variable `x`
  (Tesseract reads it that way; the engine only knows `x`);
- WebMCP tool registration is released with the window;
- the clock / fake OS bar / page footer are not used (VOIDEX draws the window).

## Tests

- `pnpm --filter @voidex/calculator test` — the original 27 engine checks.
- `apps/web/e2e/calculator.spec.ts` — registry, search, dock pin/unpin, lazy
  loading, the required calculations through the UI, errors, history, widget →
  app, phone layout + top-edge gesture, maximize, no page scroll, and OCR with
  the real local Tesseract on `e2e/fixtures/ocr-2x-plus-4.png` (the image is the
  only fixture).

## Known limitations

- The app's texts are Russian (as delivered); its name, header buttons and
  search keywords are localised in all 10 VOIDEX languages.
- OCR: printed, single-line formulas; handwriting, powers and stacked fractions
  may need manual correction. The camera button uses the browser's
  `capture` file input (on PCs it opens a file chooser); if camera access is
  denied the browser shows its own prompt and nothing is loaded.
- History lasts until the page is reloaded (as in the original).
