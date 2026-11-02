export type FinanceMaintenanceWork = Readonly<{
  id: string;
  evidenceReady: boolean;
  approvalReady: boolean;
  sourceReady: boolean;
}>;

export type FinanceMaintenanceWorkSelection = Readonly<{
  id: string;
  state: "eligible" | "awaiting_evidence" | "awaiting_approval" | "source_blocked";
}>;

/** Classify already assessed work without discarding independent or blocked items.
 * Eligibility is planning only: existing preview, current authorization and execution
 * checks remain mandatory. These flags never grant authority or start another run. */
export function selectFinanceMaintenanceWork(
  items: readonly FinanceMaintenanceWork[],
): readonly FinanceMaintenanceWorkSelection[] {
  return items.map(({ id, sourceReady, evidenceReady, approvalReady }) => ({
    id,
    state: !sourceReady
      ? "source_blocked"
      : !evidenceReady
        ? "awaiting_evidence"
        : !approvalReady
          ? "awaiting_approval"
          : "eligible",
  }));
}
