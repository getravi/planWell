import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DimensionKind, DimensionMember } from "../../domain/types.ts";
import { client } from "../api.ts";
import { Button, EmptyState, Input, Panel } from "../ui.tsx";
import { DimensionEditor } from "./DimensionsPage.tsx";

export function TimeSettingsPage({
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
  if (isLoading) {
    return <div className="screen-center">Loading time settings...</div>;
  }
  if (error) {
    return (
      <Panel>
        <EmptyState
          title="Could not load time settings"
          body="The dimensions API did not return the current time members."
        />
        <p className="error centered-status">{error.message}</p>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </Panel>
    );
  }
  return (
    <div className="grid two">
      <ForecastHorizonPanel />
      <div className="span-two">
        <DimensionEditor kind="time" members={dimensions?.time ?? []} />
      </div>
    </div>
  );
}

function ForecastHorizonPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: client.settings });
  const [horizon, setHorizon] = useState<string>("");

  const save = useMutation({
    mutationFn: (h: number) => client.updateSettings({ forecastHorizon: h }),
    onSuccess: async () => { await queryClient.invalidateQueries(); },
  });

  const currentHorizon = settings.data?.forecastHorizon ?? 12;
  const draft = horizon !== "" ? Number(horizon) : currentHorizon;

  return (
    <Panel>
      <div className="panel-heading">
        <h2>Forecast horizon</h2>
      </div>
      <p className="muted">
        Number of months to generate when recalculating scenarios. Default is 12.
        Explicit time members added below extend the horizon automatically.
      </p>
      <div className="form-field">
        <label className="form-label">
          Months
          <Input
            type="number"
            min={1}
            max={60}
            value={horizon !== "" ? horizon : currentHorizon}
            onChange={(e) => setHorizon(e.target.value)}
          />
        </label>
      </div>
      <Button
        disabled={save.isPending || draft === currentHorizon || draft < 1 || draft > 60 || !Number.isFinite(draft)}
        onClick={() => save.mutate(draft)}
      >
        {save.isPending ? "Saving…" : "Save & recalculate"}
      </Button>
      {save.error ? <p className="error">{save.error.message}</p> : null}
    </Panel>
  );
}
