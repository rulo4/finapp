# Finapp – Copilot Instructions

## Project Overview
Personal finance web application for tracking income, expenses, investments, stock trades, and dividends. The UI language is **Spanish**. All user-facing labels, messages, and navigation items must be written in Spanish.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 6 |
| Routing | React Router DOM v7 (browser router) |
| Backend / DB | Supabase (PostgreSQL + Auth + RLS) |
| Data Grid | react-data-grid v7 (beta) |
| Date picker | react-datepicker + date-fns |
| Dropdowns | react-select v5 |
| Icons | @fortawesome/react-fontawesome (solid icons) |
| Styles | Plain CSS (single `src/styles.css`) |
| Utilities | clsx |

## Directory Structure
```
src/
  config/
    navigation.ts   # sidebar navigation items (label, route, icon)
    ui.ts           # feature flags (e.g. ENABLE_MOBILE_OPTIMIZED_LAYOUTS)
  features/
    auth/
      AuthContext.tsx  # AuthProvider + useAuth hook
    shared/
      AppDatePicker.tsx
      gridEditors.tsx  # InputCellEditor, SelectCellEditor, AppSelect
      isoDate.ts
      sampleGrid.tsx
      useMediaQuery.ts
  layouts/
    AppShell.tsx    # collapsible sidebar + topbar + <Outlet />
  lib/
    supabase/
      client.ts     # supabase client, isSupabaseConfigured(), checkSupabaseConnection()
  pages/            # one file per route (lazy-loaded)
  App.tsx           # route tree; auth-guard at the top
  main.tsx
supabase/
  config.toml       # local Supabase config (project_id: finapp, api port 54321)
  migrations/       # sequential SQL migration files (001_init.sql … 007_…)
```

## Database Schema (public schema, RLS enabled)
All tables carry a `user_id uuid` (default `auth.uid()`) and full CRUD RLS policies so each user only sees their own data.

**Catalog tables** (lookup data, per-user unique name):
- `expense_categories` – id, name, description, is_active, notes, user_id, created_at
- `income_sources` – id, name, description, is_active, notes, user_id, created_at
- `payment_instruments` – id, name, instrument_type (`cash|debit_card|credit_card`), is_active, notes, user_id, created_at
- `stores` – id, name, description, is_active, notes, user_id, created_at
- `brokers` – id, name, description, is_active, notes, user_id, created_at
- `investment_entities` – id, name, description, is_active, notes, user_id, created_at

**Transaction tables**:
- `income_entries` – entry_date, source_id→income_sources, currency_code (`MXN|USD`), amount_original, fx_rate_to_mxn, amount_mxn, notes
- `expense_entries` – entry_date, concept, quantity, unit_of_measure, unit_cost_original, total_amount_original, currency_code, fx_rate_to_mxn, total_amount_mxn, payment_instrument_id, store_id, ticket_url, is_recurring, category_id, subtotal (nullable, may be negative), notes

Stock trade and dividend tables are planned for future migrations.

## Authentication
- Handled by Supabase Auth (email/password).
- `AuthContext` exposes `{ isConfigured, isLoading, session, user, signOut }`.
- `App.tsx` guards all routes: shows `<AuthPage mode="config-error">` when env vars are missing, `<AuthPage mode="loading">` while session loads, and `<AuthPage mode="auth">` when unauthenticated.
- Env vars required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Routing
All pages are lazy-loaded via `React.lazy` + `<Suspense>`. Routes are nested inside `<AppShell>`.

| Path | Component |
|------|-----------|
| `/dashboard` | DashboardPage |
| `/income` | IncomePage |
| `/expenses` | ExpensesPage |
| `/investments` | InvestmentsPage |
| `/stocks/buys` | StockBuysPage |
| `/stocks/sells` | StockSellsPage |
| `/dividends` | DividendsPage |
| `/catalogs` | CatalogsPage |

## UI / Styling Conventions
- CSS uses BEM-like class naming: `app-shell`, `app-shell--sidebar-collapsed`, `sidebar__link`, `sidebar__link--active`, `card`, `card__text`, `page`, `topbar`, `topbar__title`, etc.
- `clsx` is used to compose conditional class names.
- `ENABLE_MOBILE_OPTIMIZED_LAYOUTS` in `src/config/ui.ts` is `false` by default; responsive sidebar uses this flag.
- Ingresos, egresos y dashboard deben usar una sola experiencia responsive; no mantener formularios o flujos especiales solo para móvil.
- Sidebar collapse state is persisted in `localStorage` under key `finapp.sidebar.collapsed`.
- Usa el menor texto posible en la UI; prefiere iconos claros cuando el contexto del campo o la acción siga siendo obvio.
- En acciones o columnas compactas, favorece icon-only buttons con `aria-label` y `title` en lugar de texto visible repetitivo.

## Data Grid Pattern
Use `react-data-grid` for tabular data entry. Shared cell editors live in `src/features/shared/gridEditors.tsx`:
- `InputCellEditor` – supports `text`, `number`, `date`, `iso-date` input types.
- `SelectCellEditor` – wraps `AppSelect` (react-select) for dropdown cells.
- `AppSelect` – standalone searchable select component with consistent styling.
- Date values use ISO-8601 string format (`YYYY-MM-DD`); use helpers from `isoDate.ts`.
- Siempre utiliza la dependencia instalada `react-select` para dropdowns/selects; no introducir selects custom ni usar `<select>` nativo salvo que exista una limitación técnica clara.

## Development Commands
```bash
npm run dev           # start Vite dev server (local Supabase)
npm run dev:remote    # start with --mode remote (remote Supabase)
npm run build         # tsc + vite build
npm run supabase:start / stop / reset  # manage local Supabase instance
```
Local Supabase endpoints: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`.

- Para comandos de Supabase CLI, ejecuta siempre vía `npx supabase ...`; no asumas un binario global `supabase` en PATH.

## Key Conventions
- Keep all new pages in `src/pages/` and register them as lazy routes in `App.tsx`.
- Add navigation entries to `src/config/navigation.ts` (icon from `@fortawesome/free-solid-svg-icons`).
- New database tables must have a corresponding migration file (next sequential number) with RLS policies mirroring the existing pattern.
- Prefer `numeric(18,6)` for monetary and quantity columns.
- All currency amounts are stored in both original currency and MXN equivalent when applicable.
- Do not add testing libraries or linters not already present.
