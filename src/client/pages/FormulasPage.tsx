import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { orderedNamesFromMembers } from "../dimension-utils.ts";
import { DEFAULT_FORMULAS } from "../../domain/formulaEngine.ts";
import type { CoreAccount, ScenarioFormulas } from "../../domain/types.ts";
import { client } from "../api.ts";
import { Button, EmptyState, GhostButton, Input, Label, Panel, Select } from "../ui.tsx";

type VersionOption = {
  id: string;
  name: string;
  type: "actuals" | "scenario";
  locked: boolean;
  assumptions: { formulas?: ScenarioFormulas };
};

export function FormulasPage() {
  const dimensions = useQuery({ queryKey: ["dimensions"], queryFn: client.dimensions });
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: client.scenarios });
  const actualsFormulas = useQuery({
    queryKey: ["actuals-formulas"],
    queryFn: () => client.readActualsFormulas().then((r) => r.formulas ?? {}),
  });
  const scenarioList = scenarios.data?.scenarios ?? [];
  const [selectedName, setSelectedName] = useState<string>("__actuals__");

  const versions: VersionOption[] = [
    {
      id: "actuals",
      name: "Actuals",
      type: "actuals",
      locked: false,
      assumptions: { formulas: actualsFormulas.data ?? {} },
    },
    ...scenarioList.map((s) => ({ ...s, type: "scenario" as const })),
  ];

  const selected = versions.find((v) => v.name === (selectedName || versions[0]?.name));

  if (scenarios.isLoading || dimensions.isLoading || actualsFormulas.isLoading) return null;
  if (versions.length === 0) {
    return (
      <Panel>
        <EmptyState title="No versions" body="Import actuals to create the default scenario set." />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="panel-heading">
        <h2>Formula overrides</h2>
      </div>
      <p className="muted driver-note">
        Override the forecasting formula for any account in a version. Leave blank to use the
        default. Visit Formula Reference for available variables and examples.
      </p>
      <div className="driver-controls">
        <label>
          <Label>Version</Label>
          <Select
            aria-label="Version"
            value={selected?.name ?? ""}
            onChange={(e) => setSelectedName(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {selected ? (
        <FormulaEditor
          key={selected.id}
          version={selected}
          accounts={
            dimensions.data
              ? orderedNamesFromMembers(dimensions.data.account, [
                  "Revenue",
                  "COGS",
                  "Headcount",
                  "OpEx",
                ])
              : ["Revenue", "COGS", "Headcount", "OpEx"]
          }
        />
      ) : null}
    </Panel>
  );
}

function FormulaEditor({ version, accounts }: { version: VersionOption; accounts: string[] }) {
  const queryClient = useQueryClient();
  const [formulas, setFormulas] = useState<ScenarioFormulas>(version.assumptions.formulas ?? {});
  const [validationState, setValidationState] = useState<
    Record<string, { ok: boolean; error?: string; pending: boolean }>
  >({});
  const isLocked = version.locked;
  const hasError = Object.values(validationState).some((s) => s && !s.ok && !s.pending);
  const isDirty = JSON.stringify(formulas) !== JSON.stringify(version.assumptions.formulas ?? {});

  const save = useMutation({
    mutationFn: async () => {
      if (version.type === "actuals") {
        return client.saveActualsFormulas(formulas);
      }
      return client.saveScenario({ name: version.name, formulas });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const validate = async (account: string, formula: string) => {
    setValidationState((prev) => ({ ...prev, [account]: { ok: false, pending: true } }));
    try {
      const result = await client.validateFormula(formula, account);
      const error = result.ok ? undefined : (result as { ok: false; error: string }).error;
      setValidationState((prev) => ({
        ...prev,
        [account]: { ok: result.ok, error, pending: false },
      }));
    } catch {
      setValidationState((prev) => ({
        ...prev,
        [account]: { ok: false, error: "Validation request failed.", pending: false },
      }));
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      {isLocked ? (
        <p className="muted driver-note">
          {version.name} is locked. Unlock it in Versions to edit formulas.
        </p>
      ) : null}
      <div className="formulas-table-wrap">
        <table className="formulas-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Formula</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const formula = formulas[account] ?? "";
              const state = validationState[account];
              return (
                <tr key={account}>
                  <td className="formulas-table-label">{account}</td>
                  <td>
                    <Input
                      aria-label={`${account} formula`}
                      placeholder={DEFAULT_FORMULAS[account as CoreAccount]}
                      value={formula}
                      disabled={isLocked}
                      onChange={(e) => {
                        const next = { ...formulas };
                        if (e.target.value) {
                          next[account] = e.target.value;
                        } else {
                          delete next[account];
                          setValidationState((prev) => {
                            const s = { ...prev };
                            delete s[account];
                            return s;
                          });
                        }
                        setFormulas(next);
                      }}
                      onBlur={() => {
                        if (formula) void validate(account, formula);
                      }}
                      className={state && !state.ok && !state.pending ? "input-error" : undefined}
                      style={{ fontFamily: "monospace", width: "100%" }}
                    />
                    {state && !state.pending && (
                      <span
                        className={state.ok ? "formula-ok" : "formula-error"}
                        style={{ fontSize: 12 }}
                      >
                        {state.ok ? "✓ Valid" : state.error}
                      </span>
                    )}
                    {state?.pending && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        Validating…
                      </span>
                    )}
                  </td>
                  <td className="formulas-table-reset">
                    <GhostButton
                      type="button"
                      aria-label={`Reset ${account} to default`}
                      disabled={isLocked || !formula}
                      title="Reset to default"
                      onClick={() => {
                        const next = { ...formulas };
                        delete next[account];
                        setFormulas(next);
                        setValidationState((prev) => {
                          const s = { ...prev };
                          delete s[account];
                          return s;
                        });
                      }}
                    >
                      ↺
                    </GhostButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button
        disabled={isLocked || !isDirty || hasError || save.isPending}
        onClick={() => save.mutate()}
        style={{ marginTop: 12 }}
      >
        <Save size={16} /> Save formulas
      </Button>
      {save.error ? <p className="error">{save.error.message}</p> : null}
    </div>
  );
}
