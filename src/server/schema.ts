import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const timeMonths = sqliteTable("time_month", {
  id: text("id").primaryKey(),
});

export const departments = sqliteTable("department", {
  name: text("name").primaryKey(),
  parentName: text("parent_name"),
  sortOrder: real("sort_order"),
});

export const accounts = sqliteTable("account", {
  name: text("name").primaryKey(),
  parentName: text("parent_name"),
  sortOrder: real("sort_order"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const actuals = sqliteTable(
  "actuals",
  {
    month: text("month").notNull(),
    department: text("department").notNull(),
    account: text("account").notNull(),
    value: real("value").notNull(),
  },
  (table) => [index("actuals_cube_idx").on(table.month, table.department, table.account)],
);

export const scenarios = sqliteTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull(),
  locked: integer("locked").notNull().default(0),
  sortOrder: real("sort_order"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const driverAssumptions = sqliteTable(
  "driver_assumptions",
  {
    scenarioId: text("scenario_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    month: text("month").notNull(),
    driverKey: text("driver_key").notNull(),
    value: real("value").notNull(),
  },
  (table) => [
    index("driver_assumptions_lookup_idx").on(
      table.scenarioId,
      table.scopeType,
      table.scopeKey,
      table.month,
    ),
  ],
);

export const forecastValues = sqliteTable(
  "forecast_values",
  {
    scenarioId: text("scenario_id").notNull(),
    month: text("month").notNull(),
    department: text("department").notNull(),
    account: text("account").notNull(),
    value: real("value").notNull(),
  },
  (table) => [
    index("forecast_cube_idx").on(table.scenarioId, table.month, table.department, table.account),
  ],
);

export const scenarioFormulas = sqliteTable(
  "scenario_formulas",
  {
    scenarioId: text("scenario_id").notNull(),
    account: text("account").notNull(),
    formula: text("formula").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scenarioId, table.account] })],
);

export const customVariables = sqliteTable("custom_variables", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  formula: text("formula"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const customVariableValues = sqliteTable(
  "custom_variable_values",
  {
    scenarioId: text("scenario_id").notNull(),
    varId: text("var_id").notNull(),
    scope: text("scope").notNull(),
    value: real("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scenarioId, table.varId, table.scope] })],
);
