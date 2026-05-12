import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useState } from "react";
import { client } from "../api.ts";
import { Button, Input, Panel } from "../ui.tsx";

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
          if (!file) return;
          importCsv.mutate(await file.text());
        }}
      />
      {status ? <p className="success">{status}</p> : null}
      {importCsv.error ? <p className="error">{importCsv.error.message}</p> : null}
    </Panel>
  );
}

function LastActualsMonthPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: client.settings });
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = value !== "" ? value : (data?.lastActualsMonth ?? "");

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await client.updateSettings({ lastActualsMonth: current || null });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setValue("");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    setSaved(false);
    try {
      await client.updateSettings({ lastActualsMonth: null });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setValue("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <div className="panel-heading">
        <h2>Last actuals month</h2>
      </div>
      <p className="muted">
        Set the last month for which actual data is available. On the Forecast and Analyst pages,
        months up to and including this month will display actuals instead of forecast values.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="month"
          value={current}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14 }}
        />
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {data?.lastActualsMonth ? (
          <Button type="button" disabled={saving} onClick={() => void clear()}>
            Clear
          </Button>
        ) : null}
        {saved && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
      </div>
      {data?.lastActualsMonth && (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Currently set to <strong>{data.lastActualsMonth}</strong>.
        </p>
      )}
    </Panel>
  );
}

export function DataIntegrationPage() {
  return (
    <>
      <LastActualsMonthPanel />
      <ImportPanel />
    </>
  );
}
