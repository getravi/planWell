import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DimensionImpact,
  DimensionKind,
  DimensionMember,
  Dimensions,
} from "../../domain/types.ts";
import { client } from "../api.ts";
import {
  dimensionTitle,
  flattenMembers,
  flattenMembersWithDepth,
  isMonth,
  updateDimensionSortOrder,
} from "../dimension-utils.ts";
import {
  Button,
  type DataTableColumn,
  DataTable,
  EmptyState,
  GhostButton,
  Input,
  Label,
  Panel,
  Select,
} from "../ui.tsx";

export function DimensionsPage({
  dimensions,
  error,
  isLoading,
  onRetry,
}: {
  dimensions?: Record<DimensionKind, DimensionMember[]>;
  error: Error | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const [activeKind, setActiveKind] = useState<"department" | "account">("department");
  if (isLoading) {
    return <div className="screen-center">Loading dimensions...</div>;
  }
  if (error) {
    return (
      <Panel>
        <EmptyState
          title="Could not load dimensions"
          body="The dimensions API did not return the current model members."
        />
        <p className="error centered-status">{error.message}</p>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }
  const labels: Record<"department" | "account", string> = {
    department: "Departments",
    account: "Accounts",
  };
  return (
    <>
      <div
        className="tab-bar dimension-tabs folder-tabs"
        role="tablist"
        aria-label="Model dimensions"
      >
        {(Object.keys(labels) as ("department" | "account")[]).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            className={activeKind === kind ? "dimension-tab active" : "dimension-tab"}
            onClick={() => setActiveKind(kind)}
          >
            {labels[kind]}
          </button>
        ))}
      </div>
      <DimensionEditor kind={activeKind} members={dimensions?.[activeKind] ?? []} />
    </>
  );
}

export function DimensionEditor({
  kind,
  members,
}: {
  kind: DimensionKind;
  members: DimensionMember[];
}) {
  const queryClient = useQueryClient();
  const flatMembers = useMemo(() => flattenMembers(members), [members]);
  const depthMap = useMemo(
    () => new Map(flattenMembersWithDepth(members).map((m) => [m.name, m.depth])),
    [members],
  );
  const editableMembers = flatMembers;
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftParents, setDraftParents] = useState<Record<string, string | null>>({});
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string | null>(null);
  const [isAddOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DimensionMember | null>(null);
  const [impact, setImpact] = useState<DimensionImpact | null>(null);
  const [status, setStatus] = useState("");
  const [editingCell, setEditingCell] = useState<string | null>(null);

  useEffect(() => {
    setDraftNames((current) => ({
      ...Object.fromEntries(editableMembers.map((m) => [m.name, m.name])),
      ...current,
    }));
    setDraftParents((current) => ({
      ...Object.fromEntries(editableMembers.map((m) => [m.name, m.parentName ?? null])),
      ...current,
    }));
  }, [editableMembers]);

  const refresh = async () => {
    await queryClient.invalidateQueries();
  };

  const create = useMutation({
    mutationFn: () =>
      client.createDimensionMember(kind, newName, kind === "time" ? null : newParent),
    onSuccess: async () => {
      setNewName("");
      setNewParent(null);
      setAddOpen(false);
      setStatus("Member added.");
      await refresh();
    },
  });

  const update = useMutation({
    mutationFn: ({
      originalName,
      name,
      parentName,
    }: {
      originalName: string;
      name: string;
      parentName?: string | null;
    }) =>
      client.updateDimensionMember(kind, originalName, {
        name,
        parentName: kind === "time" ? null : parentName,
      }),
    onSuccess: async (_result, variables) => {
      if (variables.name !== variables.originalName) {
        setDraftNames((current) => {
          const next = { ...current };
          delete next[variables.originalName];
          next[variables.name] = variables.name;
          return next;
        });
      }
      setStatus("Member saved.");
      await refresh();
    },
  });

  const selectedSiblingsFor = (member: DimensionMember) =>
    editableMembers.filter((m) => (m.parentName ?? null) === (member.parentName ?? null));

  const moveMember = useMutation({
    mutationFn: ({ memberName, sortOrder }: { memberName: string; sortOrder: number }) =>
      client.updateDimensionMember(kind, memberName, { sortOrder }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["dimensions"] });
      const previousDimensions = queryClient.getQueryData<Dimensions>(["dimensions"]);
      if (previousDimensions) {
        queryClient.setQueryData(
          ["dimensions"],
          updateDimensionSortOrder(
            previousDimensions,
            kind,
            variables.memberName,
            variables.sortOrder,
          ),
        );
      }
      return { previousDimensions };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousDimensions) {
        queryClient.setQueryData(["dimensions"], context.previousDimensions);
      }
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["dimensions"], result.dimensions);
      setStatus("Order updated.");
    },
  });

  const moveRow = (member: DimensionMember, direction: "up" | "down") => {
    const siblings = selectedSiblingsFor(member);
    const idx = siblings.findIndex((m) => m.name === member.name);
    const sibling = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!sibling) return;
    moveMember.mutate({
      memberName: member.name,
      sortOrder:
        direction === "up" ? (sibling.sortOrder ?? idx) - 0.5 : (sibling.sortOrder ?? idx) + 0.5,
    });
  };

  const loadImpact = useMutation({
    mutationFn: (member: DimensionMember) => client.dimensionImpact(kind, member.name),
    onSuccess: (result, member) => {
      setImpact(result.impact);
      setPendingDelete(member);
    },
  });

  const remove = useMutation({
    mutationFn: (member: DimensionMember) => client.deleteDimensionMember(kind, member.name, true),
    onSuccess: async () => {
      setImpact(null);
      setPendingDelete(null);
      setStatus("Member deleted.");
      await refresh();
    },
  });

  const saveName = (member: DimensionMember) => {
    const name = (draftNames[member.name] ?? member.name).trim();
    if (!name || name === member.name) return;
    update.mutate({
      originalName: member.name,
      name,
      parentName: draftParents[member.name],
    });
  };

  const saveParent = (member: DimensionMember, parentName: string | null) => {
    setDraftParents((current) => ({ ...current, [member.name]: parentName }));
    update.mutate({
      originalName: member.name,
      name: draftNames[member.name] ?? member.name,
      parentName,
    });
  };

  const parentOptions = flatMembers.filter((m) => kind !== "time" || !isMonth(m.name));

  const currentError =
    create.error?.message ??
    update.error?.message ??
    moveMember.error?.message ??
    loadImpact.error?.message ??
    remove.error?.message;

  const editCellId = (member: DimensionMember, field: string) => `${member.name}::${field}`;

  const columns: DataTableColumn<DimensionMember>[] = [
    {
      id: "name",
      header: "Name",
      cell: (member) => {
        const cellId = editCellId(member, "name");
        const isEditing = editingCell === cellId;
        const depth = depthMap.get(member.name) ?? 0;
        const indent = depth * 16;
        const isReadOnly = kind === "time" && !isMonth(member.name);
        if (!isReadOnly && isEditing) {
          return (
            <Input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label={`Name for ${member.name}`}
              style={{ paddingLeft: 8 + indent }}
              value={draftNames[member.name] ?? member.name}
              onChange={(event) =>
                setDraftNames((current) => ({ ...current, [member.name]: event.target.value }))
              }
              onBlur={() => {
                saveName(member);
                setEditingCell(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveName(member);
                  setEditingCell(null);
                } else if (event.key === "Escape") {
                  setDraftNames((current) => ({ ...current, [member.name]: member.name }));
                  setEditingCell(null);
                }
              }}
            />
          );
        }
        if (isReadOnly) {
          return (
            <span className="time-readonly-label" style={{ paddingLeft: indent || undefined }}>
              {depth > 0 && <span className="tree-indent-connector" aria-hidden="true" />}
              {member.name}
            </span>
          );
        }
        return (
          <span
            className="editable-cell-label"
            style={{ paddingLeft: indent || undefined }}
            title="Double-click to edit"
            onDoubleClick={() => setEditingCell(cellId)}
          >
            {depth > 0 && <span className="tree-indent-connector" aria-hidden="true" />}
            {draftNames[member.name] ?? member.name}
          </span>
        );
      },
    },
    ...(kind !== "time"
      ? [
          {
            id: "parent",
            header: "Parent",
            cell: (member: DimensionMember) => {
              const cellId = editCellId(member, "parent");
              const isEditing = editingCell === cellId;
              const currentParent = draftParents[member.name] ?? null;
              if (isEditing) {
                return (
                  <Select
                    aria-label={`Parent of ${member.name}`}
                    value={currentParent ?? ""}
                    onChange={(event) => {
                      saveParent(member, event.target.value || null);
                      setEditingCell(null);
                    }}
                  >
                    <option value="">No parent</option>
                    {parentOptions
                      .filter((m) => m.name !== member.name)
                      .map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                  </Select>
                );
              }
              return (
                <span
                  className="editable-cell-label"
                  title="Double-click to edit"
                  onDoubleClick={() => setEditingCell(cellId)}
                >
                  {currentParent ?? <span className="muted">—</span>}
                </span>
              );
            },
          } satisfies DataTableColumn<DimensionMember>,
        ]
      : []),
    {
      id: "refs",
      header: "Refs",
      cell: (member) => <span className="data-table-badge">{member.referenceCount}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "data-table-actions-head",
      className: "data-table-actions-cell",
      cell: (member: DimensionMember) => {
        const isReadOnly = kind === "time" && !isMonth(member.name);
        if (isReadOnly) return null;
        const siblings = selectedSiblingsFor(member);
        const idx = siblings.findIndex((m) => m.name === member.name);
        return (
          <div className="grid-toolbar">
            {kind !== "time" ? (
              <>
                <GhostButton
                  type="button"
                  aria-label={`Move ${member.name} up`}
                  title="Move up"
                  disabled={idx <= 0 || moveMember.isPending}
                  onClick={() => moveRow(member, "up")}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                </GhostButton>
                <GhostButton
                  type="button"
                  aria-label={`Move ${member.name} down`}
                  title="Move down"
                  disabled={idx === -1 || idx >= siblings.length - 1 || moveMember.isPending}
                  onClick={() => moveRow(member, "down")}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                </GhostButton>
              </>
            ) : null}
            <GhostButton
              type="button"
              aria-label={`Delete ${member.name}`}
              title="Delete"
              onClick={() => loadImpact.mutate(member)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </GhostButton>
          </div>
        );
      },
    },
  ];

  return (
    <Panel>
      <div className="panel-heading">
        <h2>{dimensionTitle(kind)} members</h2>
      </div>
      <DataTable
        ariaLabel={`${dimensionTitle(kind)} members`}
        columns={columns}
        data={editableMembers}
        getRowId={(m) => m.name}
        rowLabel={(m) => m.name}
        emptyMessage="No members yet. Add the first one."
        toolbar={
          <div className="table-actions">
            <span>{editableMembers.length} members</span>
            <Button type="button" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Add member
            </Button>
          </div>
        }
      />
      {currentError ? <p className="error">{currentError}</p> : null}
      {status ? <p className="muted">{status}</p> : null}

      {isAddOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-member-title"
          >
            <div className="panel-heading">
              <h2 id="add-member-title">Add {dimensionTitle(kind).toLowerCase()} member</h2>
              <GhostButton type="button" onClick={() => setAddOpen(false)}>
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
                <Label>{kind === "time" ? "Month or year" : "Name"}</Label>
                <Input
                  aria-label="New member name"
                  placeholder={kind === "time" ? "2027 or 2027-01" : "New member"}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              {kind !== "time" ? (
                <label>
                  <Label>Parent</Label>
                  <Select
                    aria-label="New member parent"
                    value={newParent ?? ""}
                    onChange={(event) => setNewParent(event.target.value || null)}
                  >
                    <option value="">No parent</option>
                    {flatMembers.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <Button type="submit" disabled={!newName.trim() || create.isPending}>
                <Plus size={16} /> Add member
              </Button>
            </form>
            {create.error ? <p className="error">{create.error.message}</p> : null}
          </div>
        </div>
      ) : null}

      {pendingDelete && impact ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-member-title"
          >
            <div className="panel-heading">
              <h2 id="delete-member-title">Delete {pendingDelete.name}</h2>
              <GhostButton
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setImpact(null);
                }}
              >
                Cancel
              </GhostButton>
            </div>
            <div className="impact-box">
              <strong>Delete impact</strong>
              <span>{impact.actualRows} actual rows</span>
              <span>{impact.forecastRows} forecast rows</span>
              <span>{impact.scenarioOverrides} scenario overrides</span>
              <span>{impact.childCount} child members</span>
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <Button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(pendingDelete)}
              >
                <Trash2 size={16} /> Delete anyway
              </Button>
              <GhostButton
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setImpact(null);
                }}
              >
                Keep member
              </GhostButton>
            </div>
            {remove.error ? <p className="error">{remove.error.message}</p> : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
