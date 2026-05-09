import type { DimensionKind, DimensionMember } from "../../domain/types.ts";
import { Button, EmptyState, Panel } from "../ui.tsx";
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
  return <DimensionEditor kind="time" members={dimensions?.time ?? []} />;
}
