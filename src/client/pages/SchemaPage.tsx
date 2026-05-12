export function SchemaPage() {
  return (
    <div className="schema-page">
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
              ["", "locked"],
              ["", "sort_order"],
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
              ["IDX", "scenario_id + month + department + account"],
            ]}
          />
        </div>

        <div className="erd-lane scenarios">
          <span className="lane-label">Planning logic</span>
          <SchemaTable
            name="scenarios"
            tone="scenario"
            fields={[
              ["PK", "id"],
              ["", "name"],
              ["", "created_at / updated_at"],
            ]}
          />
          <SchemaRelation label="scenario rows use scenarios.id / versions.id" />
          <SchemaTable
            name="scenario_formulas"
            tone="scenario"
            fields={[
              ["FK", "scenario_id -> versions.id"],
              ["", "account"],
              ["", "formula"],
              ["PK", "scenario_id + account"],
            ]}
          />
          <SchemaRelation label="var values + formulas drive forecast calculation" />
          <div className="schema-note-card">
            <strong>Versions & Scenarios</strong>
            <span>Scenarios are versions with kind = scenario</span>
            <span>Locked scenario versions are read-only</span>
            <span>Everything other than Actuals is a scenario version</span>
          </div>
        </div>

        <div className="erd-lane custom-vars">
          <span className="lane-label">Custom variables</span>
          <SchemaTable
            name="custom_variables"
            tone="scenario"
            fields={[
              ["PK", "id"],
              ["", "label"],
              ["", "kind"],
              ["", "input or calculated"],
              ["", "formula"],
              ["", "default_value"],
              ["", "sort_order"],
            ]}
          />
          <SchemaRelation label="var values keyed by scenario + variable + scope" />
          <SchemaTable
            name="custom_variable_values"
            tone="scenario"
            fields={[
              ["FK", "scenario_id -> versions.id"],
              ["FK", "var_id -> custom_variables.id"],
              ["", "scope"],
              ["", "global | YYYY-MM | dept:Name | dept:Name:YYYY-MM"],
              ["", "value"],
              ["PK", "scenario_id + var_id + scope"],
            ]}
          />
          <div className="schema-note-card">
            <strong>Custom variable resolution</strong>
            <span>
              Precedence (lowest → highest): default_value → ancestor dept monthly → this dept
              monthly
            </span>
            <span>Calculated vars evaluated in topological order after inputs</span>
            <code>input</code>
            <code>calculated</code>
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
