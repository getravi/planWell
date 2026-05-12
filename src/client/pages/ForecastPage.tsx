import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Save, Settings2, Wand2 } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  ActualRow,
  CustomVariableDef,
  DimensionMember,
  ForecastRow,
  ScenarioAssumptions,
  VarValues,
} from "../../domain/types.ts";
import { client, type ScenarioRecord } from "../api.ts";
import {
  buildActualGridMatrix,
  buildActualGridTsv,
  collapsePivotActualRowsToQuarters,
  collapsePivotActualRowsToMonthsWithYearTotal,
  copyGrid,
  formatHorizonLabel,
  getMonths,
  isFYPeriod,
  isMultiCellGrid,
  parsePastedGrid,
  pivotActualRows,
  type Granularity,
} from "../pivot.ts";
import {
  buildAncestorLookup,
  buildDescendantLookup,
  flattenMembers,
  orderedNamesFromMembers,
  orderedOptionsFromMembers,
} from "../dimension-utils.ts";
import { formatCell } from "../format.ts";
import { Button, EmptyState, ExportMenu, GhostButton, Input, Panel } from "../ui.tsx";
import { exportCsv, exportPdf, exportXlsx } from "../export.ts";
import { RevenueChart } from "../components/RevenueChart.tsx";

const PERCENT_VAR_IDS = new Set(["revenueGrowthRate", "cogsPctOfRevenue", "headcountGrowthRate"]);

function driverCellKey(varId: string, month: string): string {
  return `${varId}::${month}`;
}

function roundDriverValue(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function formatPercentDriver(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDriverDisplay(value: number, isPercent: boolean): string {
  return isPercent ? formatPercentDriver(value) : String(value);
}

function formatDriverEditValue(value: number, isPercent: boolean): string {
  return isPercent ? String(value) : String(value);
}

function parseDriverInput(rawValue: string, isPercent: boolean): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const hasPercentSign = trimmed.includes("%");
  const normalized = trimmed.replace(/[$,%]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return isPercent && hasPercentSign ? parsed / 100 : parsed;
}

function buildActualDriverValues(
  actualRows: ActualRow[],
  selectedDepartment: string,
  departmentHierarchy: DimensionMember[],
): Record<string, Partial<VarValues>> {
  if (actualRows.length === 0 || !selectedDepartment) return {};

  const descendantLookup = buildDescendantLookup(departmentHierarchy);
  const allowedDepartments =
    selectedDepartment === "__all__"
      ? null
      : new Set(descendantLookup.get(selectedDepartment) ?? [selectedDepartment]);
  const monthlyAccounts = new Map<string, Map<string, number>>();

  for (const row of actualRows) {
    if (allowedDepartments && !allowedDepartments.has(row.department)) continue;
    const accounts = monthlyAccounts.get(row.month) ?? new Map<string, number>();
    accounts.set(row.account, (accounts.get(row.account) ?? 0) + row.value);
    monthlyAccounts.set(row.month, accounts);
  }

  const months = [...monthlyAccounts.keys()].sort((left, right) => left.localeCompare(right));
  const values: Record<string, Partial<VarValues>> = {};

  for (let index = 0; index < months.length; index += 1) {
    const month = months[index]!;
    const accounts = monthlyAccounts.get(month)!;
    const previousAccounts = index > 0 ? monthlyAccounts.get(months[index - 1]!) : undefined;
    const revenue = accounts.get("Revenue") ?? 0;
    const cogs = accounts.get("COGS") ?? 0;
    const headcount = accounts.get("Headcount") ?? 0;
    const opex = accounts.get("OpEx") ?? 0;
    const previousRevenue = previousAccounts?.get("Revenue") ?? 0;
    const previousHeadcount = previousAccounts?.get("Headcount") ?? 0;

    values[month] = {
      revenueGrowthRate: roundDriverValue(previousRevenue > 0 ? revenue / previousRevenue - 1 : 0),
      cogsPctOfRevenue: roundDriverValue(revenue > 0 ? cogs / revenue : 0),
      headcountGrowthRate: roundDriverValue(
        previousHeadcount > 0 ? headcount / previousHeadcount - 1 : 0,
      ),
      costPerHead: roundDriverValue(headcount > 0 ? opex / headcount : 0),
    };
  }

  return values;
}

export function ForecastPage({
  scenarios,
  selected,
  rows,
  actualRows,
  departmentFilter,
  departments,
  departmentHierarchy,
  accountHierarchy,
  customVarDefs = [],
  selectedYear,
}: {
  scenarios: ScenarioRecord[];
  selected: string;
  rows: ForecastRow[];
  actualRows: ActualRow[];
  departmentFilter: string;
  departments: string[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
  selectedYear: string;
  customVarDefs?: CustomVariableDef[];
}) {
  const scenario = scenarios.find((item) => item.name === selected);
  const months = [
    ...new Set([
      ...rows.map((row) => row.month),
      ...Object.values(scenario?.assumptions.varOverrides ?? {}).flatMap((override) =>
        Object.keys(override.monthly ?? {}),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const forecastMonths = getMonths(rows);
  const modelDepartments = orderedNamesFromMembers(flattenMembers(departmentHierarchy), [
    ...departments,
    ...rows.map((row) => row.department),
    ...(departmentFilter === "__all__"
      ? Object.keys(scenario?.assumptions.varOverrides ?? {})
      : []),
  ]);
  return (
    <div className="grid two">
      <ScenarioEditor
        scenario={scenario}
        months={months}
        departments={modelDepartments}
        departmentHierarchy={departmentHierarchy}
        departmentFilter={departmentFilter}
        actualRows={actualRows}
        varDefs={customVarDefs}
        selectedYear={selectedYear}
      />
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Forecast revenue</h2>
          <span>{selected}</span>
        </div>
        <RevenueChart rows={rows} />
      </Panel>
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Forecast by department and account</h2>
          <span>{formatHorizonLabel(forecastMonths) ?? `${rows.length} forecast cells`}</span>
        </div>
        <ForecastGrid
          rows={rows}
          departmentHierarchy={departmentHierarchy}
          accountHierarchy={accountHierarchy}
        />
      </Panel>
    </div>
  );
}

function ScenarioEditor({
  scenario,
  months,
  departments,
  departmentHierarchy,
  departmentFilter,
  actualRows,
  varDefs,
  selectedYear,
}: {
  scenario?: ScenarioRecord;
  months: string[];
  departments: string[];
  departmentHierarchy: DimensionMember[];
  departmentFilter: string;
  actualRows: ActualRow[];
  varDefs: CustomVariableDef[];
  selectedYear: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ScenarioAssumptions | null>(null);
  const [editingCells, setEditingCells] = useState<Record<string, string>>({});
  const [recalculating, setRecalculating] = useState(false);
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = draft ?? scenario?.assumptions;
  const isLocked = Boolean(scenario?.locked);
  const ancestorLookup = useMemo(
    () => buildAncestorLookup(departmentHierarchy),
    [departmentHierarchy],
  );
  const monthOptions = useMemo(() => {
    const scenarioMonths = Object.values(active?.varOverrides ?? {}).flatMap((override) =>
      Object.keys(override.monthly ?? {}),
    );
    const allMonths = [...new Set([...months, ...scenarioMonths])].sort((left, right) =>
      left.localeCompare(right),
    );
    return selectedYear === "__all__"
      ? allMonths
      : allMonths.filter((m) => m.startsWith(selectedYear));
  }, [active, months, selectedYear]);
  const departmentOptions = useMemo(
    () =>
      orderedOptionsFromMembers(departmentHierarchy, [
        ...departments,
        ...Object.keys(active?.varOverrides ?? {}),
      ]).map((d) => d.name),
    [active, departmentHierarchy, departments],
  );
  const selectedDepartment = departmentOptions.includes(departmentFilter)
    ? departmentFilter
    : (departmentOptions[0] ?? "");
  const actualDriverValues = useMemo(
    () => buildActualDriverValues(actualRows, selectedDepartment, departmentHierarchy),
    [actualRows, departmentHierarchy, selectedDepartment],
  );
  const save = useMutation({
    mutationFn: client.saveScenario,
    onSuccess: async () => {
      setDraft(null);
      setRecalculating(true);
      // Invalidate scenarios list immediately; forecast/variance update via SSE recalc-done event
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      // Safety fallback: clear recalculating after 10s even if SSE doesn't arrive
      if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
      recalcTimerRef.current = setTimeout(() => setRecalculating(false), 10000);
    },
  });

  const suggestions = useQuery({
    queryKey: ["baseline-suggestions"],
    queryFn: client.baselineSuggestions,
  });

  const applySuggestions = () => {
    const data = suggestions.data;
    if (!data || !active || isLocked) return;
    const deptSuggestion = data.byDepartment[selectedDepartment] ?? data.global;
    const next = structuredClone(active);
    const deptOverride = next.varOverrides?.[selectedDepartment] ?? {};
    const existingMonthly = deptOverride.monthly ?? {};
    const updatedMonthly: typeof existingMonthly = {};
    for (const month of monthOptions) {
      updatedMonthly[month] = {
        ...existingMonthly[month],
        revenueGrowthRate: deptSuggestion.revenueGrowthRate,
        cogsPctOfRevenue: deptSuggestion.cogsPctOfRevenue,
        headcountGrowthRate: deptSuggestion.headcountGrowthRate,
        costPerHead: deptSuggestion.costPerHead,
      };
    }
    next.varOverrides = {
      ...next.varOverrides,
      [selectedDepartment]: { ...deptOverride, monthly: updatedMonthly },
    };
    setDraft(next);
  };

  if (!active) {
    return (
      <Panel className="span-two">
        <EmptyState
          title="No scenario selected"
          body="Import actuals to create the default scenario set."
        />
      </Panel>
    );
  }

  if (departmentOptions.length === 0 || !selectedDepartment) {
    return (
      <Panel className="span-two">
        <EmptyState
          title="No assumption levels"
          body="Add department members in Dimensions to edit driver assumptions."
        />
      </Panel>
    );
  }

  const inputVarDefs = varDefs.filter((d) => d.kind === "input");

  const applyVarPaste = (text: string, startRow: number, startColumn: number) => {
    const next = structuredClone(active);
    const lines = parsePastedGrid(text);

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
      const def = inputVarDefs[startRow + rowIndex];
      if (!def) continue;
      const isPercent = PERCENT_VAR_IDS.has(def.id);
      for (let columnIndex = 0; columnIndex < lines[rowIndex].length; columnIndex += 1) {
        const month = monthOptions[startColumn + columnIndex];
        if (!month) continue;
        const value = parseDriverInput(lines[rowIndex][columnIndex], isPercent);
        if (value === null) continue;
        const deptOverride = next.varOverrides?.[selectedDepartment] ?? {};
        next.varOverrides = {
          ...next.varOverrides,
          [selectedDepartment]: {
            ...deptOverride,
            monthly: {
              ...deptOverride.monthly,
              [month]: { ...deptOverride.monthly?.[month], [def.id]: value },
            },
          },
        };
      }
    }
    setDraft(next);
  };

  const updateVar = (month: string, varId: string, value: number) => {
    const deptOverride = active.varOverrides?.[selectedDepartment] ?? {};
    setDraft({
      ...active,
      varOverrides: {
        ...active.varOverrides,
        [selectedDepartment]: {
          ...deptOverride,
          monthly: {
            ...deptOverride.monthly,
            [month]: { ...deptOverride.monthly?.[month], [varId]: value },
          },
        },
      },
    });
  };

  const resolveVarDisplay = (varId: string, month: string): number => {
    const actualValue = actualDriverValues[month]?.[varId];
    if (actualValue !== undefined) return actualValue;

    const def = varDefs.find((d) => d.id === varId);
    let value = def?.defaultValue ?? 0;
    for (const ancestor of ancestorLookup.get(selectedDepartment) ?? []) {
      value = active.varOverrides?.[ancestor]?.monthly?.[month]?.[varId] ?? value;
    }
    value = active.varOverrides?.[selectedDepartment]?.monthly?.[month]?.[varId] ?? value;
    return value;
  };
  const isActualizedDriver = (varId: string, month: string) =>
    actualDriverValues[month]?.[varId] !== undefined;

  const focusDriverCell = (rowIndex: number, columnIndex: number) => {
    const selector = `.driver-matrix input[data-row-index="${rowIndex}"][data-column-index="${columnIndex}"]:not(:disabled)`;
    const target = document.querySelector<HTMLInputElement>(selector);
    target?.focus();
    target?.select();
  };

  const handleDriverKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    const movements: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
    };
    const movement = movements[event.key];
    if (!movement) return;
    event.preventDefault();
    focusDriverCell(rowIndex + movement[0], columnIndex + movement[1]);
  };

  const displayVarInput = (varId: string, month: string, isPercent: boolean): string => {
    const key = driverCellKey(varId, month);
    if (editingCells[key] !== undefined) return editingCells[key];
    return formatDriverDisplay(resolveVarDisplay(varId, month), isPercent);
  };

  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Driver assumptions</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isLocked && suggestions.data && (
            <GhostButton
              type="button"
              onClick={applySuggestions}
              title="Populate drivers from historical actuals"
            >
              <Wand2 size={15} /> Suggest from actuals
            </GhostButton>
          )}
          <Settings2 size={18} />
        </div>
      </div>
      <p className="muted driver-note">
        {isLocked
          ? `${scenario?.name} is locked. Driver assumptions are read-only until it is unlocked in Versions.`
          : `Editing ${selectedDepartment} assumptions by month. Child departments inherit these values until they set their own values.`}
      </p>
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => {
            const header = ["Driver", ...monthOptions].join("\t");
            const dataRows = inputVarDefs.map((def) => {
              const isPercent = PERCENT_VAR_IDS.has(def.id);
              const cells = monthOptions.map((month) => {
                const v = resolveVarDisplay(def.id, month);
                return formatDriverDisplay(v, isPercent);
              });
              return [def.label, ...cells].join("\t");
            });
            copyGrid([header, ...dataRows].join("\n"));
          }}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
      </div>
      <div className="driver-matrix-wrap">
        <table className="driver-matrix spreadsheet-grid">
          <thead>
            <tr>
              <th>Driver</th>
              {monthOptions.map((month) => (
                <th key={month}>{month}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {varDefs.map((def) => {
              const isPercent = PERCENT_VAR_IDS.has(def.id);
              return (
                <tr key={def.id}>
                  <th scope="row">
                    {def.label}
                    {def.kind === "calculated" ? (
                      <span className="formula-badge">formula</span>
                    ) : null}
                  </th>
                  {monthOptions.map((month, colIndex) => (
                    <td key={`${def.id}-${month}`}>
                      {def.kind === "calculated" ? (
                        <span className="muted calculated-cell">—</span>
                      ) : (
                        <Input
                          aria-label={`${def.label} ${month}`}
                          data-column-index={colIndex}
                          data-row-index={inputVarDefs.indexOf(def)}
                          disabled={isLocked || isActualizedDriver(def.id, month)}
                          inputMode="decimal"
                          type="text"
                          value={displayVarInput(def.id, month, isPercent)}
                          onBlur={() =>
                            setEditingCells((current) => {
                              const next = { ...current };
                              delete next[driverCellKey(def.id, month)];
                              return next;
                            })
                          }
                          onChange={(event) => {
                            const nextText = event.target.value;
                            setEditingCells((current) => ({
                              ...current,
                              [driverCellKey(def.id, month)]: nextText,
                            }));
                            const value = parseDriverInput(nextText, isPercent);
                            if (value !== null) updateVar(month, def.id, value);
                          }}
                          onFocus={() =>
                            setEditingCells((current) => ({
                              ...current,
                              [driverCellKey(def.id, month)]: formatDriverEditValue(
                                resolveVarDisplay(def.id, month),
                                isPercent,
                              ),
                            }))
                          }
                          onKeyDown={(event) =>
                            handleDriverKeyDown(event, inputVarDefs.indexOf(def), colIndex)
                          }
                          onPaste={(event) => {
                            const rowIndex = Number(event.currentTarget.dataset.rowIndex ?? 0);
                            const columnIndex = Number(
                              event.currentTarget.dataset.columnIndex ?? 0,
                            );
                            const text = event.clipboardData.getData("text");
                            const lines = parsePastedGrid(text);
                            if (!isMultiCellGrid(lines)) return;
                            event.preventDefault();
                            applyVarPaste(text, rowIndex, columnIndex);
                          }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button
          disabled={isLocked || !draft || save.isPending}
          onClick={() => active && save.mutate(active)}
        >
          <Save size={16} /> {save.isPending ? "Saving…" : "Save scenario"}
        </Button>
        {recalculating && !save.isPending ? (
          <span className="muted" style={{ fontSize: 13 }}>
            Recalculating forecast…
          </span>
        ) : null}
      </div>
      {save.error ? <p className="error">{save.error.message}</p> : null}
    </Panel>
  );
}

function ForecastGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: ForecastRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const months = getMonths(rows);
  const rawPivotRows = pivotActualRows(rows, departmentHierarchy, accountHierarchy);
  if (rawPivotRows.length === 0) {
    return (
      <EmptyState title="No forecast cells" body="Import actuals or select another scenario." />
    );
  }
  const { rows: pivotRows, periods } =
    granularity === "quarter"
      ? collapsePivotActualRowsToQuarters(rawPivotRows, months)
      : collapsePivotActualRowsToMonthsWithYearTotal(rawPivotRows, months);
  return (
    <>
      <div className="grid-toolbar" style={{ justifyContent: "space-between" }}>
        <div className="tab-bar">
          <button
            type="button"
            className={granularity === "month" ? "active" : ""}
            onClick={() => setGranularity("month")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={granularity === "quarter" ? "active" : ""}
            onClick={() => setGranularity("quarter")}
          >
            Quarterly
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <GhostButton
            type="button"
            aria-label="Copy grid"
            onClick={() => copyGrid(buildActualGridTsv(periods, pivotRows))}
          >
            <Copy size={15} /> Copy grid
          </GhostButton>
          <ExportMenu
            onCsv={() => {
              const m = buildActualGridMatrix(periods, pivotRows);
              exportCsv("forecast.csv", m.headers, m.rows);
            }}
            onXlsx={() => {
              const m = buildActualGridMatrix(periods, pivotRows);
              void exportXlsx("forecast.xlsx", "Forecast", m.headers, m.rows);
            }}
            onPdf={() => {
              const m = buildActualGridMatrix(periods, pivotRows);
              exportPdf("forecast.pdf", "Forecast", m.headers, m.rows);
            }}
          />
        </div>
      </div>
      <div className="spreadsheet-wrap">
        <table className="spreadsheet-grid">
          <thead>
            <tr>
              <th>Department</th>
              <th>Account</th>
              {periods.map((period) => (
                <th key={period} className={isFYPeriod(period) ? "fy-total-col" : undefined}>
                  {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pivotRows.map((row) => (
              <tr
                key={`${row.department}-${row.account}`}
                className={row.isParent ? "department-rollup-row" : undefined}
              >
                <th scope="row" style={{ paddingLeft: `${8 + row.hierarchyLevel * 16}px` }}>
                  {row.department}
                </th>
                <td>{row.account}</td>
                {periods.map((period) => (
                  <td
                    key={period}
                    className={`numeric-cell${isFYPeriod(period) ? " fy-total-col" : ""}`}
                  >
                    {formatCell(row.account, row.values[period] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
