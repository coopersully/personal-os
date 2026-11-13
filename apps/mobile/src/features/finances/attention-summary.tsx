import type { FinanceAttentionSnapshot } from "@personal-os/domain";
import { Card, Copy, FinanceRow, Section } from "./ui";

/** Render the canonical snapshot; raw records are never added to decision counts. */
export function FinanceAttentionSummary({
  snapshot,
  onDecisions,
  onHistory,
  onOpening,
  onBudget,
}: {
  snapshot: FinanceAttentionSnapshot;
  onDecisions?: () => void;
  onHistory?: () => void;
  onOpening?: () => void;
  onBudget?: () => void;
}) {
  const month = new Date(`${snapshot.period}-01T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <Section title={month}>
      <Card rows>
        <FinanceRow
          title="Your decisions"
          value={
            !snapshot.complete
              ? "Assessment incomplete"
              : snapshot.activeDecisionCount
                ? `${snapshot.activeDecisionCount} ${snapshot.activeDecisionCount === 1 ? "decision" : "decisions"}`
                : "No decisions waiting"
          }
          icon="categoryTags"
          valueTone={!snapshot.complete || snapshot.activeDecisionCount ? "attention" : undefined}
          onPress={onDecisions}
        />
        {snapshot.processingCount > 0 ? (
          <FinanceRow
            title="In progress"
            icon="clock"
            value={`${snapshot.processingCount} processing`}
          />
        ) : null}
        {snapshot.technicalBlockerCount > 0 ? (
          <FinanceRow
            title="Connection or evidence recovery"
            icon="settings"
            value={`${snapshot.technicalBlockerCount} ${snapshot.technicalBlockerCount === 1 ? "issue" : "issues"}`}
            valueTone="attention"
            onPress={onOpening}
          />
        ) : null}
        <FinanceRow
          title="Starting balances"
          icon="wallet"
          value={snapshot.readiness.openingPositionQualified ? "Verified" : "Needs evidence"}
          valueTone={snapshot.readiness.openingPositionQualified ? undefined : "attention"}
          onPress={onOpening}
        />
        <FinanceRow
          title="Budget"
          icon="wallet"
          value={
            snapshot.readiness.budgetResourcesConfirmed === false
              ? "Confirm funding"
              : snapshot.readiness.budgetInputsCurrent === false
                ? "Review inputs"
                : snapshot.readiness.budgetApproved
                  ? "Approved"
                  : "Not approved"
          }
          valueTone={
            snapshot.readiness.budgetApproved &&
            snapshot.readiness.budgetInputsCurrent !== false &&
            snapshot.readiness.budgetResourcesConfirmed !== false
              ? undefined
              : "attention"
          }
          onPress={onBudget}
        />
      </Card>
      {snapshot.budgetReady ? <Copy>Budget ready</Copy> : null}
      {snapshot.historicalRecordCount > 0 ? (
        <FinanceRow
          title="Historical cleanup"
          icon="history"
          value={`${snapshot.historicalRecordCount.toLocaleString()} records`}
          subtitle="Saved separately; not counted as active decisions."
          onPress={onHistory}
        />
      ) : null}
    </Section>
  );
}
