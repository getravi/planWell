import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Save, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ActualRow,
  DimensionMember,
  DriverAssumptions,
  ForecastRow,
  ScenarioAssumptions,
} from "../../domain/types.ts";
import { client, type ScenarioRecord } from "../api.ts";
import {
  buildActualGridMatrix,
  buildActualGridTsv,
  buildDriverGridTsv,
  copyGrid,
  formatHorizonLabel,
  getMonths,
  isMultiCellGrid,
  parsePastedGrid,
  pivotActualRows,
} from "../pivot.ts";
import {
  buildAncestorLookup,
  flattenMembers,
  orderedNamesFromMembers,
  orderedOptionsFromMembers,
} from "../dimension-utils.ts";
import { formatCell } from "../format.ts";
import { Button, EmptyState, ExportMenu, GhostButton, Input, Panel } from "../ui.tsx";
import { exportCsv, exportPdf, exportXlsx } from "../export.ts";
import { RevenueChart } from "./ActualsPage.tsx";

export function ForecastPage({
  scenarios,
  selected,
  rows,
  departmentFilter,
  departments,
  departmentHierarchy,
  accountHierarchy,
}: {
  scenarios: ScenarioRecord[];
  selected: string;
  rows: ForecastRow[];
  departmentFilter: string;
  departments: string[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const scenario = scenarios.find((item) => item.name === selected);
  const months = [
    ...new Set([
      ...rows.map((row) => row.month),
      ...Object.keys(scenario?.assumptions.monthly ?? {}),
      ...Object.values(scenario?.assumptions.overrides ?? {}).flatMap((override) =>
        Object.keys(override.monthly ?? {}),
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const forecastMonths = getMonths(rows);
  const modelDepartments = orderedNamesFromMembers(flattenMembers(departmentHierarchy), [
    ...departments,
    ...rows.map((row) => row.department),
    ...(departmentFilter === "__all__" ? Object.keys(scenario?.assumptions.overrides ?? {}) : []),
  ]);
  return (
    <div className="grid two">
      <ScenarioEditor
        scenario={scenario}
        months={months}
        departments={modelDepartments}
        departmentHierarchy={departmentHierarchy}
        departmentFilter={departmentFilter}
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
}: {
  scenario?: ScenarioRecord;
  months: string[];
  departments: string[];
  departmentHierarchy: DimensionMember[];
  departmentFilter: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ScenarioAssumptions | null>(null);
  const active = draft ?? scenario?.assumptions;
  const isLocked = Boolean(scenario?.locked);
  const ancestorLookup = useMemo(
    () => buildAncestorLookup(departmentHierarchy),
    [departmentHierarchy],
  );
  const monthOptions = useMemo(() => {
    const scenarioMonths = [
      ...Object.keys(active?.monthly ?? {}),
      ...Object.values(active?.overrides ?? {}).flatMap((override) =>
        Object.keys(override.monthly ?? {}),
      ),
    ];
    return [...new Set([...months, ...scenarioMonths])].sort((left, right) =>
      left.localeCompare(right),
    );
  }, [active, months]);
  const departmentOptions = useMemo(
    () =>
      orderedOptionsFromMembers(departmentHierarchy, [
        ...departments,
        ...Object.keys(active?.overrides ?? {}),
      ]).map((d) => d.name),
    [active, departmentHierarchy, departments],
  );
  const selectedDepartment = departmentOptions.includes(departmentFilter)
    ? departmentFilter
    : (departmentOptions[0] ?? "");
  const save = useMutation({
    mutationFn: client.saveScenario,
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries();
    },
  });

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

  const applyDriverPaste = (text: string, startRow: number, startColumn: number) => {
    const next = structuredClone(active);
    const lines = parsePastedGrid(text);

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
      const driver = driverRows[startRow + rowIndex];
      if (!driver) {
        continue;
      }
      for (let columnIndex = 0; columnIndex < lines[rowIndex].length; columnIndex += 1) {
        const month = monthOptions[startColumn + columnIndex];
        if (!month) {
          continue;
        }
        const rawValue = lines[rowIndex][columnIndex].trim().replace(/[$,%]/g, "");
        if (!rawValue) {
          continue;
        }
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) {
          continue;
        }
        const value = parsed / (driver.percent ? 100 : 1);
        const departmentOverride = next.overrides[selectedDepartment] ?? {};
        next.overrides = {
          ...next.overrides,
          [selectedDepartment]: {
            ...departmentOverride,
            monthly: {
              ...departmentOverride.monthly,
              [month]: {
                ...departmentOverride.monthly?.[month],
                [driver.field]: value,
              },
            },
          },
        };
      }
    }
    setDraft(next);
  };
  const updateDriver = (month: string, field: keyof DriverAssumptions, value: number) => {
    const departmentOverride = active.overrides[selectedDepartment] ?? {};
    const currentMonthOverride = departmentOverride.monthly?.[month] ?? {};
    setDraft({
      ...active,
      overrides: {
        ...active.overrides,
        [selectedDepartment]: {
          ...departmentOverride,
          monthly: {
            ...departmentOverride.monthly,
            [month]: { ...currentMonthOverride, [field]: value },
          },
        },
      },
    });
  };

  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Driver assumptions</h2>
        <Settings2 size={18} />
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
          onClick={() =>
            copyGrid(
              buildDriverGridTsv(
                monthOptions,
                driverRows,
                (month) =>
                  getDisplayDrivers(
                    active,
                    month,
                    selectedDepartment,
                    ancestorLookup,
                  ) as unknown as Record<string, number>,
              ),
            )
          }
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
            {driverRows.map((driver) => (
              <tr key={driver.field}>
                <th scope="row">{driver.label}</th>
                {monthOptions.map((month) => {
                  const displayDrivers = getDisplayDrivers(
                    active,
                    month,
                    selectedDepartment,
                    ancestorLookup,
                  );
                  return (
                    <td key={`${driver.field}-${month}`}>
                      <Input
                        aria-label={`${driver.label} ${month}`}
                        data-column-index={monthOptions.indexOf(month)}
                        data-row-index={driverRows.indexOf(driver)}
                        disabled={isLocked}
                        type="number"
                        step={driver.percent ? 0.1 : 100}
                        value={
                          driver.percent
                            ? displayDrivers[driver.field] * 100
                            : displayDrivers[driver.field]
                        }
                        onChange={(event) =>
                          updateDriver(
                            month,
                            driver.field,
                            Number(event.target.value) / (driver.percent ? 100 : 1),
                          )
                        }
                        onPaste={(event) => {
                          const rowIndex = Number(event.currentTarget.dataset.rowIndex ?? 0);
                          const columnIndex = Number(event.currentTarget.dataset.columnIndex ?? 0);
                          const text = event.clipboardData.getData("text");
                          const lines = parsePastedGrid(text);
                          if (!isMultiCellGrid(lines)) {
                            return;
                          }
                          event.preventDefault();
                          applyDriverPaste(text, rowIndex, columnIndex);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        disabled={isLocked || !draft || save.isPending}
        onClick={() => active && save.mutate(active)}
      >
        <Save size={16} /> Save scenario
      </Button>
      {save.error ? <p className="error">{save.error.message}</p> : null}
    </Panel>
  );
}

function getCompanyMonthDrivers(scenario: ScenarioAssumptions, month: string): DriverAssumptions {
  return { ...scenario.global, ...scenario.monthly?.[month] };
}

function getDisplayDrivers(
  scenario: ScenarioAssumptions,
  month: string,
  department: string,
  ancestorLookup: Map<string, string[]>,
): DriverAssumptions {
  const drivers = getCompanyMonthDrivers(scenario, month);
  const levels = [...(ancestorLookup.get(department) ?? []), department];
  for (const level of levels) {
    const { monthly, ...levelDefault } = scenario.overrides[level] ?? {};
    Object.assign(drivers, levelDefault, monthly?.[month]);
  }
  return drivers;
}

const driverRows: {
  field: keyof DriverAssumptions;
  label: string;
  percent?: boolean;
}[] = [
  { field: "revenueGrowthRate", label: "Revenue growth", percent: true },
  { field: "cogsPctOfRevenue", label: "COGS % revenue", percent: true },
  { field: "headcountGrowthRate", label: "Headcount growth", percent: true },
  { field: "costPerHead", label: "Cost per head" },
];

function ForecastGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: ActualRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const months = getMonths(rows);
  const pivotRows = pivotActualRows(rows, departmentHierarchy, accountHierarchy);
  if (pivotRows.length === 0) {
    return (
      <EmptyState title="No forecast cells" body="Import actuals or select another scenario." />
    );
  }
  return (
    <>
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildActualGridTsv(months, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
        <ExportMenu
          onCsv={() => { const m = buildActualGridMatrix(months, pivotRows); exportCsv("forecast.csv", m.headers, m.rows); }}
          onXlsx={() => { const m = buildActualGridMatrix(months, pivotRows); void exportXlsx("forecast.xlsx", "Forecast", m.headers, m.rows); }}
          onPdf={() => { const m = buildActualGridMatrix(months, pivotRows); exportPdf("forecast.pdf", "Forecast", m.headers, m.rows); }}
        />
      </div>
      <div className="spreadsheet-wrap">
      <table className="spreadsheet-grid">
        <thead>
          <tr>
            <th>Department</th>
            <th>Account</th>
            {months.map((month) => (
              <th key={month}>{month}</th>
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
              {months.map((month) => (
                <td key={month} className="numeric-cell">
                  {formatCell(row.account, row.values[month] ?? 0)}
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

