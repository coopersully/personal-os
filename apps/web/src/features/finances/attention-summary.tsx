import type { FinanceAttentionSnapshot } from "@personal-os/domain";
import { Link } from "react-router-dom";
import { FinanceSection } from "./finance-section";
export function FinanceAttentionSummary({ snapshot }: { snapshot: FinanceAttentionSnapshot }) {
  const month = new Date(`${snapshot.period}-01T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <FinanceSection title={`${month} · Active inbox`}>
      <dl className="grid gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt>
            <Link to="/finances/chat" className="underline">
              Your decisions
            </Link>
          </dt>
          <dd>
            {!snapshot.complete
              ? "Assessment incomplete"
              : snapshot.activeDecisionCount
                ? `${snapshot.activeDecisionCount} ${snapshot.activeDecisionCount === 1 ? "decision" : "decisions"}`
                : "No decisions waiting"}
          </dd>
        </div>
        {snapshot.processingCount ? (
          <div className="flex justify-between gap-2">
            <dt>In progress</dt>
            <dd>{snapshot.processingCount} processing</dd>
          </div>
        ) : null}
        {snapshot.technicalBlockerCount ? (
          <div className="flex justify-between gap-2">
            <dt>Connection or evidence recovery</dt>
            <dd>
              {snapshot.technicalBlockerCount}{" "}
              {snapshot.technicalBlockerCount === 1 ? "issue" : "issues"}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <dt>
            <Link to="/finances/plan?opening=1" className="underline">
              Starting balances
            </Link>
          </dt>
          <dd>{snapshot.readiness.openingPositionQualified ? "Verified" : "Needs evidence"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>
            <Link to="/finances/plan" className="underline">
              Budget
            </Link>
          </dt>
          <dd>{snapshot.readiness.budgetApproved ? "Approved" : "Not approved"}</dd>
        </div>
      </dl>
      {snapshot.budgetReady ? <p>Budget ready</p> : null}
      {snapshot.historicalRecordCount > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer py-2">
            Historical cleanup · {snapshot.historicalRecordCount.toLocaleString()} records
          </summary>
          <p className="text-muted-foreground">
            Saved separately, without deleting or resolving anything. Older items that affect the
            current budget stay active.
          </p>
          <Link className="inline-block py-2 underline" to="/finances/chat">
            Work through history with nohmi
          </Link>
        </details>
      ) : null}
    </FinanceSection>
  );
}
