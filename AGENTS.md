# AGENTS

- Canonical repo instructions already live in `.github/copilot-instructions.md` and are loaded by `opencode.json`. Follow that file for UI, routing, data-grid, tours, and Spanish copy conventions.

## Commands

- Use `pnpm` for everything. `packageManager` is `pnpm@10.8.1`.
- Install deps with `pnpm install`.
- Start the app with `pnpm run dev`.
- Use `pnpm run dev:remote` to load `.env.remote` via Vite `--mode remote`.
- The only built-in verification script is `pnpm run build` (`tsc -b && vite build`). There are no repo `test` or `lint` scripts right now.

## Supabase

- `.npmrc` sets `ignore-scripts=true`. Do not assume postinstall hooks or a global `supabase` binary.
- Run Supabase only through the package scripts:
  - `pnpm run supabase:start`
  - `pnpm run supabase:status`
  - `pnpm run supabase:stop`
  - `pnpm run supabase:reset`
- Local Supabase ports are fixed in `supabase/config.toml`: API `54321`, DB `54322`, Studio `54323`.
- Auth local dev is configured for `http://127.0.0.1:5173`, signup enabled, email confirmation disabled.
- Local frontend uses `.env.local`; remote frontend uses `.env.remote`. Required vars are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `pnpm run sync:supabase:db` is a repo-specific data sync script. It resets local DB by default, uses Dockerized `pg_dump`/`pg_restore`, reads `.env.remote` when possible, and needs the remote DB password via args or `SUPABASE_REMOTE_DB_PASSWORD`.

## App Wiring

- Entry point is `src/main.tsx`: `BrowserRouter` + `AuthProvider` + global CSS imports.
- `src/App.tsx` is the route tree and auth gate. If env vars are missing it shows config-error auth UI; if unauthenticated it shows auth UI instead of the app shell.
- Pages are lazy-loaded from `src/pages/`.
- Current primary route groups are `/dashboard`, `/income`, `/spending/*`, `/investments/*`, and `/catalogs/*`.
- Several older paths are only redirects now (`/expenses`, `/tickets`, `/tickets/scan`, `/credit-cards`, `/stocks/*`, `/dividends`, `/movements*`). Add new behavior to the canonical routes, not the legacy aliases.

## Repo Conventions

- User-facing UI text must be Spanish.
- Keep new pages in `src/pages/` and wire navigation/tabs through `src/config/navigation.ts`.
- Styling is plain CSS, primarily in `src/styles.css`; library CSS is imported centrally from `src/main.tsx`.
- Shared grid editors live in `src/features/shared/gridEditors.tsx`. Use `react-data-grid` for tabular entry and `react-select` for dropdowns instead of native `<select>` unless there is a real technical blocker.
- `ENABLE_MOBILE_OPTIMIZED_LAYOUTS` is currently `false` in `src/config/ui.ts`; do not build separate mobile-only flows by default.

## Database

- Supabase migrations are sequential under `supabase/migrations/`. Current repo state goes through `022_dividend_import_source_ids.sql`; do not rely on older docs that list only the first few migrations.
- New schema changes should be added as the next numbered migration and follow the existing RLS-per-user pattern used throughout the repo.
