import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { financeAmount, financeObservedAt } from "./position-material.js";

export function FinancePeriodReviewPage({ id }: { id: string }) {
  const result = useQuery({
    queryKey: ["finance-period-review", id],
    queryFn: () => api.getFinancePeriodReview(id),
  });
  if (result.isPending) return <p role="status">Loading financial review…</p>;
  if (result.isError)
    return (
      <div>
        <InlineError error={result.error} />
        <Button variant="outline" onClick={() => void result.refetch()}>
          Retry
        </Button>
      </div>
    );
  const review = result.data;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {review.period.start} – {review.period.end}
          </CardTitle>
          <CardDescription>
            Recorded {financeObservedAt(review.createdAt)}. Evidence through{" "}
            {financeObservedAt(review.cutoff)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">
            {review.status === "completed" ? "Completed" : "Completed with questions"}
          </Badge>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              ["Income", review.income],
              ["Personal spending", review.spending.personal],
              ["Savings", review.spending.savings],
              ["Opening position", review.position.opening],
              ["Closing position", review.position.closing],
              ["Cash low point", review.position.cashLowPoint],
            ].map(([label, amount]) => (
              <div key={String(label)}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-lg tabular-nums">{financeAmount(amount as number | null)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <section className="space-y-3">
        <h2 className="font-medium">Findings and recommendations</h2>
        {review.recommendations.length ? (
          review.recommendations.map((item) => (
            <article key={item.recommendation} className="space-y-2 border-b pb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{item.recommendation}</h3>
                <Badge variant="outline">{item.disposition.replaceAll("_", " ")}</Badge>
              </div>
              <p className="text-sm">
                Evidence: {item.evidence.join(" ") || "No evidence recorded."}
              </p>
              <p className="text-sm text-muted-foreground">
                Assumptions: {item.assumptions.join(" ") || "None recorded."}
              </p>
              <p className="text-sm text-muted-foreground">
                Tradeoffs: {item.tradeoffs.join(" ") || "None recorded."}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No recommendations recorded for this review.
          </p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Remaining work</h2>
        <p>
          {review.closeReadiness.ready
            ? "The recorded evidence was ready to close at the review cutoff."
            : "This review still had unresolved evidence at its cutoff."}
        </p>
        <p className="text-sm text-muted-foreground">
          {review.work.questions} questions · {review.work.exceptions} exceptions ·{" "}
          {review.closeReadiness.unmatchedTransfers} unmatched transfers ·{" "}
          {review.closeReadiness.possibleDuplicates} possible duplicates.
        </p>
        <Button asChild variant="outline">
          <Link to="/finances/review">Open current review inbox</Link>
        </Button>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Follow-up</h2>
        <p className="text-sm">{review.monitoring.responsibility}</p>
        <p className="text-sm text-muted-foreground">
          This is a saved review. Viewing it does not schedule or run financial maintenance.
        </p>
        <Button asChild variant="ghost">
          <Link to="/finances">Back to overview</Link>
        </Button>
      </section>
    </div>
  );
}
