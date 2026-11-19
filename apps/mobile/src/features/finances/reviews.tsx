import { router, Stack, useLocalSearchParams } from "expo-router";
import { useFinance, useFinanceRead } from "./data";
import { LedgerChecks } from "./ledger-checks";
import { ReimbursementCorrection, ReimbursementDetail, Reimbursements } from "./reimbursements";
import { ReviewBacklog, ReviewHistory, ReviewHistoryItem } from "./review-backlog";
import { PeriodReview } from "./review-period";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const go = (view: string, id?: string) =>
  router.push({ pathname: "/finance-reviews", params: id ? { view, id } : { view } });

/** One route for every review and correction page; `view` names the page. */
export function FinanceReviewsScreen() {
  const { view, id, match } = useLocalSearchParams<{
    view?: string;
    id?: string;
    match?: string;
  }>();
  const { owner } = useFinance();
  // A page never outlives the account it was opened for.
  const key = `${owner}:${view}:${id}:${match}`;
  if (owner) {
    if (view === "backlog") return <ReviewBacklog key={key} />;
    if (view === "history") return <ReviewHistory key={key} />;
    if (view === "checks") return <LedgerChecks key={key} />;
    if (view === "reimbursements") return <Reimbursements key={key} />;
    if (id) {
      if (view === "period") return <PeriodReview key={key} id={id} />;
      if (view === "history-item") return <ReviewHistoryItem key={key} id={id} />;
      if (view === "reimbursement") return <ReimbursementDetail key={key} id={id} />;
      if (view === "reimbursement-correct")
        return <ReimbursementCorrection key={key} id={id} matchId={match} />;
    }
  }
  return (
    <FinanceScreen title="Finance review">
      <Stack.Screen options={{ title: "finance review" }} />
      <Copy secondary>This review is unavailable.</Copy>
    </FinanceScreen>
  );
}

/** The review and correction pages, reached from the Assistant tab. */
export function ReviewDestinations() {
  const status = useFinanceRead(["status"], (api) => api.getFinanceStatus());
  const latest = status.data?.details.latestReview;
  return (
    <Section title="Reviews and checks">
      <Card rows>
        <ReadState query={status}>
          {latest ? (
            <FinanceRow
              title="Period review"
              subtitle={`Recorded ${new Date(latest.completedAt).toLocaleDateString()}`}
              icon="calendar"
              onPress={() => go("period", latest.id)}
            />
          ) : (
            <FinanceRow
              title="Period review"
              subtitle="No period review recorded yet."
              icon="calendar"
            />
          )}
        </ReadState>
        <FinanceRow
          title="Review backlog"
          subtitle="Flagged transactions and open reviews"
          icon="attention"
          onPress={() => go("backlog")}
        />
        <FinanceRow
          title="Review history"
          subtitle="Resolved reviews and their evidence"
          icon="history"
          onPress={() => go("history")}
        />
        <FinanceRow
          title="Ledger checks"
          subtitle="Transfers, duplicates and alerts"
          icon="info"
          onPress={() => go("checks")}
        />
        <FinanceRow
          title="Reimbursements"
          subtitle="What you still expect to recover"
          icon="receipt"
          onPress={() => go("reimbursements")}
        />
      </Card>
    </Section>
  );
}
