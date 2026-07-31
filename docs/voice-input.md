# Voice input (Entrada por voz) — Expenses editor

Brief notes for future devs/agents about the voice-input feature implemented for the Expenses editor.

- Purpose: allow quick voice capture for `Fecha`, `Concepto`, `Cantidad+Unidad`, `Subtotal`, `Categoría`, `Pago con`, `Tienda`, and `Notas` in the expense modal.

- Core files (implementation):
  - `src/features/shared/useSpeech.ts` — small wrapper hook around Web Speech API: `isSupported`, `isListening`, `startListening(onResult, lang?)`, `stopListening`, `lastError`.
  - `src/features/shared/spokenParsers.ts` — parsing helpers:
    - `parseSpokenDate()` supports `hoy/ayer/antier`, numeric dates, textual months, Spanish number-words (diecisiete → 17), and day-only inputs (assumes current month/year).
    - `parseQuantityAndUnit()` supports spelled numbers, unit normalization, exact/singular match, abbreviation heuristics and fuzzy fallback (uses `fuse.js`).
    - `parseSubtotal()` supports `130 con 50`, simple arithmetic and currency words.
    - `fuzzyMatchOption()` uses `fuse.js` and intentionally ignores placeholder options (e.g., `Sin tienda`).
  - `src/pages/ExpensesPage.tsx` — UI integration: inline mic buttons, `listeningField` state, `handleStartStopListening()` wiring to parsers and `updateExpenseRow()`, and feedback visible inside the modal.
  - `src/styles.css` — `.expense-entry-editor__field-control` ensures input + mic render inline.

- Key design points:
  - Speech engine: Web Speech API (SpeechRecognition / webkitSpeechRecognition) — default language `es-MX` set in the call-sites.
  - Parsers try deterministic rules first (exact/singular matches), then abbreviation heuristics, then fuzzy-match with adjustable thresholds.
  - UX: feedback is shown inside the modal (`feedback` banner) and debug logs are printed to console (`console.debug` in `useSpeech.ts` and `ExpensesPage`).

- Where to tune behavior:
  - Fuzzy thresholds: edit `fuzzyMatchOption()` default `threshold` or the thresholds in `parseQuantityAndUnit()` (currently 0.45 and 0.6).
  - Unit synonyms: enhance `parseQuantityAndUnit()` by adding a small synonyms map (e.g., `pz|pza|pcs -> piezas`) before fuzzy matching.
  - Language: change the `lang` argument passed to `startListening()` in `ExpensesPage.tsx` when needed.

- Debugging & manual tests:
  1. Run dev server (`pnpm run dev`) and open the Expenses modal.
  2. Open browser DevTools Console to view logs prefixed with `[useSpeech]` and `[speech]`.
  3. Try phrases: `hoy`, `diecisiete`, `diecisiete de julio`, `tres piezas`, `130 con 50`, `alimentos` and verify fields update and the feedback banner appears inside the modal.

- Quick changes checklist (where to edit):
  - Change fuzzy sensitivity: `src/features/shared/spokenParsers.ts` → `fuzzyMatchOption()` and `parseQuantityAndUnit()`.
  - Add unit synonyms: `src/features/shared/spokenParsers.ts` near `parseQuantityAndUnit()`.
  - Change UI placement/style: `src/styles.css` → `.expense-entry-editor__field-control` and modal markup in `src/pages/ExpensesPage.tsx`.

Keep this note short and update it when the feature expands (e.g., adding multilingual support or more parsers).
