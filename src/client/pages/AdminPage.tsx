import { useRef, useState } from "react";
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

export function AdminPage() {
  return (
    <>
      <DownloadBackupPanel />
      <UploadBackupPanel />
    </>
  );
}
