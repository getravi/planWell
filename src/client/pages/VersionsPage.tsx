import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { client, type VersionRecord } from "../api.ts";
import { Button, DataTable, EmptyState, GhostButton, Input, Label, Panel, Select } from "../ui.tsx";

export function VersionsPage({
  versions,
  error,
  isLoading,
  onRetry,
}: {
  versions: VersionRecord[];
  error: Error | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VersionRecord | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);

  useEffect(() => {
    setSourceId((current) => current || versions[0]?.id || "");
    setDraftNames((current) => ({
      ...Object.fromEntries(versions.map((version) => [version.id, version.name])),
      ...current,
    }));
  }, [versions]);

  const syncVersions = (nextVersions: VersionRecord[]) => {
    queryClient.setQueryData(["versions"], { versions: nextVersions });
  };
  const refreshPlanningData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scenarios"] }),
      queryClient.invalidateQueries({ queryKey: ["forecast"] }),
      queryClient.invalidateQueries({ queryKey: ["variance"] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () => client.createVersion(newName, sourceId),
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setNewName("");
      setCreateOpen(false);
      setStatus("Version added.");
      await refreshPlanningData();
    },
  });
  const updateVersion = useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: { name?: string; locked?: boolean; sortOrder?: number };
    }) => client.updateVersion(id, changes),
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setStatus("Version saved.");
      await refreshPlanningData();
    },
  });
  const remove = useMutation({
    mutationFn: (version: VersionRecord) => client.deleteVersion(version.id),
    onMutate: async (version) => {
      const previous = queryClient.getQueryData<{ versions: VersionRecord[] }>(["versions"]);
      const currentVersions = previous?.versions ?? versions;
      syncVersions(currentVersions.filter((item) => item.id !== version.id));
      setPendingDelete(null);
      return { previous };
    },
    onError: (_error, _version, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["versions"], context.previous);
      }
      setStatus("Could not delete version.");
    },
    onSuccess: async (result) => {
      syncVersions(result.versions);
      setStatus("Version deleted.");
      await refreshPlanningData();
    },
  });
  const saveVersionName = (version: VersionRecord) => {
    const name = (draftNames[version.id] ?? version.name).trim();
    if (!name || name === version.name) {
      return;
    }
    updateVersion.mutate({ id: version.id, changes: { name } });
  };
  const toggleVersionLock = (version: VersionRecord, locked: boolean) => {
    updateVersion.mutate({ id: version.id, changes: { locked } });
  };

  const moveRow = (version: VersionRecord, direction: "up" | "down") => {
    const siblings = versions.filter((v) => v.kind === version.kind);
    const idx = siblings.findIndex((v) => v.id === version.id);
    const sibling = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!sibling) return;

    const siblingOrder =
      sibling.sortOrder || (direction === "up" ? (idx - 1) * 10 : (idx + 1) * 10);

    updateVersion.mutate({
      id: version.id,
      changes: {
        sortOrder: direction === "up" ? siblingOrder - 5 : siblingOrder + 5,
      },
    });
  };

  if (isLoading) {
    return <div className="screen-center">Loading versions...</div>;
  }
  if (error) {
    return (
      <Panel>
        <EmptyState
          title="Could not load versions"
          body="The versions API did not return the current planning versions."
        />
        <p className="error centered-status">{error.message}</p>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }

  return (
    <div className="model-structure">
      <Panel>
        <div className="panel-heading">
          <h2>All versions</h2>
        </div>
        <DataTable
          ariaLabel="All versions"
          columns={[
            {
              id: "version",
              header: "Version",
              cell: (version) => {
                const isEditing = editingCell === version.id;
                if (!version.canRename) {
                  return <span className="time-readonly-label">{version.name}</span>;
                }
                if (isEditing) {
                  return (
                    <Input
                      autoFocus
                      aria-label={`Name for ${version.name}`}
                      value={draftNames[version.id] ?? version.name}
                      onChange={(event) =>
                        setDraftNames((current) => ({
                          ...current,
                          [version.id]: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        saveVersionName(version);
                        setEditingCell(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveVersionName(version);
                          setEditingCell(null);
                        } else if (event.key === "Escape") {
                          setDraftNames((current) => ({
                            ...current,
                            [version.id]: version.name,
                          }));
                          setEditingCell(null);
                        }
                      }}
                    />
                  );
                }
                return (
                  <span
                    className="editable-cell-label"
                    title="Double-click to edit"
                    onDoubleClick={() => setEditingCell(version.id)}
                  >
                    {draftNames[version.id] ?? version.name}
                  </span>
                );
              },
            },
            {
              id: "type",
              header: "Type",
              cell: (version) => (
                <span className="data-table-badge">
                  {version.kind === "actuals" ? "Actuals" : "Scenario"}
                </span>
              ),
            },
            {
              id: "locked",
              header: "Locked",
              cell: (version) =>
                version.canLock ? (
                  <label className="lock-toggle">
                    <input
                      aria-label={`Lock ${version.name}`}
                      checked={version.locked}
                      disabled={updateVersion.isPending}
                      onChange={(event) => toggleVersionLock(version, event.target.checked)}
                      type="checkbox"
                    />
                    <span>{version.locked ? "Locked" : "Unlocked"}</span>
                  </label>
                ) : (
                  <span className="muted">Read-only</span>
                ),
            },
            {
              className: "data-table-actions-cell",
              header: "Actions",
              headerClassName: "data-table-actions-head",
              id: "actions",
              cell: (version) => {
                const siblings = versions.filter((v) => v.kind === version.kind);
                const idx = siblings.findIndex((v) => v.id === version.id);
                return (
                  <div className="grid-toolbar">
                    {version.canRename ? (
                      <>
                        <GhostButton
                          type="button"
                          aria-label={`Move ${version.name} up`}
                          title="Move up"
                          disabled={idx <= 0 || updateVersion.isPending}
                          onClick={() => moveRow(version, "up")}
                        >
                          <ArrowUp size={15} aria-hidden="true" />
                        </GhostButton>
                        <GhostButton
                          type="button"
                          aria-label={`Move ${version.name} down`}
                          title="Move down"
                          disabled={
                            idx === -1 || idx >= siblings.length - 1 || updateVersion.isPending
                          }
                          onClick={() => moveRow(version, "down")}
                        >
                          <ArrowDown size={15} aria-hidden="true" />
                        </GhostButton>
                      </>
                    ) : null}
                    {version.canDelete ? (
                      <GhostButton
                        type="button"
                        aria-label={`Delete ${version.name}`}
                        title={`Delete ${version.name}`}
                        onClick={() => setPendingDelete(version)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </GhostButton>
                    ) : null}
                  </div>
                );
              },
            },
          ]}
          data={versions}
          getRowId={(version) => version.id}
          rowLabel={(version) => version.name}
          toolbar={
            <div className="table-actions">
              <span>{versions.length} versions</span>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Add version
              </Button>
            </div>
          }
        />
        {updateVersion.error ? <p className="error">{updateVersion.error.message}</p> : null}
        {remove.error ? <p className="error">{remove.error.message}</p> : null}
        {status ? <p className="muted">{status}</p> : null}
      </Panel>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-version-title"
          >
            <div className="panel-heading">
              <h2 id="add-version-title">Add version</h2>
              <GhostButton type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </GhostButton>
            </div>
            <form
              className="driver-controls"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <label>
                <Label>New version name</Label>
                <Input
                  aria-label="New version name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <label>
                <Label>Copy data from</Label>
                <Select
                  aria-label="Copy data from"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" disabled={!newName || !sourceId || create.isPending}>
                <Copy size={16} /> Create version
              </Button>
            </form>
            {create.error ? <p className="error">{create.error.message}</p> : null}
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-version-title"
          >
            <div className="panel-heading">
              <h2 id="delete-version-title">Delete {pendingDelete.name}</h2>
              <GhostButton type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </GhostButton>
            </div>
            <p className="warning-copy">
              This will permanently delete forecast values and driver assumptions for this version.
              This data cannot be restored from PlanWell after deletion.
            </p>
            <div className="button-row">
              <Button type="button" onClick={() => remove.mutate(pendingDelete)}>
                <Trash2 size={16} /> Delete version
              </Button>
              <GhostButton type="button" onClick={() => setPendingDelete(null)}>
                Keep version
              </GhostButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
