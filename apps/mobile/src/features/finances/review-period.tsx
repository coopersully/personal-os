import { router, Stack } from "expo-router";
import { useFinanceRead } from "./data";
import { financeLabel, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

const count = (value: number, one: string, many = `${one}s`) =>
  `${value} ${value === 1 ? one : many}`;

/** A saved period review. It is a record of a finished review, so nothing here writes. */
export function PeriodReview({ id }: { id: string }) {
  const query = useFinanceRead(["period-review", id], (api) => api.getFinancePeriodReview(id));
  const review = query.data;
  // The review records no currency; amounts use the product's default, as Overview does.
  const money = (value: number | null) => formatMoney(value, "USD");
  return (
    <FinanceScreen title="Period review">
      <Stack.Screen options={{ title: "period review" }} />
      <ReadState query={query}>
        {review ? (
          <>
            <Metric
              label="Period"
              value={`${formatLocalDate(review.period.start)} – ${formatLocalDate(review.period.end)}`}
              hint={review.status === "completed" ? "Completed" : "Completed with questions"}
            />
            <Card rows>
              <FinanceRow centered title="Income" value={money(review.income)} icon="finances" />
              <FinanceRow
                centered
                title="Personal spending"
                value={money(review.spending.personal)}
                icon="receipt"
              />
              <FinanceRow
                centered
                title="Savings"
                value={money(review.spending.savings)}
                icon="finances"
              />
              <FinanceRow
                centered
                title="Opening position"
                value={money(review.position.opening)}
                icon="calendar"
              />
              <FinanceRow
                centered
                title="Closing position"
                value={money(review.position.closing)}
                icon="calendar"
              />
              <FinanceRow
                centered
                title="Cash low point"
                value={money(review.position.cashLowPoint)}
                icon="attention"
              />
            </Card>
            <Copy secondary>
              {`Recorded ${new Date(review.createdAt).toLocaleString()}. Evidence through ${new Date(review.cutoff).toLocaleString()}.`}
            </Copy>
            <Section title="Findings and recommendations">
              {review.recommendations.length ? (
                review.recommendations.map((item) => (
                  <Card key={item.recommendation}>
                    <Copy>{item.recommendation}</Copy>
                    <Copy secondary>{financeLabel(item.disposition)}</Copy>
                    <Copy secondary>
                      {`Evidence: ${item.evidence.join(" ") || "None recorded."}`}
                    </Copy>
                    <Copy secondary>
                      {`Assumptions: ${item.assumptions.join(" ") || "None recorded."}`}
                    </Copy>
                    <Copy secondary>
                      {`Tradeoffs: ${item.tradeoffs.join(" ") || "None recorded."}`}
                    </Copy>
                  </Card>
                ))
              ) : (
                <Copy secondary>No recommendations recorded for this review.</Copy>
              )}
            </Section>
            <Section title="Remaining work">
              <Copy>
                {review.closeReadiness.ready
                  ? "The recorded evidence was ready to close at the review cutoff."
                  : "This review still had unresolved evidence at its cutoff."}
              </Copy>
              <Copy secondary>
                {[
                  count(review.work.questions, "question"),
                  count(review.work.exceptions, "exception"),
                  count(review.closeReadiness.unmatchedTransfers, "unmatched transfer"),
                  count(review.closeReadiness.possibleDuplicates, "possible duplicate"),
                ].join(" · ")}
              </Copy>
              <Card rows>
                <FinanceRow
                  title="Open review backlog"
                  subtitle="What is waiting for review now"
                  icon="history"
                  onPress={() =>
                    router.push({ pathname: "/finance-reviews", params: { view: "backlog" } })
                  }
                />
              </Card>
            </Section>
            <Section title="Follow-up">
              <Copy>{review.monitoring.responsibility}</Copy>
              <Copy secondary>
                This is a saved review. Viewing it does not schedule or run financial maintenance.
              </Copy>
            </Section>
          </>
        ) : (
          <Copy secondary>This review is unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
