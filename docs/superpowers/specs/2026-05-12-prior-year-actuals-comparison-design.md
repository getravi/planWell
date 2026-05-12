# Prior Year Actuals Comparison Design

## Goal

Enhance the existing Scenario Comparison page so a planner can compare any selected
scenario year against the prior year's actuals. The workflow should answer:

> How does this year's plan compare to last year's actual performance?

This belongs on Scenario Comparison because the page already owns variance charts,
variance KPIs, the variance grid, exports, and narrative generation. Forecast Model
should stay focused on editing and reviewing one scenario.

## User Flow

1. The user opens Scenario Comparison.
2. The user selects a scenario as the current plan, such as Base Case.
3. The user selects a specific year, such as 2026.
4. The user changes the comparison basis from Compare against scenario to Compare
   against prior year actuals.
5. The page compares 2026 scenario rows against 2025 actual rows.

Prior year actuals mode only works when a specific year is selected. When Year is
All, the option remains visible but disabled with helper text:

> Select a year to compare against prior year actuals.

## Comparison Semantics

For a selected year `Y`, compare:

- Baseline: actuals from `Y - 1`
- Current: selected scenario rows from `Y`

Rows are matched by month number, department, and account:

- `2026-01 / Sales / Revenue` compares to `2025-01 / Sales / Revenue`
- `2026-02 / Sales / Revenue` compares to `2025-02 / Sales / Revenue`

The resulting variance row should be normalized onto the selected-year month
internally. Existing grid, chart, KPI, insight, and export logic can continue to
group by the current-year month.

Missing prior-year actuals are blank/no-comparison cells. They must not be treated
as zero because that would create fake variances.

## Display

The page header should make the comparison basis explicit:

- Main label: `2025 Actuals vs Base Case`
- Supporting note: `2026 plan compared to 2025 actuals`

In prior-year actuals mode, period labels should be paired:

- Monthly: `Jan 2026 vs Jan 2025`
- Quarterly: `Q1 2026 vs Q1 2025`
- Fiscal year: `FY2026 vs FY2025`

The chart, KPI strip, variance insight cards, table, copy grid, CSV/XLSX/PDF export,
and narrative controls should remain in the same places as scenario-to-scenario
mode.

## Architecture

Add a comparison basis state to the workbench:

- `scenario`: existing scenario-to-scenario behavior
- `prior-year-actuals`: selected scenario vs prior-year actuals

The existing `/api/cube/variance` endpoint compares two scenarios. Add a focused
API route for prior-year actuals that returns the same `VarianceRow[]` shape. UI
code receives variance rows and mode metadata; it does not rebuild financial
comparison rules in React.

API shape:

```text
GET /api/cube/prior-year-variance?scenario=Base%20Case&year=2026
```

Response:

```ts
{
  rows: VarianceRow[];
  left: "2025 Actuals";
  right: "Base Case";
  year: "2026";
  priorYear: "2025";
}
```

The client can pass mode metadata into ScenarioComparisonPage so the page can
format paired labels without changing the `VarianceRow` domain type.

## Edge Cases

- Year is All: prior-year actuals option is disabled and no prior-year query runs.
- No selected scenario: keep the existing empty/loading behavior.
- No prior-year actuals exist: show an empty state that says no matching prior-year
  actuals were found for the selected year.
- Some prior-year months are missing: omit those cells from comparison output so
  the table displays blanks instead of zero variance.
- Departments/accounts missing from either side: only compare exact matching
  department/account pairs. Existing hierarchy rollups can aggregate the matched
  rows afterward.

## Testing

Add server tests for:

- `2026` scenario rows compare to `2025` actual rows by matching month number,
  department, and account.
- Missing prior-year actuals do not produce zero-valued variance rows.
- The endpoint rejects or returns a 400 for invalid year input.

Add client tests for:

- Prior-year actuals option is disabled when Year is All.
- Selecting a specific year enables prior-year actuals mode.
- The page shows paired period labels such as `Jan 2026 vs Jan 2025`.
- Scenario-to-scenario comparison still works unchanged.

Run `vp check` and `vp test` before considering implementation complete.
