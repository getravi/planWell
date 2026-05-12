import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "../api.ts";
import { Button, Panel } from "../ui.tsx";

function DownloadBackupPanel() {
  return (
    <Panel>
      <div className="panel-heading">
        <h2>Download backup</h2>
      </div>
      <p className="muted">
        Download a consistent point-in-time snapshot of the SQLite database. Use this to back up
        your data before major changes or deployments.
      </p>
      <a href={client.backupUrl} download>
        <Button type="button">Download backup</Button>
      </a>
    </Panel>
  );
}

function UploadBackupPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setErrorMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(client.restoreUrl, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((body as { error: string }).error);
      }
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Panel>
      <div className="panel-heading">
        <h2>Restore backup</h2>
      </div>
      <p className="muted">
        Upload a previously downloaded <code>.sqlite</code> backup file. The server will restart
        automatically with the restored database.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".sqlite,.db"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <Button
        type="button"
        disabled={status === "uploading"}
        onClick={() => inputRef.current?.click()}
      >
        {status === "uploading" ? "Uploading…" : "Upload backup"}
      </Button>
      {status === "success" && (
        <p className="muted" style={{ marginTop: 8 }}>
          Restore successful. Server is restarting — reload in a few seconds.
        </p>
      )}
      {status === "error" && (
        <p className="error" style={{ marginTop: 8 }}>
          {errorMsg}
        </p>
      )}
    </Panel>
  );
}

function AiModelPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["aiProviders"],
    queryFn: client.aiProviders,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = selected ?? data?.selectedModel ?? "";
  const providers = data?.providers ?? [];

  async function save() {
    if (!current) return;
    setSaving(true);
    setSaved(false);
    try {
      await client.updateSettings({ aiModel: current });
      void qc.invalidateQueries({ queryKey: ["aiProviders"] });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <div className="panel-heading">
        <h2>AI model</h2>
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && providers.length === 0 && (
        <p className="muted">
          No AI provider configured. Set <code>ANTHROPIC_API_KEY</code> or{" "}
          <code>GEMINI_API_KEY</code> as environment variables.
        </p>
      )}
      {providers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <select
            value={current}
            onChange={(e) => { setSelected(e.target.value); setSaved(false); }}
            style={{ width: "100%", padding: "6px 8px" }}
          >
            {providers.map((provider) => (
              <optgroup key={provider.id} label={provider.label}>
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button type="button" disabled={saving || !current} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {saved && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function AdminPage() {
  return (
    <>
      <AiModelPanel />
      <DownloadBackupPanel />
      <UploadBackupPanel />
    </>
  );
}
