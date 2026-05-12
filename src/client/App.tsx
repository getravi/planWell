import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Bot,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Copy,
  Database,
  FileUp,
  GitCompareArrows,
  Network,
  Settings,
  Settings2,
  SquareFunction,
  Variable,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { client, type MetricSummary } from "./api.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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

import { summarizeRows, summarizeVarianceRows } from "./pivot.ts";
import { buildDescendantLookup, orderedOptionsFromMembers } from "./dimension-utils.ts";
import { currency, number, percent } from "./format.ts";

import { LoginScreen } from "./components/LoginScreen.tsx";
import { AdminPage } from "./pages/AdminPage.tsx";
import { ActualsPage } from "./pages/ActualsPage.tsx";
import { DataIntegrationPage } from "./pages/DataIntegrationPage.tsx";
import { AnalystPage } from "./pages/AnalystPage.tsx";
import { CustomVariablesPage } from "./pages/CustomVariablesPage.tsx";
import { DimensionsPage } from "./pages/DimensionsPage.tsx";
import { ForecastPage } from "./pages/ForecastPage.tsx";
import { FormulaReferencePage } from "./pages/FormulaReferencePage.tsx";
import { FormulasPage } from "./pages/FormulasPage.tsx";
import { ScenarioComparisonPage } from "./pages/ScenarioComparisonPage.tsx";
import { SchemaPage } from "./pages/SchemaPage.tsx";
import { TimeSettingsPage } from "./pages/TimeSettingsPage.tsx";
import { VersionsPage } from "./pages/VersionsPage.tsx";

export const queryClient = new QueryClient({
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

const VIEWS = [
  "Actuals",
  "Forecast Model",
  "Scenario Comparison",
  "Analyst",
  "Dimensions",
  "Time Settings",
  "Versions",
  "Formulas",
  "Custom Variables",
  "Schema",
  "Formula Reference",
  "Data Integration",
  "Site Settings",
];

function slugify(text: string) {
  return text.toLowerCase().replace(/\s+/g, "-");
}

function usePathRoute(defaultView: string) {
  const [view, setViewInternal] = useState(() => {
    const path = window.location.pathname.slice(1);
    return VIEWS.find((v) => slugify(v) === path) ?? defaultView;
  });

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.slice(1);
      const nextView = VIEWS.find((v) => slugify(v) === path);
      if (nextView) {
        setViewInternal(nextView);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setView = (newView: string) => {
    setViewInternal(newView);
    window.history.pushState(null, "", `/${slugify(newView)}`);
  };

  return [view, setView] as const;
}

function Workbench({ userEmail }: { userEmail: string }) {
  const [view, setView] = usePathRoute("Forecast Model");
  const [adminOpen, setAdminOpen] = useState(false);
  const [leftScenario, setLeftScenario] = useState("Base Case");
  const [rightScenario, setRightScenario] = useState("Aggressive Growth");
  const [forecastDepartment, setForecastDepartment] = useState("__all__");
  const [actualsDepartment, setActualsDepartment] = useState("__all__");
  const [selectedYear, setSelectedYear] = useState<string>("__all__");
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: client.scenarios });
  const settings = useQuery({ queryKey: ["settings"], queryFn: client.settings });
  const lastActualsMonth = settings.data?.lastActualsMonth ?? null;
  const actuals = useQuery({ queryKey: ["actuals"], queryFn: client.actuals });
  const customVariables = useQuery({
    queryKey: ["custom-variables"],
    queryFn: () => client.listCustomVariables().then((r) => r.customVariables ?? []),
    enabled: view === "Forecast Model" || view === "Custom Variables",
  });
  const dimensions = useQuery({
    queryKey: ["dimensions"],
    queryFn: client.dimensions,
    enabled:
      view === "Actuals" ||
      view === "Dimensions" ||
      view === "Time Settings" ||
      view === "Forecast Model" ||
      view === "Scenario Comparison",
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
  const actualRows = actuals.data?.rows ?? [];
  const availableYears = useMemo(() => {
    const months = [...actualRows.map((r) => r.month), ...forecastRows.map((r) => r.month)];
    return [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  }, [actualRows, forecastRows]);
  const blendedForecastRows = useMemo(() => {
    if (!lastActualsMonth) return forecastRows;
    return [
      ...actualRows.filter((r) => r.month <= lastActualsMonth),
      ...forecastRows.filter((r) => r.month > lastActualsMonth),
    ];
  }, [actualRows, forecastRows, lastActualsMonth]);
  const yearForecastRows = useMemo(
    () =>
      selectedYear === "__all__"
        ? blendedForecastRows
        : blendedForecastRows.filter((r) => r.month.startsWith(selectedYear)),
    [blendedForecastRows, selectedYear],
  );
  const yearActualRows = useMemo(
    () =>
      selectedYear === "__all__"
        ? actualRows
        : actualRows.filter((r) => r.month.startsWith(selectedYear)),
    [actualRows, selectedYear],
  );
  const yearVarianceRows = useMemo(
    () =>
      selectedYear === "__all__"
        ? (variance.data?.rows ?? [])
        : (variance.data?.rows ?? []).filter((r) => r.month.startsWith(selectedYear)),
    [variance.data?.rows, selectedYear],
  );
  const departmentDescendants = useMemo(
    () => buildDescendantLookup(dimensions.data?.department ?? []),
    [dimensions.data?.department],
  );
  const forecastDepartmentOptions = useMemo(
    () =>
      orderedOptionsFromMembers(dimensions.data?.department ?? [], [
        ...forecastRows.map((row) => row.department),
        ...(forecast.data?.summary.departments.map((item) => item.department) ?? []),
      ]),
    [dimensions.data?.department, forecast.data?.summary.departments, forecastRows],
  );
  const forecastDepartments = useMemo(
    () => forecastDepartmentOptions.map((department) => department.name),
    [forecastDepartmentOptions],
  );
  const filteredForecastRows = useMemo(() => {
    if (forecastDepartment === "__all__") {
      return yearForecastRows;
    }
    const allowedDepartments = departmentDescendants.get(forecastDepartment) ?? [
      forecastDepartment,
    ];
    return yearForecastRows.filter((row) => allowedDepartments.includes(row.department));
  }, [departmentDescendants, forecastDepartment, yearForecastRows]);
  const actualsDepartmentOptions = useMemo(
    () =>
      orderedOptionsFromMembers(
        dimensions.data?.department ?? [],
        yearActualRows.map((row) => row.department),
      ),
    [dimensions.data?.department, yearActualRows],
  );
  const actualsDepartments = useMemo(
    () => actualsDepartmentOptions.map((d) => d.name),
    [actualsDepartmentOptions],
  );
  const filteredActualRows = useMemo(() => {
    if (actualsDepartment === "__all__") return yearActualRows;
    const allowed = departmentDescendants.get(actualsDepartment) ?? [actualsDepartment];
    return yearActualRows.filter((row) => allowed.includes(row.department));
  }, [departmentDescendants, actualsDepartment, yearActualRows]);
  const varianceSummary = useMemo(
    () => summarizeVarianceRows(yearVarianceRows),
    [yearVarianceRows],
  );
  const currentSummary =
    view === "Scenario Comparison"
      ? varianceSummary
      : view === "Forecast Model" && forecastDepartment !== "__all__"
        ? summarizeRows(filteredForecastRows)
        : selectedYear !== "__all__"
          ? summarizeRows(view === "Actuals" ? yearActualRows : yearForecastRows)
          : (forecast.data?.summary ?? actuals.data?.summary);
  const showScenarioPicker =
    view === "Forecast Model" || view === "Scenario Comparison" || view === "Analyst";
  const showComparisonLabels = view === "Scenario Comparison";
  const isAdminView =
    view === "Dimensions" ||
    view === "Time Settings" ||
    view === "Versions" ||
    view === "Formulas" ||
    view === "Custom Variables" ||
    view === "Schema" ||
    view === "Formula Reference" ||
    view === "Data Integration" ||
    view === "Site Settings";

  useEffect(() => {
    if (!dimensions.isSuccess) {
      return;
    }
    const defaultDepartment = forecastDepartments[0];
    if (
      defaultDepartment &&
      (forecastDepartment === "__all__" || !forecastDepartments.includes(forecastDepartment))
    ) {
      setForecastDepartment(defaultDepartment);
    }
  }, [dimensions.isSuccess, forecastDepartment, forecastDepartments]);

  useEffect(() => {
    if (!dimensions.isSuccess) return;
    const defaultDepartment = actualsDepartments[0];
    if (
      defaultDepartment &&
      (actualsDepartment === "__all__" || !actualsDepartments.includes(actualsDepartment))
    ) {
      setActualsDepartment(defaultDepartment);
    }
  }, [dimensions.isSuccess, actualsDepartment, actualsDepartments]);

  useEffect(() => {
    const es = new EventSource("/api/forecast-updates");
    es.addEventListener("recalc-done", () => {
      void queryClient.invalidateQueries({ queryKey: ["forecast"] });
      void queryClient.invalidateQueries({ queryKey: ["variance"] });
      void queryClient.invalidateQueries({ queryKey: ["cube"] });
    });
    return () => es.close();
  }, []);

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
                  ["Scenario Comparison", GitCompareArrows],
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
                    ["Data Integration", FileUp],
                    ["Dimensions", Network],
                    ["Time Settings", CalendarDays],
                    ["Versions", Copy],
                    ["Formulas", SquareFunction],
                    ["Custom Variables", Variable],
                    ["Schema", Database],
                    ["Site Settings", Settings2],
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
        <div className="sidebar-help-btn">
          <button
            className={`help-btn${view === "Formula Reference" ? " active" : ""}`}
            onClick={() => setView("Formula Reference")}
            aria-label="Formula Reference"
            title="Formula Reference"
          >
            <CircleHelp size={16} />
          </button>
        </div>
      </Sidebar>

      <SidebarInset className="workspace">
        <SiteHeader className="topbar">
          <div>
            <h1>{view}</h1>
          </div>
          <div className="scenario-pickers">

            {availableYears.length > 0 && view !== "Site Settings" ? (
              <label className="page-selector">
                <Select
                  aria-label="Year"
                  value={selectedYear}
                  onChange={(event) => setSelectedYear(event.target.value)}
                >
                  <option value="__all__">All years</option>
                  {availableYears.map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </Select>
              </label>
            ) : null}
            {view === "Actuals" ? (
              <label className="page-selector">
                <Select
                  aria-label="Actuals department"
                  value={actualsDepartment}
                  onChange={(event) => setActualsDepartment(event.target.value)}
                >
                  {actualsDepartmentOptions.map((department) => (
                    <option
                      data-depth={department.depth}
                      key={department.name}
                      value={department.name}
                    >
                      {department.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {view === "Forecast Model" ? (
              <label className="page-selector">
                <Select
                  aria-label="Forecast department"
                  value={forecastDepartment}
                  onChange={(event) => setForecastDepartment(event.target.value)}
                >
                  {forecastDepartmentOptions.map((department) => (
                    <option
                      data-depth={department.depth}
                      key={department.name}
                      value={department.name}
                    >
                      {department.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {showScenarioPicker ? (
              <label
                className={showComparisonLabels ? "page-selector inline-selector" : "page-selector"}
              >
                {showComparisonLabels ? (
                  <span className="page-selector-label">Primary scenario</span>
                ) : null}
                <Select
                  aria-label="Primary scenario"
                  value={leftScenario}
                  onChange={(event) => setLeftScenario(event.target.value)}
                >
                  {scenarioNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              </label>
            ) : null}
            {view === "Scenario Comparison" ? (
              <label className="page-selector inline-selector">
                <span className="page-selector-label">Compare to</span>
                <Select
                  aria-label="Compare to"
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

        {view !== "Schema" &&
        view !== "Dimensions" &&
        view !== "Time Settings" &&
        view !== "Versions" &&
        view !== "Formulas" &&
        view !== "Custom Variables" &&
        view !== "Formula Reference" &&
        view !== "Data Integration" &&
        view !== "Site Settings" ? (
          <KpiStrip
            summary={currentSummary}
            variant={view === "Scenario Comparison" ? "variance" : "standard"}
          />
        ) : null}

        {view === "Actuals" ? (
          <ActualsPage
            actuals={filteredActualRows}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
          />
        ) : null}
        {view === "Forecast Model" ? (
          <ForecastPage
            scenarios={scenarios.data?.scenarios ?? []}
            selected={leftScenario}
            rows={filteredForecastRows}
            departmentFilter={forecastDepartment}
            departments={forecastDepartments}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
            customVarDefs={customVariables.data ?? []}
            selectedYear={selectedYear}
          />
        ) : null}
        {view === "Scenario Comparison" ? (
          <ScenarioComparisonPage
            rows={yearVarianceRows}
            left={leftScenario}
            right={rightScenario}
            departmentHierarchy={dimensions.data?.department ?? []}
            accountHierarchy={dimensions.data?.account ?? []}
          />
        ) : null}
        {view === "Analyst" ? (
          <AnalystPage
            scenario={leftScenario}
            compareScenario={rightScenario}
            selectedYear={selectedYear}
          />
        ) : null}
        {view === "Dimensions" ? (
          <DimensionsPage
            dimensions={dimensions.data}
            error={dimensions.error}
            isLoading={dimensions.isLoading}
            onRetry={() => void dimensions.refetch()}
          />
        ) : null}
        {view === "Time Settings" ? (
          <TimeSettingsPage
            dimensions={dimensions.data}
            error={dimensions.error}
            isLoading={dimensions.isLoading}
            onRetry={() => void dimensions.refetch()}
          />
        ) : null}
        {view === "Versions" ? (
          <VersionsPage
            versions={versions.data?.versions ?? []}
            error={versions.error}
            isLoading={versions.isLoading}
            onRetry={() => void versions.refetch()}
          />
        ) : null}
        {view === "Formulas" ? <FormulasPage /> : null}
        {view === "Custom Variables" ? (
          <CustomVariablesPage customVariables={customVariables.data ?? []} />
        ) : null}
        {view === "Schema" ? <SchemaPage /> : null}
        {view === "Formula Reference" ? <FormulaReferencePage /> : null}
        {view === "Data Integration" ? <DataIntegrationPage /> : null}
        {view === "Site Settings" ? <AdminPage /> : null}
      </SidebarInset>
    </SidebarProvider>
  );
}

function KpiStrip({
  summary,
  variant = "standard",
}: {
  summary?: MetricSummary;
  variant?: "standard" | "variance";
}) {
  const kpis = summary?.kpis;
  if (variant === "variance") {
    return (
      <section className="kpi-strip">
        <Kpi label="Revenue variance" value={currency(kpis?.revenue ?? 0)} />
        <Kpi label="Gross margin variance" value={currency(kpis?.grossMargin ?? 0)} />
        <Kpi label="OpEx variance" value={currency(kpis?.opex ?? 0)} />
        <Kpi label="Headcount variance" value={number(kpis?.headcount ?? 0)} />
      </section>
    );
  }
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
