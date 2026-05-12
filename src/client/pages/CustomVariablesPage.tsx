import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { client } from "../api.ts";
import type { CustomVariableDef } from "../../domain/types.ts";
import { Button, GhostButton, Input, Panel } from "../ui.tsx";

export function CustomVariablesPage({ customVariables }: { customVariables: CustomVariableDef[] }) {
  return (
    <div className="grid two">
      <AddVariablePanel customVariables={customVariables} className="span-two" />
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

type EditDraft = { label: string; defaultValue: string; formula: string };

function CustomVariableTable({ customVariables }: { customVariables: CustomVariableDef[] }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ label: "", defaultValue: "", formula: "" });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.deleteCustomVariable(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof client.updateCustomVariable>[1];
    }) => client.updateCustomVariable(id, patch),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries();
    },
  });

  function startEdit(v: CustomVariableDef) {
    setEditingId(v.id);
    setDraft({
      label: v.label,
      defaultValue: v.defaultValue !== undefined ? String(v.defaultValue) : "",
      formula: v.formula ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    updateMutation.reset();
  }

  function saveEdit(v: CustomVariableDef) {
    const patch: Parameters<typeof client.updateCustomVariable>[1] = {};
    if (draft.label !== v.label) patch.label = draft.label;
    if (v.kind === "input") {
      const num = draft.defaultValue !== "" ? Number(draft.defaultValue) : undefined;
      if (num !== v.defaultValue) patch.defaultValue = num;
    }
    if (v.kind === "calculated" && draft.formula !== (v.formula ?? "")) {
      patch.formula = draft.formula;
    }
    updateMutation.mutate({ id: v.id, patch });
  }

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
          {customVariables.map((v) => {
            const isEditing = editingId === v.id;
            return (
              <tr key={v.id}>
                <td>
                  <code>{v.id}</code>
                </td>
                <td>
                  {isEditing ? (
                    <Input
                      type="text"
                      value={draft.label}
                      onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                      style={{ width: "100%", minWidth: 100 }}
                    />
                  ) : (
                    v.label
                  )}
                </td>
                <td>{v.kind}</td>
                <td>
                  {isEditing && v.kind === "input" ? (
                    <Input
                      type="number"
                      value={draft.defaultValue}
                      onChange={(e) => setDraft((d) => ({ ...d, defaultValue: e.target.value }))}
                      style={{ width: 80 }}
                    />
                  ) : v.kind === "input" && v.defaultValue !== undefined ? (
                    v.defaultValue
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {isEditing && v.kind === "calculated" ? (
                    <Input
                      type="text"
                      value={draft.formula}
                      onChange={(e) => setDraft((d) => ({ ...d, formula: e.target.value }))}
                      style={{ width: "100%", minWidth: 140 }}
                    />
                  ) : v.formula ? (
                    <code>{v.formula}</code>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {isEditing ? (
                    <>
                      <GhostButton
                        type="button"
                        aria-label="Save"
                        onClick={() => saveEdit(v)}
                        disabled={updateMutation.isPending || !draft.label.trim()}
                      >
                        <Check size={14} />
                      </GhostButton>
                      <GhostButton type="button" aria-label="Cancel" onClick={cancelEdit}>
                        <X size={14} />
                      </GhostButton>
                    </>
                  ) : (
                    <>
                      <GhostButton
                        type="button"
                        aria-label={`Edit ${v.id}`}
                        onClick={() => startEdit(v)}
                        disabled={deleteMutation.isPending}
                      >
                        <Pencil size={14} />
                      </GhostButton>
                      <GhostButton
                        type="button"
                        aria-label={`Delete ${v.id}`}
                        onClick={() => deleteMutation.mutate(v.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 size={14} />
                      </GhostButton>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {deleteMutation.error ? <p className="error">{deleteMutation.error.message}</p> : null}
      {updateMutation.error ? <p className="error">{updateMutation.error.message}</p> : null}
    </div>
  );
}

const AVAILABLE_BUILTIN_IDS = ["base", "month", "revenue", "headcount"];

function AddVariablePanel({
  customVariables,
  className,
}: {
  customVariables: CustomVariableDef[];
  className?: string;
}) {
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
    <Panel className={className}>
      <div className="panel-heading">
        <h2>Add variable</h2>
      </div>
      <div
        style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}
      >
        <label className="form-label" style={{ flex: "1 1 120px" }}>
          ID
          <Input
            type="text"
            placeholder="e.g. churnRate"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="form-label" style={{ flex: "1 1 140px" }}>
          Label
          <Input
            type="text"
            placeholder="e.g. Churn Rate"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="form-label" style={{ flex: "0 0 auto" }}>
          Kind
          <div className="radio-group" style={{ marginTop: 4 }}>
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
          <label className="form-label" style={{ flex: "0 1 100px" }}>
            Default
            <Input
              type="number"
              placeholder="0"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
          </label>
        ) : (
          <label className="form-label" style={{ flex: "2 1 180px" }}>
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
        )}
        <Button
          disabled={!canSubmit || createMutation.isPending}
          style={{ flexShrink: 0 }}
          onClick={() =>
            createMutation.mutate({
              id: id.trim(),
              label: label.trim(),
              kind,
              formula: kind === "calculated" ? formula.trim() : undefined,
              defaultValue:
                kind === "input" && defaultValue !== "" ? Number(defaultValue) : undefined,
            })
          }
        >
          Add variable
        </Button>
      </div>
      {kind === "calculated" && formulaStatus ? (
        formulaStatus.ok ? (
          <small className="success">Formula valid</small>
        ) : (
          <small className="error">{formulaStatus.error}</small>
        )
      ) : null}
      {createMutation.error ? <p className="error">{createMutation.error.message}</p> : null}
    </Panel>
  );
}
