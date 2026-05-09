import { DEFAULT_FORMULAS } from "../../domain/formulaEngine.ts";
import { Panel } from "../ui.tsx";

const VARIABLES = [
  {
    name: "base",
    type: "number",
    description: "Latest actual value for this account and department",
    example: "Revenue: last month's actual revenue for the department",
  },
  {
    name: "growthRate",
    type: "number",
    description:
      "Monthly growth rate driver — revenueGrowthRate for Revenue/COGS, headcountGrowthRate for Headcount/OpEx",
    example: "0.035 = 3.5% monthly growth",
  },
  {
    name: "cogsPct",
    type: "number",
    description: "cogsPctOfRevenue driver — COGS as a fraction of revenue",
    example: "0.44 = 44% of revenue",
  },
  {
    name: "costPerHead",
    type: "number",
    description: "costPerHead driver — monthly cost per full-time employee",
    example: "19000 = $19K/month per headcount",
  },
  {
    name: "month",
    type: "integer",
    description:
      "Months since last actual (0-based index). Month 1 = one month out, Month 12 = one year out.",
    example: "month 0 = last actual, month 1 = next month",
  },
  {
    name: "revenue",
    type: "number",
    description:
      "Computed revenue for this department and month. Available in COGS and OpEx formulas.",
    example: "Use in COGS: revenue * cogsPct",
  },
  {
    name: "headcount",
    type: "number",
    description:
      "Computed headcount for this department and month. Available in OpEx formula only.",
    example: "Use in OpEx: headcount * costPerHead",
  },
];

const FUNCTIONS = [
  {
    name: "pow(base, exp)",
    description: "Exponentiation. pow(1.035, 12) = annual compound from monthly rate.",
  },
  { name: "sqrt(x)", description: "Square root." },
  { name: "abs(x)", description: "Absolute value." },
  { name: "max(a, b, ...)", description: "Maximum of arguments. max(revenue, 0) floors at zero." },
  {
    name: "min(a, b, ...)",
    description: "Minimum of arguments. min(headcount, 100) caps headcount.",
  },
  { name: "round(x)", description: "Round to nearest integer." },
  { name: "floor(x)", description: "Round down." },
  { name: "ceil(x)", description: "Round up." },
  { name: "log(x)", description: "Natural logarithm." },
  { name: "exp(x)", description: "e raised to x." },
];

const EXAMPLES = [
  {
    title: "Compound growth (default)",
    account: "Revenue",
    formula: "base * pow(1 + growthRate, month)",
    explanation: "Exponential compounding — each month multiplies the prior month's growth.",
  },
  {
    title: "Linear growth",
    account: "Revenue",
    formula: "base * (1 + growthRate * month)",
    explanation:
      "Adds the same absolute amount each month. Slower than compound for long horizons.",
  },
  {
    title: "Fixed revenue (flat line)",
    account: "Revenue",
    formula: "base",
    explanation: "Holds revenue at the last actual value for all forecast months.",
  },
  {
    title: "COGS as % of revenue (default)",
    account: "COGS",
    formula: "revenue * cogsPct",
    explanation: "COGS moves with revenue. Adjust cogsPct driver to change the ratio.",
  },
  {
    title: "Fixed COGS margin + floor",
    account: "COGS",
    formula: "max(revenue * cogsPct, base * 0.8)",
    explanation:
      "COGS as % of revenue, but never falls below 80% of baseline. Useful when fixed costs exist.",
  },
  {
    title: "Headcount compound growth (default)",
    account: "Headcount",
    formula: "base * pow(1 + growthRate, month)",
    explanation: "Headcount grows exponentially at headcountGrowthRate.",
  },
  {
    title: "Headcount: hire N per month",
    account: "Headcount",
    formula: "base + month * 2",
    explanation: "Adds 2 headcount every month. Replace 2 with your planned hire rate.",
  },
  {
    title: "OpEx per head (default)",
    account: "OpEx",
    formula: "headcount * costPerHead",
    explanation: "Total cost scales linearly with headcount.",
  },
  {
    title: "OpEx with fixed overhead",
    account: "OpEx",
    formula: "headcount * costPerHead + 50000",
    explanation: "Adds a fixed $50K/month overhead (e.g. rent, software) on top of per-head cost.",
  },
  {
    title: "OpEx growing faster than headcount",
    account: "OpEx",
    formula: "headcount * costPerHead * pow(1 + 0.005, month)",
    explanation:
      "Per-head cost itself compounds at 0.5%/month — models rising salaries or tooling costs.",
  },
];

export function FormulaReferencePage() {
  return (
    <div className="formula-reference-page">
      <Panel>
        <div className="panel-heading">
          <h2>Default formulas</h2>
        </div>
        <p className="muted">
          These are the built-in formulas used when no override is set on a scenario. Override any
          of these per scenario in the Forecast Model page under "Formula overrides".
        </p>
        <table className="ref-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Default formula</th>
            </tr>
          </thead>
          <tbody>
            {(["Revenue", "COGS", "Headcount", "OpEx"] as const).map((account) => (
              <tr key={account}>
                <td>
                  <strong>{account}</strong>
                </td>
                <td>
                  <code>{DEFAULT_FORMULAS[account]}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <div className="panel-heading">
          <h2>Variables</h2>
        </div>
        <p className="muted">
          These variables are available in every formula expression. Values are resolved per
          department and month using the scenario's driver assumptions.
        </p>
        <table className="ref-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Type</th>
              <th>Description</th>
              <th>Example value</th>
            </tr>
          </thead>
          <tbody>
            {VARIABLES.map((v) => (
              <tr key={v.name}>
                <td>
                  <code>{v.name}</code>
                </td>
                <td className="muted">{v.type}</td>
                <td>{v.description}</td>
                <td className="muted">{v.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <div className="panel-heading">
          <h2>Math functions</h2>
        </div>
        <p className="muted">
          The full{" "}
          <a
            href="https://mathjs.org/docs/reference/functions.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            math.js function library
          </a>{" "}
          is available — trig, statistics, combinatorics, and more. Common ones are listed below.
        </p>
        <table className="ref-table">
          <thead>
            <tr>
              <th>Function</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {FUNCTIONS.map((f) => (
              <tr key={f.name}>
                <td>
                  <code>{f.name}</code>
                </td>
                <td>{f.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <div className="panel-heading">
          <h2>Formula examples</h2>
        </div>
        <p className="muted">
          Copy any of these into the Formula overrides section on the Forecast Model page.
        </p>
        <div className="formula-examples">
          {EXAMPLES.map((ex) => (
            <div key={`${ex.account}-${ex.title}`} className="formula-example">
              <div className="formula-example-header">
                <span className="formula-account-badge">{ex.account}</span>
                <strong>{ex.title}</strong>
              </div>
              <code className="formula-example-code">{ex.formula}</code>
              <p className="muted">{ex.explanation}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
