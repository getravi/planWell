# Formulas Admin Page

## Context

Formula editing currently lives as a collapsible section at the bottom of the Forecast Model page — a user-facing page. Formulas are scenario-level configuration edited occasionally by admins, not driver inputs touched by regular users. The two concerns need to be separated.

## Goal

Move formula editing to a dedicated admin page. Users see a clean Forecast Model with only driver inputs. Admins find formula config where they expect it: alongside Dimensions, Versions, and Schema.

## Design

### Navigation

Add "Formulas" to the Admin submenu in the sidebar, between Versions and Schema. "Formulas" is added to `VIEWS` and `isAdminView` — no KPI strip, no status pill, no scenario pickers in the topbar.

### Page layout (`FormulasPage`)

```
┌─────────────────────────────────────────────┐
│ Scenario  [Base Case ▾]                     │
├─────────────────────────────────────────────┤
│ Account    Formula                    Reset │
│ ─────────────────────────────────────────── │
│ Revenue   [base * pow(1+growthRate, month)] │
│            ✓ Valid                          │
│ COGS      [revenue * cogsPct             ] │
│            ✓ Valid                          │
│ Headcount [base * pow(1+growthRate, month)] │
│            ✓ Valid                          │
│ OpEx      [headcount * costPerHead       ] │
│            ✓ Valid                          │
├─────────────────────────────────────────────┤
│ [Save formulas]   locked scenario warning   │
└─────────────────────────────────────────────┘
```

- Scenario picker dropdown at top — lists all scenarios from existing `client.scenarios()` query
- 4 formula rows: `Input` per account, `placeholder` = `DEFAULT_FORMULAS[account]`, value = current formula override or empty
- On blur: call `client.validateFormula()` → inline ✓ Valid / error message
- Reset (↺) button per row: clears override, resets validation state
- Save button: disabled if any formula has a validation error, if scenario is locked, or if nothing changed
- Locked scenario: inputs disabled, note shown ("locked — unlock in Versions to edit")
- On save: calls existing `client.saveScenario()` with full `ScenarioAssumptions` including updated `formulas` map

### Forecast Model cleanup

Remove `FormulaEditor` component and all its wiring from `ForecastPage.tsx`:
- Delete `FormulaEditor` function
- Remove `formulaErrors` state from `ScenarioEditor`
- Remove `FormulaEditor` JSX from `ScenarioEditor` render
- Remove formula error check from Save button's `disabled` prop
- Remove `DEFAULT_FORMULAS`, `ScenarioFormulas`, `CoreAccount` imports that are no longer needed in that file

The `ScenarioAssumptions` type still carries `formulas?` — the Forecast Model just no longer exposes it to users.

## Files Changed

| File | Change |
|---|---|
| `src/client/App.tsx` | Add "Formulas" to `VIEWS`, Admin nav (between Versions and Schema), `isAdminView` |
| `src/client/pages/FormulasPage.tsx` | New page component |
| `src/client/pages/ForecastPage.tsx` | Remove `FormulaEditor` component and wiring |

## Not Changed

- `src/domain/formulaEngine.ts` — engine unchanged
- `src/domain/types.ts` — types unchanged
- `src/domain/forecast.ts` — evaluation unchanged
- `src/server/` — all API routes, repository, schema unchanged
- `src/client/api.ts` — client unchanged

## Verification

1. Navigate to Admin → Formulas — page loads, scenario picker shows all scenarios
2. Select a scenario, type a valid formula, blur → shows ✓ Valid
3. Type invalid formula → shows error, Save disabled
4. Click ↺ Reset → field clears, placeholder (default) reappears
5. Save → forecast recalculates with new formula (verify on Forecast Model page)
6. Select a locked scenario → inputs disabled, warning shown
7. Forecast Model page — no formula editor visible, driver matrix is the only editable control
