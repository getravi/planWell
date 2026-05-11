import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { client } from "../api.ts";
import type { CustomVariableDef } from "../../domain/types.ts";
import { Button, GhostButton, Input, Panel } from "../ui.tsx";

export function CustomVariablesPage({
  customVariables,
}: {
  customVariables: CustomVariableDef[];
}) {
  return (
    <div className="grid two">
      <AddVariablePanel customVariables={customVariables} />
      <Panel className="span-two">
        <div className="panel-heading">
          <h2>Custom variables</h2>
          <span>{customVariables.length} defined</span>
        </div>
        {customVariables.length === 0 ? (
          <p className="muted">No custom variables defined yet. Add one to get started.</p>
        ) : (
          <CustomVariableTable customVariables={customVariables} />
        )}
      </Panel>
    </div>
  );
}

function CustomVariableTable({ customVariables }: { customVariables: CustomVariableDef[] }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.deleteCustomVariable(id),
    onSuccess: async () => { await queryClient.invalidateQueries(); },
  });

  return (
    <div className="ref-table-wrap">
      <table className="ref-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Label</th>
            <th>Kind</th>
            <th>Default</th>
            <th>Formula</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {customVariables.map((v) => (
            <tr key={v.id}>
              <td>
                <code>{v.id}</code>
              </td>
              <td>{v.label}</td>
              <td>{v.kind}</td>
              <td className="muted">
                {v.kind === "input" && v.defaultValue !== undefined
                  ? v.defaultValue
                  : <span>—</span>}
              </td>
              <td>
                {v.formula ? <code>{v.formula}</code> : <span className="muted">—</span>}
              </td>
              <td>
                <GhostButton
                  type="button"
                  aria-label={`Delete ${v.id}`}
                  onClick={() => deleteMutation.mutate(v.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} />
                </GhostButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {deleteMutation.error ? (
        <p className="error">{deleteMutation.error.message}</p>
      ) : null}
    </div>
  );
}

const AVAILABLE_BUILTIN_IDS = [
  "base", "month", "revenue", "headcount",
];

function AddVariablePanel({ customVariables }: { customVariables: CustomVariableDef[] }) {
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"input" | "calculated">("input");
  const [defaultValue, setDefaultValue] = useState("");
  const [formula, setFormula] = useState("");
  const [formulaStatus, setFormulaStatus] = useState<{ ok: boolean; error?: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: client.createCustomVariable,
    onSuccess: async () => {
      setId("");
      setLabel("");
      setKind("input");
      setDefaultValue("");
      setFormula("");
      setFormulaStatus(null);
      await queryClient.invalidateQueries();
    },
  });

  const validateFormula = async () => {
    if (!formula.trim()) {
      setFormulaStatus(null);
      return;
    }
    const availableIds = [...customVariables.map((v) => v.id), ...AVAILABLE_BUILTIN_IDS];
    const result = await client.validateCustomFormula(formula, availableIds);
    setFormulaStatus(result);
  };

  const canSubmit =
    id.trim() &&
    label.trim() &&
    (kind === "input" || (kind === "calculated" && formula.trim() && formulaStatus?.ok));

  return (
    <Panel>
      <div className="panel-heading">
        <h2>Add variable</h2>
      </div>
      <p className="muted">
        Input variables appear as editable rows in the driver matrix. Calculated variables are
        evaluated from a formula using other variables and built-in values.
      </p>
      <div className="form-field">
        <label className="form-label">
          ID
          <Input
            type="text"
            placeholder="e.g. churnRate"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <small className="muted">Letters, digits, underscores. Cannot be changed after creation.</small>
      </div>
      <div className="form-field">
        <label className="form-label">
          Label
          <Input
            type="text"
            placeholder="e.g. Churn Rate"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </div>
      <div className="form-field">
        <span className="form-label">Kind</span>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="kind"
              value="input"
              checked={kind === "input"}
              onChange={() => setKind("input")}
            />
            Input
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              value="calculated"
              checked={kind === "calculated"}
              onChange={() => setKind("calculated")}
            />
            Calculated
          </label>
        </div>
      </div>
      {kind === "input" ? (
        <div className="form-field">
          <label className="form-label">
            Default value
            <Input
              type="number"
              placeholder="0"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
          </label>
          <small className="muted">Used when no per-dept or per-month override is set.</small>
        </div>
      ) : null}
      {kind === "calculated" ? (
        <div className="form-field">
          <label className="form-label">
            Formula
            <Input
              type="text"
              placeholder="e.g. revenue * churnRate"
              value={formula}
              onChange={(e) => {
                setFormula(e.target.value);
                setFormulaStatus(null);
              }}
              onBlur={validateFormula}
            />
          </label>
          <small className="muted">
            Available: {[...AVAILABLE_BUILTIN_IDS, ...customVariables.map((v) => v.id)].join(", ")}
          </small>
          {formulaStatus ? (
            formulaStatus.ok ? (
              <small className="success">Valid</small>
            ) : (
              <small className="error">{formulaStatus.error}</small>
            )
          ) : null}
        </div>
      ) : null}
      <Button
        disabled={!canSubmit || createMutation.isPending}
        onClick={() =>
          createMutation.mutate({
            id: id.trim(),
            label: label.trim(),
            kind,
            formula: kind === "calculated" ? formula.trim() : undefined,
            defaultValue: kind === "input" && defaultValue !== "" ? Number(defaultValue) : undefined,
          })
        }
      >
        Add variable
      </Button>
      {createMutation.error ? <p className="error">{createMutation.error.message}</p> : null}
    </Panel>
  );
}
