import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChartNoAxesCombined,
  ChevronDown,
  Copy,
  Database,
  FileUp,
  GitCompareArrows,
  Network,
  Plus,
  Save,
  Settings,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActualRow,
  DimensionImpact,
  DimensionKind,
  DimensionMember,
  Dimensions,
  DriverAssumptions,
  ForecastRow,
  ScenarioAssumptions,
  VarianceRow,
} from "../domain/types.ts";
import { client, type MetricSummary, type ScenarioRecord, type VersionRecord } from "./api.ts";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  GhostButton,
  Input,
  Label,
  Panel,
  Select,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SiteHeader,
} from "./ui.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlanWellApp />
    </QueryClientProvider>
  );
}

function PlanWellApp() {
  const me = useQuery({ queryKey: ["me"], queryFn: client.me });
  if (me.isLoading) {
    return <div className="screen-center">Loading PlanWell...</div>;
  }
  if (me.isError) {
    return <LoginScreen onSignedIn={() => void me.refetch()} />;
  }
  if (!me.data) {
    return <div className="screen-center">Loading workspace...</div>;
  }
  return <Workbench userEmail={me.data.user.email} />;
}

function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("director@planwell.local");
  const [password, setPassword] = useState("planwell-demo");
  const login = useMutation({
    mutationFn: () => client.login(email, password),
    onSuccess: onSignedIn,
  });

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div>
          <p className="eyebrow">PlanWell</p>
          <h1>FP&A planning workbench</h1>
          <p>
            Import actuals, tune driver assumptions, compare scenarios, and ask grounded questions
            over the planning cube.
          </p>
        </div>
        <div className="mini-model">
          <span>Actuals</span>
          <span>Drivers</span>
          <span>Forecast</span>
          <span>Analyst</span>
        </div>
      </section>
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate();
        }}
      >
        <p className="eyebrow">Local demo</p>
        <h2>Sign in</h2>
        <label>
          <Label>Email</Label>
          <Input
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <Label>Password</Label>
          <Input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {login.error ? <p className="error">{login.error.message}</p> : null}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </main>
  );
}

function Workbench({ userEmail }: { userEmail: string }) {
  const [view, setView] = useState("Forecast Model");
  const [adminOpen, setAdminOpen] = useState(false);
  const [leftScenario, setLeftScenario] = useState("Base Case");
  const [rightScenario, setRightScenario] = useState("Aggressive Growth");
  const [forecastDepartment, setForecastDepartment] = useState("__all__");
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: client.scenarios });
  const actuals = useQuery({ queryKey: ["actuals"], queryFn: client.actuals });
  const dimensions = useQuery({
    queryKey: ["dimensions"],
    queryFn: client.dimensions,
    enabled:
      view === "Dimensions" ||
      view === "Forecast Model" ||
      view === "Scenarios" ||
      view === "Variance",
  });
  const versions = useQuery({
    queryKey: ["versions"],
    queryFn: client.versions,
    enabled: view === "Versions",
  });
  const forecast = useQuery({
    queryKey: ["forecast", leftScenario],
    queryFn: () => client.forecast(leftScenario),
    enabled: Boolean(leftScenario),
  });
  const variance = useQuery({
    queryKey: ["variance", leftScenario, rightScenario],
    queryFn: () => client.variance(leftScenario, rightScenario),
    enabled: Boolean(leftScenario && rightScenario),
  });
  const scenarioNames = scenarios.data?.scenarios.map((scenario) => scenario.name) ?? [];
  const forecastRows = forecast.data?.rows ?? [];
  const departmentMembers = useMemo(
    () => flattenMembers(dimensions.data?.department ?? []),
    [dimensions.data?.department],
  );
  const departmentDescendants = useMemo(
    () => buildDescendantLookup(dimensions.data?.department ?? []),
    [dimensions.data?.department],
  );
  const forecastDepartments = useMemo(
    () =>
      orderedNamesFromMembers(departmentMembers, [
        ...forecastRows.map((row) => row.department),
        ...(forecast.data?.summary.departments.map((item) => item.department) ?? []),
      ]),
    [departmentMembers, forecast.data?.summary.departments, forecastRows],
  );
  const filteredForecastRows = useMemo(() => {
    if (forecastDepartment === "__all__") {
      return forecastRows;
    }
    const allowedDepartments = departmentDescendants.get(forecastDepartment) ?? [
      forecastDepartment,
    ];
    return forecastRows.filter((row) => allowedDepartments.includes(row.department));
  }, [departmentDescendants, forecastDepartment, forecastRows]);
  const currentSummary =
    view === "Forecast Model" && forecastDepartment !== "__all__"
      ? summarizeRows(filteredForecastRows)
      : (forecast.data?.summary ?? actuals.data?.summary);
  const showScenarioPicker =
    view === "Forecast Model" || view === "Scenarios" || view === "Variance" || view === "Analyst";
  const isAdminView = view === "Dimensions" || view === "Versions" || view === "Schema";

  useEffect(() => {
    if (forecastDepartment !== "__all__" && !forecastDepartments.includes(forecastDepartment)) {
      setForecastDepartment("__all__");
    }
  }, [forecastDepartment, forecastDepartments]);

  return (
    <SidebarProvider className="app-shell">
      <Sidebar>
        <SidebarHeader className="brand">
          <span className="brand-mark">PW</span>
          <div>
            <strong>PlanWell</strong>
            <small>{userEmail}</small>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {[
                  ["Actuals", FileUp],
                  ["Forecast Model", Settings2],
                  ["Scenarios", ChartNoAxesCombined],
                  ["Variance", GitCompareArrows],
                  ["Analyst", Bot],
                ].map(([label, Icon]) => (
                  <SidebarMenuItem key={label as string}>
                    <SidebarMenuButton
                      isActive={view === label}
                      onClick={() => setView(label as string)}
                    >
                      <Icon size={17} />
                      {label as string}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="nav-group-toggle"
                    isActive={isAdminView}
                    aria-expanded={adminOpen}
                    aria-controls="admin-nav"
                    onClick={() => setAdminOpen((open) => !open)}
                  >
                    <Settings size={17} />
                    Admin
                    <ChevronDown size={15} className={adminOpen ? "chevron open" : "chevron"} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              {adminOpen ? (
                <SidebarMenu className="nav-sublist" id="admin-nav">
                  {[
                    ["Dimensions", Network],
                    ["Versions", Copy],
                    ["Schema", Database],
                  ].map(([label, Icon]) => (
                    <SidebarMenuItem key={label as string}>
                      <SidebarMenuButton
                        isActive={view === label}
                        onClick={() => setView(label as string)}
                      >
                        <Icon size={16} />
                        {label as string}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              ) : null}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="workspace">
        <SiteHeader className="topbar">
          <div>
            <p className="eyebrow">PlanWell / Modeling Workbench</p>
            <h1>{view}</h1>
          </div>
          {view !== "Schema" && view !== "Dimensions" && view !== "Versions" ? (
            <span className="status-pill">Live model</span>
          ) : null}
          <div className="scenario-pickers">
            {view === "Forecast Model" ? (
              <label>
                <Label>Forecast department</Label>
                <Select
                  aria-label="Forecast department"
                  value={forecastDepartment}
                  onChange={(event) => setForecastDepartment(event.target.value)}
                >
                  <option value="__all__">All departments</option>
                  {forecastDepartments.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {showScenarioPicker ? (
              <label>
                <Label>Primary scenario</Label>
                <Select
                  value={leftScenario}
                  onChange={(event) => setLeftScenario(event.target.value)}
                >
                  {scenarioNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </label>
            ) : null}
            {view === "Scenarios" || view === "Variance" ? (
              <label>
                <Label>Compare to</Label>
                <Select
                  value={rightScenario}
                  onChange={(event) => setRightScenario(event.target.value)}
                >
                  {scenarioNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </label>
            ) : null}
          </div>
        </SiteHeader>

        {view !== "Schema" && view !== "Dimensions" && view !== "Versions" ? (
          <KpiStrip summary={currentSummary} />
        ) : null}

        {view === "Actuals" ? (
          <ActualsView actuals={actuals.data?.rows ?? []} summary={actuals.data?.summary} />
        ) : null}
        {view === "Forecast Model" ? (
          <ForecastView
            scenarios={scenarios.data?.scenarios ?? []}
            selected={leftScenario}
            rows={filteredForecastRows}
            departmentFilter={forecastDepartment}
            departments={forecastDepartments}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
          />
        ) : null}
        {view === "Scenarios" ? (
          <ScenarioComparison
            rows={variance.data?.rows ?? []}
            left={leftScenario}
            right={rightScenario}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
          />
        ) : null}
        {view === "Variance" ? (
          <VarianceView
            rows={variance.data?.rows ?? []}
            left={leftScenario}
            right={rightScenario}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
          />
        ) : null}
        {view === "Analyst" ? (
          <AnalystView scenario={leftScenario} compareScenario={rightScenario} />
        ) : null}
        {view === "Dimensions" ? (
          <ModelStructureView
            dimensions={dimensions.data}
            error={dimensions.error}
            isLoading={dimensions.isLoading}
            onRetry={() => void dimensions.refetch()}
          />
        ) : null}
        {view === "Versions" ? (
          <VersionsView
            versions={versions.data?.versions ?? []}
            error={versions.error}
            isLoading={versions.isLoading}
            onRetry={() => void versions.refetch()}
          />
        ) : null}
        {view === "Schema" ? <SchemaView /> : null}
      </SidebarInset>
    </SidebarProvider>
  );
}

function KpiStrip({ summary }: { summary?: MetricSummary }) {
  const kpis = summary?.kpis;
  return (
    <section className="kpi-strip">
      <Kpi label="Revenue" value={currency(kpis?.revenue ?? 0)} />
      <Kpi
        label="Gross margin"
        value={currency(kpis?.grossMargin ?? 0)}
        detail={percent(kpis?.grossMarginPct)}
      />
      <Kpi label="OpEx ratio" value={percent(kpis?.opexRatio)} />
      <Kpi label="Headcount" value={number(kpis?.headcount ?? 0)} />
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="kpi">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle>{value}</CardTitle>
        {detail ? <small>{detail}</small> : null}
      </CardContent>
    </Card>
  );
}

function ActualsView({ actuals, summary }: { actuals: ActualRow[]; summary?: MetricSummary }) {
  return (
    <div className="grid two">
      <ImportPanel />
      <Panel>
        <div className="panel-heading">
          <h2>Department cost breakdown</h2>
          <span>{summary?.months.length ?? 0} months imported</span>
        </div>
        {summary?.departments.length ? (
          <CostBreakdown departments={summary.departments} />
        ) : (
          <EmptyState
            title="No actuals imported"
            body="Download a sample CSV or upload your own actuals to populate the cube."
          />
        )}
      </Panel>
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Historical revenue</h2>
          <span>12 month actuals</span>
        </div>
        <RevenueChart rows={actuals} />
      </Panel>
    </div>
  );
}

function ImportPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const importCsv = useMutation({
    mutationFn: client.importCsv,
    onSuccess: async (result) => {
      setStatus(
        `Imported ${result.diagnostics.rowsImported} rows from ${result.diagnostics.shape} CSV.`,
      );
      await queryClient.invalidateQueries();
    },
  });
  return (
    <Panel>
      <div className="panel-heading">
        <h2>Import actuals</h2>
        <FileUp size={18} />
      </div>
      <p className="muted">
        Upload long or wide CSV actuals. Data is normalized into month, department, account, and
        value.
      </p>
      <div className="sample-links">
        <a href="/api/sample-csvs/long">Long sample</a>
        <a href="/api/sample-csvs/wide">Wide sample</a>
      </div>
      <Input
        type="file"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }
          importCsv.mutate(await file.text());
        }}
      />
      {status ? <p className="success">{status}</p> : null}
      {importCsv.error ? <p className="error">{importCsv.error.message}</p> : null}
    </Panel>
  );
}

function ForecastView({
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
          <span>{rows.length} forecast cells</span>
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
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [hasManualAssumptionLevel, setHasManualAssumptionLevel] = useState(false);
  const active = draft ?? scenario?.assumptions;
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
  const departmentOptions = useMemo(() => {
    const hierarchyNames = flattenMembers(departmentHierarchy).map((member) => member.name);
    const source =
      hierarchyNames.length > 0
        ? hierarchyNames
        : [...departments, ...Object.keys(active?.overrides ?? {})];
    return [...new Set(source)];
  }, [active, departmentHierarchy, departments]);
  const save = useMutation({
    mutationFn: client.saveScenario,
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (departmentFilter !== "__all__") {
      if (departmentOptions.includes(departmentFilter)) {
        setSelectedDepartment(departmentFilter);
        setHasManualAssumptionLevel(false);
      }
      return;
    }
    if (
      !hasManualAssumptionLevel &&
      departmentOptions[0] &&
      selectedDepartment !== departmentOptions[0]
    ) {
      setSelectedDepartment(departmentOptions[0]);
      return;
    }
    if (!selectedDepartment || !departmentOptions.includes(selectedDepartment)) {
      setSelectedDepartment(departmentOptions[0] ?? "");
      setHasManualAssumptionLevel(false);
    }
  }, [departmentFilter, departmentOptions, hasManualAssumptionLevel, selectedDepartment]);

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
      <div className="driver-controls">
        <label>
          <Label>Assumption level</Label>
          <Select
            aria-label="Assumption level"
            value={selectedDepartment}
            onChange={(event) => {
              setSelectedDepartment(event.target.value);
              setHasManualAssumptionLevel(true);
            }}
          >
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="muted driver-note">
        Editing {selectedDepartment} assumptions by month. Child departments inherit these values
        until they set their own values.
      </p>
      <div className="driver-matrix-wrap">
        <div className="grid-toolbar">
          <GhostButton
            type="button"
            aria-label="Copy grid"
            onClick={() =>
              copyGrid(buildDriverGridTsv(active, monthOptions, selectedDepartment, ancestorLookup))
            }
          >
            <Copy size={15} /> Copy grid
          </GhostButton>
        </div>
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
      <Button disabled={!draft || save.isPending} onClick={() => active && save.mutate(active)}>
        <Save size={16} /> Save scenario
      </Button>
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

function buildDriverGridTsv(
  scenario: ScenarioAssumptions,
  months: string[],
  department: string,
  ancestorLookup: Map<string, string[]>,
): string {
  const rows = driverRows.map((driver) => {
    const values = months.map((month) => {
      const displayDrivers = getDisplayDrivers(scenario, month, department, ancestorLookup);
      const value = displayDrivers[driver.field];
      return driver.percent ? number(value * 100) : number(value);
    });
    return [driver.label, ...values].join("\t");
  });
  return [["Driver", ...months].join("\t"), ...rows].join("\n");
}

function ScenarioComparison({
  rows,
  left,
  right,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const chartRows = useMemo(() => aggregateVarianceByMonth(rows, "Revenue"), [rows]);
  return (
    <div className="grid two">
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Compare scenarios</h2>
          <span>
            {left} vs {right}
          </span>
        </div>
        <ResponsiveContainer height={300}>
          <LineChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
            <Tooltip formatter={(value) => currency(Number(value))} />
            <Legend />
            <Line dataKey="leftValue" name={left} stroke="#166534" strokeWidth={2} />
            <Line dataKey="rightValue" name={right} stroke="#1d4ed8" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel className="span-two">
        <VarianceGrid
          rows={rows.filter((row) => row.account === "Revenue")}
          departmentHierarchy={departmentHierarchy}
          accountHierarchy={accountHierarchy}
        />
      </Panel>
    </div>
  );
}

function VarianceView({
  rows,
  left,
  right,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  left: string;
  right: string;
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const insights = buildVarianceInsights(rows);
  return (
    <Panel>
      <div className="panel-heading">
        <h2>Variance analysis</h2>
        <span>
          {left} vs {right}
        </span>
      </div>
      <div className="variance-insights">
        <VarianceInsightCard title="Largest favorable change" insight={insights.favorable} />
        <VarianceInsightCard title="Largest unfavorable change" insight={insights.unfavorable} />
      </div>
      <VarianceGrid
        rows={rows}
        departmentHierarchy={departmentHierarchy}
        accountHierarchy={accountHierarchy}
      />
    </Panel>
  );
}

function VarianceInsightCard({ title, insight }: { title: string; insight?: VarianceInsight }) {
  return (
    <div className="variance-insight">
      <span>{title}</span>
      <strong>{insight ? describeVarianceInsight(insight) : "No material change"}</strong>
      {insight ? (
        <small>
          {insight.department} · {insight.month}
        </small>
      ) : null}
    </div>
  );
}

function ModelStructureView({
  dimensions,
  error,
  isLoading,
  onRetry,
}: {
  dimensions?: Record<DimensionKind, DimensionMember[]>;
  error: Error | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const [activeKind, setActiveKind] = useState<DimensionKind>("department");
  if (isLoading) {
    return <div className="screen-center">Loading dimensions...</div>;
  }
  if (error) {
    return (
      <Panel>
        <EmptyState
          title="Could not load dimensions"
          body="The dimensions API did not return the current model members."
        />
        <p className="error centered-status">{error.message}</p>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }
  const labels: Record<DimensionKind, string> = {
    department: "Departments",
    account: "Accounts",
    time: "Time",
  };
  return (
    <div className="model-structure">
      <section className="schema-summary">
        <div>
          <p className="eyebrow">Dimension setup</p>
          <h2>Dimensions</h2>
        </div>
        <p className="muted">
          Maintain the leaf members used by the planning cube, with single-parent rollups for
          reporting summaries.
        </p>
      </section>
      <div className="tab-bar" role="tablist" aria-label="Model dimensions">
        {(Object.keys(labels) as DimensionKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            className={activeKind === kind ? "active" : ""}
            onClick={() => setActiveKind(kind)}
          >
            {labels[kind]}
          </button>
        ))}
      </div>
      <DimensionEditor kind={activeKind} members={dimensions?.[activeKind] ?? []} />
    </div>
  );
}

function DimensionEditor({ kind, members }: { kind: DimensionKind; members: DimensionMember[] }) {
  const queryClient = useQueryClient();
  const flatMembers = useMemo(() => flattenMembers(members), [members]);
  const editableMembers =
    kind === "time" ? flatMembers.filter((member) => isMonth(member.name)) : flatMembers;
  const [selectedName, setSelectedName] = useState("");
  const selected =
    editableMembers.find((member) => member.name === selectedName) ?? editableMembers[0];
  const [draftName, setDraftName] = useState(selected?.name ?? "");
  const [draftParent, setDraftParent] = useState<string | null>(selected?.parentName ?? null);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string | null>(null);
  const [impact, setImpact] = useState<DimensionImpact | null>(null);
  const [status, setStatus] = useState("");
  const [draggedName, setDraggedName] = useState("");
  const [dragOverName, setDragOverName] = useState("");
  const draggedNameRef = useRef("");
  const pointerDragRef = useRef<{
    isDragging: boolean;
    name: string;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    setDraftName(selected?.name ?? "");
    setDraftParent(selected?.parentName ?? null);
    setImpact(null);
  }, [selected?.name, selected?.parentName]);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };
  const create = useMutation({
    mutationFn: () =>
      client.createDimensionMember(kind, newName, kind === "time" ? null : newParent),
    onSuccess: async () => {
      setNewName("");
      setStatus("Member added.");
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: () =>
      selected
        ? client.updateDimensionMember(kind, selected.name, {
            name: draftName,
            parentName: kind === "time" ? null : draftParent,
          })
        : Promise.reject(new Error("Select a member first.")),
    onSuccess: async () => {
      setSelectedName(draftName);
      setStatus("Member saved.");
      await refresh();
    },
  });
  const selectedSiblings = editableMembers.filter(
    (member) => member.parentName === (selected?.parentName ?? null),
  );
  const selectedSiblingIndex = selected
    ? selectedSiblings.findIndex((member) => member.name === selected.name)
    : -1;
  const moveMember = useMutation({
    mutationFn: ({ memberName, sortOrder }: { memberName: string; sortOrder: number }) =>
      client.updateDimensionMember(kind, memberName, { sortOrder }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["dimensions"] });
      const previousDimensions = queryClient.getQueryData<Dimensions>(["dimensions"]);
      if (previousDimensions) {
        queryClient.setQueryData(
          ["dimensions"],
          updateDimensionSortOrder(
            previousDimensions,
            kind,
            variables.memberName,
            variables.sortOrder,
          ),
        );
      }
      return { previousDimensions };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousDimensions) {
        queryClient.setQueryData(["dimensions"], context.previousDimensions);
      }
    },
    onSuccess: async (result, variables) => {
      queryClient.setQueryData(["dimensions"], result.dimensions);
      setSelectedName(variables.memberName);
      setDraggedName("");
      setDragOverName("");
      setStatus("Member order updated.");
    },
  });
  const moveSelectedMember = (direction: "up" | "down") => {
    if (!selected) {
      setStatus("Select a member first.");
      return;
    }
    const sibling =
      direction === "up"
        ? selectedSiblings[selectedSiblingIndex - 1]
        : selectedSiblings[selectedSiblingIndex + 1];
    if (!sibling) {
      setStatus("No sibling to move past.");
      return;
    }
    moveMember.mutate({
      memberName: selected.name,
      sortOrder:
        direction === "up"
          ? (sibling.sortOrder ?? selectedSiblingIndex) - 0.5
          : (sibling.sortOrder ?? selectedSiblingIndex) + 0.5,
    });
  };
  const dropMemberOnTarget = (targetName: string) => {
    const currentDraggedName = draggedNameRef.current || draggedName;
    if (!currentDraggedName || currentDraggedName === targetName) {
      setDraggedName("");
      setDragOverName("");
      draggedNameRef.current = "";
      return;
    }
    const dragged = editableMembers.find((member) => member.name === currentDraggedName);
    const target = editableMembers.find((member) => member.name === targetName);
    if (!dragged || !target) {
      setDraggedName("");
      setDragOverName("");
      draggedNameRef.current = "";
      return;
    }
    if (dragged.parentName !== target.parentName) {
      setStatus("Drop on a sibling to reorder.");
      setDraggedName("");
      setDragOverName("");
      draggedNameRef.current = "";
      return;
    }
    const targetSiblings = editableMembers.filter(
      (member) => member.parentName === (target.parentName ?? null),
    );
    const draggedIndex = targetSiblings.findIndex((member) => member.name === dragged.name);
    const targetIndex = targetSiblings.findIndex((member) => member.name === target.name);
    moveMember.mutate({
      memberName: dragged.name,
      sortOrder:
        draggedIndex < targetIndex
          ? (target.sortOrder ?? targetIndex) + 0.5
          : (target.sortOrder ?? targetIndex) - 0.5,
    });
  };
  const findPointerTargetName = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement)) {
      return "";
    }
    return element.closest<HTMLElement>("[data-dimension-member]")?.dataset.dimensionMember ?? "";
  };
  const clearPointerDrag = () => {
    pointerDragRef.current = null;
    draggedNameRef.current = "";
    setDraggedName("");
    setDragOverName("");
  };
  const handlePointerDragStart = (name: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    pointerDragRef.current = {
      isDragging: false,
      name,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag) {
      return;
    }
    const hasMoved =
      Math.abs(event.clientX - pointerDrag.startX) > 4 ||
      Math.abs(event.clientY - pointerDrag.startY) > 4;
    if (!pointerDrag.isDragging && hasMoved) {
      pointerDrag.isDragging = true;
      draggedNameRef.current = pointerDrag.name;
      setSelectedName(pointerDrag.name);
      setDraggedName(pointerDrag.name);
      setStatus("Dragging member...");
    }
    if (pointerDrag.isDragging) {
      event.preventDefault();
      const targetName = findPointerTargetName(event);
      if (targetName) {
        setDragOverName(targetName);
      }
    }
  };
  const handlePointerDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!pointerDrag.isDragging) {
      clearPointerDrag();
      return;
    }
    suppressNextClickRef.current = true;
    const targetName = findPointerTargetName(event);
    if (targetName) {
      dropMemberOnTarget(targetName);
    } else {
      clearPointerDrag();
    }
  };
  const loadImpact = useMutation({
    mutationFn: () =>
      selected
        ? client.dimensionImpact(kind, selected.name)
        : Promise.reject(new Error("Select a member first.")),
    onSuccess: (result) => setImpact(result.impact),
  });
  const remove = useMutation({
    mutationFn: () =>
      selected
        ? client.deleteDimensionMember(kind, selected.name, true)
        : Promise.reject(new Error("Select a member first.")),
    onSuccess: async () => {
      setImpact(null);
      setSelectedName("");
      setStatus("Member deleted.");
      await refresh();
    },
  });
  const parentOptions = flatMembers.filter(
    (member) => member.name !== selected?.name && (kind !== "time" || !isMonth(member.name)),
  );
  const deleteImpact = impact ?? undefined;
  const currentError =
    create.error?.message ??
    update.error?.message ??
    moveMember.error?.message ??
    loadImpact.error?.message ??
    remove.error?.message;

  return (
    <div className="dimension-layout">
      <Panel>
        <div className="panel-heading">
          <h2>{dimensionTitle(kind)} tree</h2>
          <Network size={18} />
        </div>
        {members.length ? (
          <div className="dimension-tree" onDragLeave={() => setDragOverName("")}>
            {members.map((member) => (
              <DimensionTreeNode
                key={member.name}
                member={member}
                level={0}
                selectedName={selected?.name ?? ""}
                draggable={kind !== "time"}
                draggedName={draggedName}
                dragOverName={dragOverName}
                onSelect={(name) => {
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                  }
                  setSelectedName(name);
                  setStatus("");
                }}
                onDragStart={(name) => {
                  setSelectedName(name);
                  draggedNameRef.current = name;
                  setDraggedName(name);
                  setStatus("Dragging member...");
                }}
                onDragOver={(name) => setDragOverName(name)}
                onDrop={dropMemberOnTarget}
                onDragEnd={() => {
                  setDraggedName("");
                  setDragOverName("");
                  draggedNameRef.current = "";
                }}
                onPointerDown={handlePointerDragStart}
                onPointerMove={handlePointerDragMove}
                onPointerUp={handlePointerDragEnd}
                onPointerCancel={clearPointerDrag}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No members yet" body="Add the first member to start this dimension." />
        )}
        {["Member order updated.", "Dragging member...", "Drop on a sibling to reorder."].includes(
          status,
        ) ? (
          <p className="success centered-status">{status}</p>
        ) : null}
      </Panel>
      <Panel>
        <div className="panel-heading">
          <h2>Edit member</h2>
          <Save size={18} />
        </div>
        {selected ? (
          <div className="dimension-form">
            <label>
              <Label>Member name</Label>
              <Input
                aria-label="Member name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            {kind !== "time" ? (
              <label>
                <Label>Parent</Label>
                <Select
                  aria-label="Parent"
                  value={draftParent ?? ""}
                  onChange={(event) => setDraftParent(event.target.value || null)}
                >
                  <option value="">No parent</option>
                  {parentOptions.map((member) => (
                    <option key={member.name} value={member.name}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="muted">Year and quarter parents are derived from the YYYY-MM month.</p>
            )}
            <div className="button-row">
              <Button
                type="button"
                disabled={!draftName.trim() || update.isPending}
                onClick={() => update.mutate()}
              >
                <Save size={16} /> Save member
              </Button>
              <GhostButton type="button" onClick={() => loadImpact.mutate()}>
                <Trash2 size={16} /> Delete member
              </GhostButton>
            </div>
            {kind !== "time" ? (
              <div className="button-row">
                <GhostButton
                  type="button"
                  disabled={selectedSiblingIndex <= 0 || moveMember.isPending}
                  onClick={() => moveSelectedMember("up")}
                >
                  <ArrowUp size={16} /> Move up
                </GhostButton>
                <GhostButton
                  type="button"
                  disabled={
                    selectedSiblingIndex === -1 ||
                    selectedSiblingIndex >= selectedSiblings.length - 1 ||
                    moveMember.isPending
                  }
                  onClick={() => moveSelectedMember("down")}
                >
                  <ArrowDown size={16} /> Move down
                </GhostButton>
              </div>
            ) : null}
            {deleteImpact ? (
              <div className="impact-box">
                <strong>Delete impact</strong>
                <span>{deleteImpact.actualRows} actual rows</span>
                <span>{deleteImpact.forecastRows} forecast rows</span>
                <span>{deleteImpact.scenarioOverrides} scenario overrides</span>
                <span>{deleteImpact.childCount} child members</span>
                <Button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Delete anyway
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No member selected" body="Choose a member in the tree to edit it." />
        )}
      </Panel>
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Add member</h2>
          <Plus size={18} />
        </div>
        <div className="dimension-add-row">
          <label>
            <Label>{kind === "time" ? "Month or year" : "Name"}</Label>
            <Input
              aria-label="New member name"
              placeholder={kind === "time" ? "2027 or 2027-01" : "New member"}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          {kind !== "time" ? (
            <label>
              <Label>Parent</Label>
              <Select
                aria-label="New member parent"
                value={newParent ?? ""}
                onChange={(event) => setNewParent(event.target.value || null)}
              >
                <option value="">No parent</option>
                {flatMembers.map((member) => (
                  <option key={member.name} value={member.name}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button
            type="button"
            disabled={!newName.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={16} /> Add member
          </Button>
        </div>
        {status ? <p className="success">{status}</p> : null}
        {currentError ? <p className="error">{currentError}</p> : null}
      </Panel>
    </div>
  );
}

function VersionsView({
  versions,
  error,
  isLoading,
  onRetry,
}: {
  versions: VersionRecord[];
  error: Error | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VersionRecord | null>(null);

  useEffect(() => {
    setSourceId((current) => current || versions[0]?.id || "");
    setDraftNames((current) => ({
      ...Object.fromEntries(versions.map((version) => [version.id, version.name])),
      ...current,
    }));
  }, [versions]);

  const syncVersions = (nextVersions: VersionRecord[]) => {
    queryClient.setQueryData(["versions"], { versions: nextVersions });
  };
  const refreshPlanningData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scenarios"] }),
      queryClient.invalidateQueries({ queryKey: ["forecast"] }),
      queryClient.invalidateQueries({ queryKey: ["variance"] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () => client.createVersion(newName, sourceId),
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setNewName("");
      setCreateOpen(false);
      setStatus("Version added.");
      await refreshPlanningData();
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => client.renameVersion(id, name),
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setStatus("Version saved.");
      await refreshPlanningData();
    },
  });
  const remove = useMutation({
    mutationFn: (version: VersionRecord) => client.deleteVersion(version.id),
    onMutate: async (version) => {
      const previous = queryClient.getQueryData<{ versions: VersionRecord[] }>(["versions"]);
      const currentVersions = previous?.versions ?? versions;
      syncVersions(currentVersions.filter((item) => item.id !== version.id));
      setPendingDelete(null);
      return { previous };
    },
    onError: (_error, _version, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["versions"], context.previous);
      }
      setStatus("Could not delete version.");
    },
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setStatus("Version deleted.");
      await refreshPlanningData();
    },
  });
  const saveVersionName = (version: VersionRecord) => {
    const name = (draftNames[version.id] ?? version.name).trim();
    if (!name || name === version.name) {
      return;
    }
    rename.mutate({ id: version.id, name });
  };

  if (isLoading) {
    return <div className="screen-center">Loading versions...</div>;
  }
  if (error) {
    return (
      <Panel>
        <EmptyState
          title="Could not load versions"
          body="The versions API did not return the current planning versions."
        />
        <p className="error centered-status">{error.message}</p>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }

  return (
    <div className="model-structure">
      <section className="schema-summary">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Versions</h2>
        </div>
        <p className="muted">
          Manage Actuals and scenario versions. New versions copy their data from an existing
          version.
        </p>
      </section>

      <Panel>
        <div className="panel-heading">
          <h2>All versions</h2>
        </div>
        <DataTable
          ariaLabel="All versions"
          columns={[
            {
              id: "version",
              header: "Version",
              cell: (version) =>
                version.canRename ? (
                  <Input
                    aria-label={`Version name ${version.name}`}
                    value={draftNames[version.id] ?? version.name}
                    onChange={(event) =>
                      setDraftNames((current) => ({
                        ...current,
                        [version.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveVersionName(version);
                      }
                    }}
                  />
                ) : (
                  <strong>{version.name}</strong>
                ),
            },
            {
              id: "type",
              header: "Type",
              cell: (version) => (
                <span className="data-table-badge">
                  {version.kind === "actuals" ? "Actuals" : "Scenario"}
                </span>
              ),
            },
            {
              className: "data-table-actions-cell",
              header: "Actions",
              headerClassName: "data-table-actions-head",
              id: "actions",
              cell: (version) => (
                <div className="grid-toolbar">
                  {version.canDelete ? (
                    <GhostButton
                      type="button"
                      aria-label={`Delete ${version.name}`}
                      title={`Delete ${version.name}`}
                      onClick={() => setPendingDelete(version)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </GhostButton>
                  ) : null}
                </div>
              ),
            },
          ]}
          data={versions}
          getRowId={(version) => version.id}
          rowLabel={(version) => version.name}
          toolbar={
            <div className="table-actions">
              <span>{versions.length} versions</span>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Add version
              </Button>
            </div>
          }
        />
        {rename.error ? <p className="error">{rename.error.message}</p> : null}
        {remove.error ? <p className="error">{remove.error.message}</p> : null}
        {status ? <p className="muted">{status}</p> : null}
      </Panel>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-version-title"
          >
            <div className="panel-heading">
              <h2 id="add-version-title">Add version</h2>
              <GhostButton type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </GhostButton>
            </div>
            <form
              className="driver-controls"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <label>
                <Label>New version name</Label>
                <Input
                  aria-label="New version name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <label>
                <Label>Copy data from</Label>
                <Select
                  aria-label="Copy data from"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" disabled={!newName || !sourceId || create.isPending}>
                <Copy size={16} /> Create version
              </Button>
            </form>
            {create.error ? <p className="error">{create.error.message}</p> : null}
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-version-title"
          >
            <div className="panel-heading">
              <h2 id="delete-version-title">Delete {pendingDelete.name}</h2>
              <GhostButton type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </GhostButton>
            </div>
            <p className="warning-copy">
              This will permanently delete forecast values and driver assumptions for this version.
              This data cannot be restored from PlanWell after deletion.
            </p>
            <div className="button-row">
              <Button type="button" onClick={() => remove.mutate(pendingDelete)}>
                <Trash2 size={16} /> Delete version
              </Button>
              <GhostButton type="button" onClick={() => setPendingDelete(null)}>
                Keep version
              </GhostButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DimensionTreeNode({
  member,
  level,
  selectedName,
  draggable,
  draggedName,
  dragOverName,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  member: DimensionMember;
  level: number;
  selectedName: string;
  draggable: boolean;
  draggedName: string;
  dragOverName: string;
  onSelect: (name: string) => void;
  onDragStart: (name: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (name: string) => void;
  onDrop: (name: string) => void;
  onDragEnd: () => void;
  onPointerDown: (name: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
}) {
  const className = [
    "dimension-node",
    member.name === selectedName ? "selected" : "",
    member.name === draggedName ? "dragging" : "",
    member.name === dragOverName && member.name !== draggedName ? "drag-over" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="dimension-node-group">
      <button
        type="button"
        className={className}
        data-dimension-member={member.name}
        draggable={draggable}
        style={{ paddingLeft: 10 + level * 18 }}
        aria-label={`Select ${member.name}`}
        onClick={() => onSelect(member.name)}
        aria-grabbed={member.name === draggedName}
        onDragStart={(event) => {
          if (!draggable) {
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", member.name);
          onDragStart(member.name, event);
        }}
        onDragOver={(event) => {
          if (!draggable) {
            return;
          }
          event.preventDefault();
          onDragOver(member.name);
        }}
        onDrop={(event) => {
          if (!draggable) {
            return;
          }
          event.preventDefault();
          onDrop(member.name);
        }}
        onDragEnd={onDragEnd}
        onPointerDown={(event) => {
          if (draggable) {
            onPointerDown(member.name, event);
          }
        }}
        onPointerMove={(event) => {
          if (draggable) {
            onPointerMove(event);
          }
        }}
        onPointerUp={(event) => {
          if (draggable) {
            onPointerUp(event);
          }
        }}
        onPointerCancel={onPointerCancel}
      >
        <span>{member.name}</span>
        <small>{member.referenceCount} refs</small>
      </button>
      {member.children.map((child) => (
        <DimensionTreeNode
          key={child.name}
          member={child}
          level={level + 1}
          selectedName={selectedName}
          draggable={draggable}
          draggedName={draggedName}
          dragOverName={dragOverName}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      ))}
    </div>
  );
}

function flattenMembers(members: DimensionMember[]): DimensionMember[] {
  return members.flatMap((member) => [member, ...flattenMembers(member.children)]);
}

function updateDimensionSortOrder(
  dimensions: Dimensions,
  kind: DimensionKind,
  memberName: string,
  sortOrder: number,
): Dimensions {
  if (kind === "time") {
    return dimensions;
  }
  return {
    ...dimensions,
    [kind]: cloneDimensionTreeWithSort(dimensions[kind], memberName, sortOrder),
  };
}

function cloneDimensionTreeWithSort(
  members: DimensionMember[],
  memberName: string,
  sortOrder: number,
): DimensionMember[] {
  return members
    .map((member) => ({
      ...member,
      sortOrder: member.name === memberName ? sortOrder : member.sortOrder,
      children: cloneDimensionTreeWithSort(member.children, memberName, sortOrder),
    }))
    .sort(compareDimensionMembers);
}

function compareDimensionMembers(left: DimensionMember, right: DimensionMember): number {
  return (
    (left.sortOrder ?? Number.POSITIVE_INFINITY) - (right.sortOrder ?? Number.POSITIVE_INFINITY) ||
    left.name.localeCompare(right.name)
  );
}

function orderedNamesFromMembers(members: DimensionMember[], fallbackNames: string[]): string[] {
  const memberNames = members.map((member) => member.name);
  const knownNames = new Set(memberNames);
  const unknownNames = [...new Set(fallbackNames)]
    .filter((name) => !knownNames.has(name))
    .sort((left, right) => left.localeCompare(right));
  return [...memberNames, ...unknownNames];
}

function buildDescendantLookup(members: DimensionMember[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  const visit = (member: DimensionMember): string[] => {
    const descendants = member.children.flatMap(visit);
    const names = [member.name, ...descendants];
    lookup.set(member.name, names);
    return names;
  };
  for (const member of members) {
    visit(member);
  }
  return lookup;
}

function buildAncestorLookup(members: DimensionMember[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  const visit = (member: DimensionMember, ancestors: string[]) => {
    lookup.set(member.name, ancestors);
    for (const child of member.children) {
      visit(child, [...ancestors, member.name]);
    }
  };
  for (const member of members) {
    visit(member, []);
  }
  return lookup;
}

function dimensionTitle(kind: DimensionKind): string {
  if (kind === "department") return "Department";
  if (kind === "account") return "Account";
  return "Time";
}

function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function SchemaView() {
  return (
    <div className="schema-page">
      <section className="schema-summary">
        <div>
          <p className="eyebrow">SQLite dimensional model</p>
          <h2>Planning cube structure</h2>
        </div>
        <p className="muted">
          Actuals and forecasts are stored separately. Versions now sit with the model dimensions as
          their own metadata table. Scenarios are simply versions with kind = scenario; every
          non-Actuals version follows that scenario path.
        </p>
      </section>

      <section className="erd-canvas" aria-label="Database schema diagram">
        <SchemaLinks />
        <div className="erd-lane dimensions">
          <span className="lane-label">Dimensions</span>
          <SchemaTable
            name="time_month"
            tone="dimension"
            fields={[
              ["PK", "id"],
              ["", "YYYY-MM month grain"],
              ["", "Derived time hierarchy"],
              ["", "Year > Quarter > Month"],
            ]}
          />
          <SchemaTable
            name="department"
            tone="dimension"
            fields={[
              ["PK", "name"],
              ["", "parent_name"],
              ["", "sort_order"],
              ["", "e.g. GPU Cloud, Engineering"],
            ]}
          />
          <SchemaTable
            name="account"
            tone="dimension"
            fields={[
              ["PK", "name"],
              ["", "parent_name"],
              ["", "sort_order"],
              ["", "Revenue, COGS, OpEx, Headcount"],
            ]}
          />
          <SchemaTable
            name="versions"
            tone="dimension"
            fields={[
              ["PK", "id"],
              ["UQ", "name"],
              ["", "kind"],
              ["", "actuals or scenario"],
              ["", "created_at / updated_at"],
            ]}
          />
        </div>

        <div className="erd-lane facts">
          <span className="lane-label">Cube facts</span>
          <SchemaTable
            name="actuals"
            tone="fact"
            fields={[
              ["FK", "month -> time_month.id"],
              ["FK", "department -> department.name"],
              ["FK", "account -> account.name"],
              ["", "value"],
              ["IDX", "month + department + account"],
            ]}
          />
          <SchemaRelation label="normalized actuals feed forecast baseline" />
          <SchemaTable
            name="forecast_values"
            tone="fact"
            fields={[
              ["FK", "scenario_id -> versions.id"],
              ["FK", "month -> time_month.id"],
              ["FK", "department -> department.name"],
              ["FK", "account -> account.name"],
              ["", "value"],
              ["IDX", "scenario + month + department + account"],
            ]}
          />
        </div>

        <div className="erd-lane scenarios">
          <span className="lane-label">Planning logic</span>
          <SchemaRelation label="scenario rows use versions.id" />
          <SchemaTable
            name="driver_assumptions"
            tone="scenario"
            fields={[
              ["FK", "scenario_id -> versions.id"],
              ["", "scope_type"],
              ["", "scope_key"],
              ["", "month"],
              ["", "driver_key"],
              ["", "value"],
              ["PK", "scenario + scope + month + driver"],
            ]}
          />
          <SchemaRelation label="Driver assumptions generate forecast cells" />
          <div className="schema-note-card">
            <strong>Versions</strong>
            <span>Scenarios are versions with kind = scenario</span>
            <span>Everything other than Actuals is a scenario version</span>
            <code>actuals</code>
            <code>versions</code>
            <code>forecast_values</code>
          </div>
          <div className="schema-note-card">
            <strong>Driver assumptions</strong>
            <span>Hierarchy level assumptions</span>
            <span>Department members inherit ancestor drivers until overridden</span>
            <code>revenueGrowthRate</code>
            <code>cogsPctOfRevenue</code>
            <code>headcountGrowthRate</code>
            <code>costPerHead</code>
          </div>
        </div>

        <div className="erd-lane auth">
          <span className="lane-label">Local auth</span>
          <SchemaTable
            name="users"
            tone="auth"
            fields={[
              ["PK", "id"],
              ["UQ", "email"],
              ["", "password_hash"],
              ["", "created_at"],
            ]}
          />
          <SchemaRelation label="user_id" />
          <SchemaTable
            name="sessions"
            tone="auth"
            fields={[
              ["PK", "id"],
              ["FK", "user_id -> users.id"],
              ["", "expires_at"],
            ]}
          />
        </div>
      </section>
    </div>
  );
}

function SchemaLinks() {
  return (
    <svg
      className="erd-links"
      aria-label="ERD relationship lines"
      role="img"
      viewBox="0 0 1000 560"
      preserveAspectRatio="none"
    >
      <title>Relationships between dimensions, fact tables, scenarios, and sessions</title>
      <defs>
        <marker
          id="erd-arrow"
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M0 0 L8 4 L0 8 Z" />
        </marker>
      </defs>
      <path d="M205 92 C250 92 250 92 294 92" />
      <path d="M205 220 C250 220 250 150 294 150" />
      <path d="M205 352 C250 352 250 210 294 210" />
      <path d="M430 226 C430 286 430 318 430 376" />
      <path d="M570 100 C610 100 610 316 650 316" />
      <path d="M620 380 C585 380 585 420 550 420" />
      <path d="M876 136 C876 222 876 276 876 360" />
      <text x="236" y="75">
        month
      </text>
      <text x="232" y="194">
        department
      </text>
      <text x="236" y="330">
        account
      </text>
      <text x="596" y="86">
        scenario_id
      </text>
      <text x="828" y="252">
        user_id
      </text>
    </svg>
  );
}

function SchemaTable({
  name,
  fields,
  tone,
}: {
  name: string;
  fields: [string, string][];
  tone: "dimension" | "fact" | "scenario" | "auth";
}) {
  return (
    <article className={`schema-table ${tone}`}>
      <header>{name}</header>
      <ul>
        {fields.map(([badge, field]) => (
          <li key={`${name}-${field}`}>
            {badge ? <span>{badge}</span> : <span aria-hidden="true" />}
            <code>{field}</code>
          </li>
        ))}
      </ul>
    </article>
  );
}

function SchemaRelation({ label }: { label: string }) {
  return (
    <div className="schema-relation">
      <span />
      <strong>{label}</strong>
      <span />
    </div>
  );
}

function AnalystView({ scenario, compareScenario }: { scenario: string; compareScenario: string }) {
  const [question, setQuestion] = useState("What is driving gross margin in GPU Cloud?");
  const ask = useMutation({ mutationFn: () => client.ask(question, scenario, compareScenario) });
  return (
    <div className="grid two">
      <Panel>
        <div className="panel-heading">
          <h2>Grounded analyst</h2>
          <Bot size={18} />
        </div>
        <p className="muted">
          Answers are generated from approved aggregate tools over the imported cube.
        </p>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
        <Button onClick={() => ask.mutate()} disabled={ask.isPending}>
          {ask.isPending ? "Asking..." : "Ask analyst"}
        </Button>
      </Panel>
      <Panel>
        <div className="panel-heading">
          <h2>Answer</h2>
          <span>{ask.data?.provider ?? "tool-only"}</span>
        </div>
        {ask.data ? (
          <>
            <p className="answer">{ask.data.answer}</p>
            <div className="citations">
              {ask.data.citations.map((citation) => (
                <span key={citation.label}>
                  {citation.tool}: {citation.label} ={" "}
                  {typeof citation.value === "number" ? currency(citation.value) : citation.value}
                </span>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="Ask a finance question"
            body="Try questions about revenue, gross margin, OpEx, or scenario differences."
          />
        )}
      </Panel>
    </div>
  );
}

function RevenueChart({ rows }: { rows: ActualRow[] }) {
  const data = aggregateByMonth(rows, "Revenue");
  if (data.length === 0) {
    return (
      <EmptyState
        title="No revenue data"
        body="Import actuals or select a scenario with forecast values."
      />
    );
  }
  return (
    <ResponsiveContainer height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#166534" stopOpacity={0.24} />
            <stop offset="95%" stopColor="#166534" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
        <Tooltip formatter={(value) => currency(Number(value))} />
        <Area dataKey="value" stroke="#166534" fill="url(#revenue-fill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CostBreakdown({ departments }: { departments: MetricSummary["departments"] }) {
  return (
    <ResponsiveContainer height={280}>
      <BarChart data={departments}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="department" />
        <YAxis tickFormatter={(value) => compactCurrency(Number(value))} />
        <Tooltip formatter={(value) => currency(Number(value))} />
        <Legend />
        <Bar dataKey="cogs" name="COGS" fill="#0f766e" />
        <Bar dataKey="opex" name="OpEx" fill="#334155" />
      </BarChart>
    </ResponsiveContainer>
  );
}

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
    <div className="spreadsheet-wrap">
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildActualGridTsv(months, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
      </div>
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
  );
}

function VarianceGrid({
  rows,
  departmentHierarchy,
  accountHierarchy,
}: {
  rows: VarianceRow[];
  departmentHierarchy: DimensionMember[];
  accountHierarchy: DimensionMember[];
}) {
  const months = getMonths(rows);
  const pivotRows = pivotVarianceRows(rows, departmentHierarchy, accountHierarchy);
  if (pivotRows.length === 0) {
    return <EmptyState title="No variance rows" body="Select scenarios with forecast values." />;
  }
  return (
    <div className="spreadsheet-wrap">
      <div className="grid-toolbar">
        <GhostButton
          type="button"
          aria-label="Copy grid"
          onClick={() => copyGrid(buildVarianceGridTsv(months, pivotRows))}
        >
          <Copy size={15} /> Copy grid
        </GhostButton>
      </div>
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
              {months.map((month) => {
                const cell = row.values[month];
                return (
                  <td
                    key={month}
                    className={`numeric-cell ${(cell?.variance ?? 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {formatCell(row.account, cell?.variance ?? 0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PivotActualRow = {
  department: string;
  account: string;
  values: Record<string, number>;
  hierarchyLevel: number;
  isParent: boolean;
};

type PivotVarianceRow = {
  department: string;
  account: string;
  values: Record<string, { variance: number; variancePct: number | null }>;
  hierarchyLevel: number;
  isParent: boolean;
};

type VarianceInsight = VarianceRow & {
  favorability: "favorable" | "unfavorable";
};

function getMonths(rows: { month: string }[]): string[] {
  return [...new Set(rows.map((row) => row.month))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function pivotActualRows(
  rows: ActualRow[],
  departmentHierarchy: DimensionMember[],
  accountHierarchy: DimensionMember[],
): PivotActualRow[] {
  const accountOrder = orderLookup(flattenMembers(accountHierarchy).map((member) => member.name));
  const departments = visibleDepartmentEntries(rows, departmentHierarchy);
  if (departments.length > 0) {
    return departments.flatMap((department) =>
      pivotActualRowsForDepartment(
        scopedDepartmentRows(rows, department.name, departmentHierarchy),
        department,
        accountOrder,
      ),
    );
  }
  return pivotActualRowsForDepartment(rows, undefined, accountOrder);
}

function pivotActualRowsForDepartment(
  rows: ActualRow[],
  department?: DepartmentTableEntry,
  accountOrder = new Map<string, number>(),
): PivotActualRow[] {
  const byKey = new Map<string, PivotActualRow>();
  for (const row of rows) {
    const departmentName = department?.name ?? row.department;
    const key = `${departmentName}|${row.account}`;
    const current = byKey.get(key) ?? {
      department: departmentName,
      account: row.account,
      values: {},
      hierarchyLevel: department?.level ?? 0,
      isParent: department?.isParent ?? false,
    };
    current.values[row.month] = (current.values[row.month] ?? 0) + row.value;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort(sortPivotRows(accountOrder));
}

function pivotVarianceRows(
  rows: VarianceRow[],
  departmentHierarchy: DimensionMember[],
  accountHierarchy: DimensionMember[],
): PivotVarianceRow[] {
  const accountOrder = orderLookup(flattenMembers(accountHierarchy).map((member) => member.name));
  const departments = visibleDepartmentEntries(rows, departmentHierarchy);
  if (departments.length > 0) {
    return departments.flatMap((department) =>
      pivotVarianceRowsForDepartment(
        scopedDepartmentRows(rows, department.name, departmentHierarchy),
        department,
        accountOrder,
      ),
    );
  }
  return pivotVarianceRowsForDepartment(rows, undefined, accountOrder);
}

function pivotVarianceRowsForDepartment(
  rows: VarianceRow[],
  department?: DepartmentTableEntry,
  accountOrder = new Map<string, number>(),
): PivotVarianceRow[] {
  const byKey = new Map<string, PivotVarianceRow>();
  for (const row of rows) {
    const departmentName = department?.name ?? row.department;
    const key = `${departmentName}|${row.account}`;
    const current = byKey.get(key) ?? {
      department: departmentName,
      account: row.account,
      values: {},
      hierarchyLevel: department?.level ?? 0,
      isParent: department?.isParent ?? false,
    };
    const cell = current.values[row.month] ?? { variance: 0, variancePct: null };
    cell.variance += row.variance;
    cell.variancePct = row.variancePct;
    current.values[row.month] = cell;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort(sortPivotRows(accountOrder));
}

type DepartmentTableEntry = {
  name: string;
  level: number;
  isParent: boolean;
};

function visibleDepartmentEntries(
  rows: { department: string }[],
  departmentHierarchy: DimensionMember[],
): DepartmentTableEntry[] {
  if (departmentHierarchy.length === 0) {
    return [];
  }
  const descendantLookup = buildDescendantLookup(departmentHierarchy);
  const entries = flattenDepartmentEntries(departmentHierarchy);
  const hierarchyNames = new Set(entries.map((entry) => entry.name));
  const visibleEntries = entries.filter((entry) => {
    const scopedNames = descendantLookup.get(entry.name) ?? [entry.name];
    return rows.some((row) => scopedNames.includes(row.department));
  });
  const unknownEntries = [...new Set(rows.map((row) => row.department))]
    .filter((department) => !hierarchyNames.has(department))
    .sort((left, right) => left.localeCompare(right))
    .map((department) => ({ name: department, level: 0, isParent: false }));
  return [...visibleEntries, ...unknownEntries];
}

function flattenDepartmentEntries(members: DimensionMember[], level = 0): DepartmentTableEntry[] {
  return members.flatMap((member) => [
    { name: member.name, level, isParent: member.children.length > 0 },
    ...flattenDepartmentEntries(member.children, level + 1),
  ]);
}

function scopedDepartmentRows<T extends { department: string }>(
  rows: T[],
  department: string,
  departmentHierarchy: DimensionMember[],
): T[] {
  const scopedNames = buildDescendantLookup(departmentHierarchy).get(department) ?? [department];
  return rows.filter((row) => scopedNames.includes(row.department));
}

function orderLookup(names: string[]): Map<string, number> {
  return new Map(names.map((name, index) => [name, index]));
}

function sortPivotRows(accountOrder: Map<string, number>) {
  return (
    left: { department: string; account: string },
    right: { department: string; account: string },
  ): number => {
    const leftAccountOrder = accountOrder.get(left.account) ?? Number.POSITIVE_INFINITY;
    const rightAccountOrder = accountOrder.get(right.account) ?? Number.POSITIVE_INFINITY;
    return (
      left.department.localeCompare(right.department) ||
      leftAccountOrder - rightAccountOrder ||
      left.account.localeCompare(right.account)
    );
  };
}

function buildActualGridTsv(months: string[], rows: PivotActualRow[]): string {
  return [
    ["Department", "Account", ...months].join("\t"),
    ...rows.map((row) =>
      [
        row.department,
        row.account,
        ...months.map((month) => String(Math.round(row.values[month] ?? 0))),
      ].join("\t"),
    ),
  ].join("\n");
}

function buildVarianceGridTsv(months: string[], rows: PivotVarianceRow[]): string {
  return [
    ["Department", "Account", ...months].join("\t"),
    ...rows.map((row) =>
      [
        row.department,
        row.account,
        ...months.map((month) => String(Math.round(row.values[month]?.variance ?? 0))),
      ].join("\t"),
    ),
  ].join("\n");
}

function copyGrid(text: string) {
  void navigator.clipboard?.writeText(text);
}

function summarizeRows(rows: ActualRow[]): MetricSummary {
  const revenue = sumAccount(rows, "Revenue");
  const cogs = sumAccount(rows, "COGS");
  const opex = sumAccount(rows, "OpEx");
  const headcount = sumAccount(rows, "Headcount");
  const grossMargin = revenue - cogs;
  const departments = new Map<
    string,
    { department: string; revenue: number; cogs: number; opex: number; headcount: number }
  >();
  for (const row of rows) {
    const current = departments.get(row.department) ?? {
      department: row.department,
      revenue: 0,
      cogs: 0,
      opex: 0,
      headcount: 0,
    };
    if (row.account === "Revenue") current.revenue += row.value;
    if (row.account === "COGS") current.cogs += row.value;
    if (row.account === "OpEx") current.opex += row.value;
    if (row.account === "Headcount") current.headcount += row.value;
    departments.set(row.department, current);
  }
  return {
    kpis: {
      revenue,
      cogs,
      grossMargin,
      grossMarginPct: revenue === 0 ? null : grossMargin / revenue,
      opex,
      opexRatio: revenue === 0 ? null : opex / revenue,
      headcount,
    },
    accounts: [...new Set(rows.map((row) => row.account))]
      .sort((left, right) => left.localeCompare(right))
      .map((account) => ({ account, value: sumAccount(rows, account) })),
    departments: [...departments.values()].sort((left, right) =>
      left.department.localeCompare(right.department),
    ),
    months: getMonths(rows),
  };
}

function sumAccount(rows: ActualRow[], account: string): number {
  return rows.filter((row) => row.account === account).reduce((total, row) => total + row.value, 0);
}

function buildVarianceInsights(rows: VarianceRow[]): {
  favorable?: VarianceInsight;
  unfavorable?: VarianceInsight;
} {
  const insights = rows
    .filter((row) => row.variance !== 0)
    .map((row) => ({ ...row, favorability: varianceFavorability(row) }));
  return {
    favorable: largestByAbsoluteVariance(
      insights.filter((row) => row.favorability === "favorable"),
    ),
    unfavorable: largestByAbsoluteVariance(
      insights.filter((row) => row.favorability === "unfavorable"),
    ),
  };
}

function largestByAbsoluteVariance(rows: VarianceInsight[]): VarianceInsight | undefined {
  return rows.sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance))[0];
}

function varianceFavorability(row: VarianceRow): VarianceInsight["favorability"] {
  if (row.account === "Revenue") {
    return row.variance > 0 ? "favorable" : "unfavorable";
  }
  return row.variance < 0 ? "favorable" : "unfavorable";
}

function describeVarianceInsight(row: VarianceInsight): string {
  const direction = row.variance >= 0 ? "increased" : "decreased";
  return `${row.account} ${direction} by ${formatCell(row.account, Math.abs(row.variance))}`;
}

function parsePastedGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  if (!normalized.trim()) {
    return [];
  }
  return normalized
    .split("\n")
    .map((line) => (line.includes("\t") ? line.split("\t") : parseCsvRow(line)))
    .filter((row) => row.some((cell) => cell.trim()));
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

function isMultiCellGrid(lines: string[][]): boolean {
  return lines.length > 1 || lines.some((line) => line.length > 1);
}

function aggregateByMonth(rows: ActualRow[], account: string) {
  const byMonth = new Map<string, number>();
  for (const row of rows.filter((item) => item.account === account)) {
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.value);
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({
      month,
      value,
    }));
}

function aggregateVarianceByMonth(rows: VarianceRow[], account: string) {
  const byMonth = new Map<string, { month: string; leftValue: number; rightValue: number }>();
  for (const row of rows.filter((item) => item.account === account)) {
    const current = byMonth.get(row.month) ?? { month: row.month, leftValue: 0, rightValue: 0 };
    current.leftValue += row.leftValue;
    current.rightValue += row.rightValue;
    byMonth.set(row.month, current);
  }
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function formatCell(account: string, value: number): string {
  return account === "Headcount" ? number(value) : currency(value);
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function percent(value: number | null | undefined): string {
  return value == null
    ? "n/a"
    : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
