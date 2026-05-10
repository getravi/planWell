# planWell

Financial planning and forecasting tool for growing teams. Import actuals, model scenarios, compare forecasts, and ask an AI analyst questions — all in a self-hosted SQLite-backed app.

## Features

- **Actuals import** — paste long or wide CSV; auto-detects shape, aggregates duplicates
- **Scenario forecasting** — multiple named scenarios; lock versions for audit trail
- **Custom variables** — user-defined input and calculated variables with mathjs formulas; values override per-department per-month, with ancestor dept inheritance
- **Formula engine** — per-scenario, per-account formula overrides (Revenue, COGS, OpEx, Headcount); falls back to shared defaults
- **Variance analysis** — side-by-side scenario comparison with % and absolute delta
- **AI analyst** — natural language questions answered from live forecast data (Google Gemini)
- **Dimension management** — hierarchical departments and accounts with drag-to-reorder
- **Exports** — CSV, XLSX, and PDF from any data grid

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Recharts, TanStack Query/Table |
| Backend | Hono on Node.js |
| Database | SQLite via `node:sqlite` (built-in, no ORM at runtime) |
| Formula engine | mathjs (sandboxed — `import` and `createUnit` blocked) |
| AI | Google Gemini (`@google/genai`) |
| Build | Vite+ (`vp`) |
| Tests | Vitest via `vp test` |

## Getting started

```bash
# Install dependencies
pnpm install   # or: npx vp install

# Start dev server (API on :8787, UI on :5173)
npm run dev

# Run tests
npx vp test --run

# Type-check + lint
npx vp check
```

Default demo credentials: `director@planwell.local` / `planwell-demo`

Set `PLANWELL_SKIP_SEED=1` to disable demo user seeding in production.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `8787` | Port for the Hono API server |
| `SQLITE_PATH` | `data/planwell.sqlite` | Path to the SQLite database file |
| `PLANWELL_SKIP_SEED` | _(unset)_ | Set to `1` to skip demo credential seeding |
| `GEMINI_API_KEY` | _(unset)_ | Google Gemini key for the AI analyst feature |

## CSV import format

**Long (tidy) format** — one row per cell:

```
month,department,account,value
2025-01,Engineering,Revenue,450000
2025-01,Engineering,COGS,180000
2025-01,Engineering,OpEx,95000
2025-01,Engineering,Headcount,12
```

**Wide format** — one row per department/month, accounts as columns:

```
month,department,Revenue,COGS,OpEx,Headcount
2025-01,Engineering,450000,180000,95000,12
```

`month` must be `YYYY-MM`. Core accounts: `Revenue`, `COGS`, `OpEx`, `Headcount`.

## Architecture

```
src/
  domain/          # Pure business logic — no I/O
    types.ts       # Shared types (ActualRow, ScenarioAssumptions, …)
    forecast.ts    # Forecast calculation, compareSeries, KPI summary
    formulaEngine.ts  # mathjs sandbox, topoSort, validateFormula
    importer.ts    # CSV parsing (long + wide)
  server/
    app.ts         # Hono routes
    repository.ts  # Repository interface + SQLite implementation
    db/            # SQL layer (migrations, actuals, forecasts, versions, …)
    analyst.ts     # Gemini integration
  client/
    pages/         # React pages (Actuals, Forecast, Comparison, Admin, …)
    components/    # Shared components (RevenueChart, LoginScreen)
    api.ts         # Typed fetch client
    pivot.ts       # Grid pivot and aggregation helpers
```

Sessions expire after 8 hours. The database file is created at first run; `data/` is git-ignored.

## Database schema

Open the **Schema** tab inside the app for a live ERD. Key tables:

| Table | Purpose |
|---|---|
| `actuals` | Imported historical data (month × department × account) |
| `versions` | Named versions — one `actuals` version plus N scenario versions |
| `forecast_values` | Calculated forecast cells per scenario |
| `custom_variables` | User-defined input/calculated variable definitions |
| `custom_variable_values` | Per-scenario, per-scope variable values |
| `scenario_formulas` | Per-account formula overrides per scenario |
