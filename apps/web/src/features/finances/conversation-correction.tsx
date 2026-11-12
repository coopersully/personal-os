import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { DataViewRecovery } from "@/components/data-view-state";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { FinanceSection } from "./finance-section";
import { formatReviewedAmount } from "./format";
export function FinanceConversationCorrection({
  id,
  sessionKey,
  isCurrent,
}: {
  id: string;
  sessionKey: string;
  isCurrent: () => boolean;
}) {
  const client = useQueryClient();
  const key = ["finance-batch-correction", sessionKey, id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getFinanceReviewBatchUndo(id),
    retry: false,
  });
  const correction = query.data;
  const completeEffects = !!correction?.outcomeIndexes.every((index) =>
    correction.effects?.some((effect) => effect.index === index),
  );
  const batchId = correction?.batchId;
  const batch = useQuery({
    queryKey: ["finance-conversation-review-batch", sessionKey, batchId],
    enabled: !!batchId,
    queryFn: () => {
      if (!batchId) throw new Error("Batch unavailable");
      return api.getFinanceReviewBatch(batchId);
    },
    retry: false,
  });
  const mounted = useRef(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function apply() {
    const live = () => mounted.current && isCurrent();
    if (
      !correction ||
      !completeEffects ||
      !batch.data ||
      !correction.pendingCount ||
      query.isError ||
      batch.isError ||
      busy.current ||
      !live()
    )
      return;
    busy.current = true;
    setPending(true);
    const feedback = toast.loading("Undoing reviewed changes…");
    try {
      const result = await api.executeFinanceReviewBatchUndo(id, {
        fingerprint: correction.fingerprint,
        limit: 10,
      });
      if (live()) {
        client.setQueryData(key, result);
        if (result.status === "completed" && result.pendingCount === 0)
          toast.success("Reviewed changes undone", { id: feedback });
        else
          toast.info("Some changes could not be undone. Review saved outcomes.", { id: feedback });
      } else toast.dismiss(feedback);
    } catch {
      if (live())
        toast.error("Could not confirm the correction. Refresh saved outcomes before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (live()) {
        await query.refetch();
        setPending(false);
      }
      busy.current = false;
    }
  }
  return (
    <FinanceSection title="Review correction">
      <DataViewRecovery
        query={query}
        title="Could not load correction"
        unavailableLabel="Correction unavailable"
      />
      <DataViewRecovery
        query={batch}
        title="Could not load original decisions"
        unavailableLabel="Decisions unavailable"
      />
      {correction && !query.isError && !batch.isError ? (
        <>
          <p className="text-sm text-muted-foreground">
            Undo only these saved decisions. Later edits are preserved. The original changes stay in
            your history.
          </p>
          <ul className="grid gap-3">
            {(completeEffects ? [] : correction.outcomeIndexes).map((index) => {
              const decision = batch.data?.decisions[index];
              const summary = batch.data?.transactionSummaries?.find(
                (item) => item.index === index,
              );
              const outcome = correction.outcomes.find((item) => item.index === index);
              return decision ? (
                <li key={index} className="grid gap-1">
                  <p>{summary?.merchant ?? decision.rationale}</p>
                  {summary ? (
                    <p>
                      {formatReviewedAmount(summary.amountCents, summary.currencyCode)} ·{" "}
                      {summary.date}
                    </p>
                  ) : null}
                  {outcome ? <p>{outcome.status.replaceAll("_", " ")}</p> : null}
                  {outcome?.error ? <p>{outcome.error.message}</p> : null}
                  <Link
                    className="text-sm underline"
                    to={`/finances/transactions?transactionId=${encodeURIComponent(decision.transactionId)}`}
                  >
                    View transaction
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
          {!completeEffects ? (
            <p>
              This older receipt does not show the exact changes. Ask nohmi for a new correction.
            </p>
          ) : null}
          <ul className="grid gap-3">
            {correction.effects?.flatMap((effect) =>
              effect.transactions.map((transaction) => (
                <li key={`${effect.index}:${transaction.id}`} className="grid gap-1">
                  <Link
                    className="font-medium underline"
                    to={`/finances/transactions?transactionId=${encodeURIComponent(transaction.id)}`}
                  >
                    {transaction.merchant}
                  </Link>
                  <p>
                    {formatReviewedAmount(transaction.amountCents, transaction.currencyCode)} ·{" "}
                    {transaction.date}
                  </p>
                  <p>
                    Category: {transaction.after.category ?? "Uncategorized"} →{" "}
                    {transaction.before.category ?? "Uncategorized"}
                  </p>
                  <p>
                    Treatment: {transaction.after.direction} → {transaction.before.direction}
                  </p>
                  {effect.restoredAllocations
                    .filter((item) => item.transactionId === transaction.id)
                    .map((item) => (
                      <p key={item.categoryId}>
                        Restore {item.category ?? "Unknown category"}:{" "}
                        {formatReviewedAmount(item.amountCents, transaction.currencyCode)} (
                        {item.treatment})
                      </p>
                    ))}
                  {effect.reopenedReviews
                    .filter((item) => item.transactionId === transaction.id)
                    .map((item) => (
                      <p key={item.id}>Reopens: {item.reason.replaceAll("_", " ")}</p>
                    ))}
                  <p>{transaction.before.needsReview ? "Returns to review" : "No review needed"}</p>
                  {correction.outcomes.find((item) => item.index === effect.index)?.error ? (
                    <p>
                      {
                        correction.outcomes.find((item) => item.index === effect.index)?.error
                          ?.message
                      }
                    </p>
                  ) : null}
                </li>
              )),
            )}
          </ul>
          {correction.pendingCount ? (
            <Button
              disabled={
                !completeEffects || pending || query.isFetching || batch.isFetching || !batch.data
              }
              onClick={() => void apply()}
            >
              Confirm undo ({correction.pendingCount})
            </Button>
          ) : null}
        </>
      ) : null}
    </FinanceSection>
  );
}
