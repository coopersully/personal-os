import {
  applyReviewedFinanceBatch,
  financeReviewBatchApprovalBlocker,
} from "@personal-os/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";

export function FinanceConversationReviewBatch({
  id,
  sessionKey,
  isCurrent,
}: {
  id: string;
  sessionKey: string;
  isCurrent: () => boolean;
}) {
  const query = useQuery({
    queryKey: ["finance-conversation-review-batch", sessionKey, id],
    queryFn: () => api.getFinanceReviewBatch(id),
    retry: false,
  });
  const busy = useRef(false);
  const [applying, setApplying] = useState(false);
  const batch = query.data;
  const blocker = batch ? financeReviewBatchApprovalBlocker(batch) : null;
  const cancellation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancellation.current?.abort();
    };
  }, []);
  async function apply() {
    const live = () => mounted.current && isCurrent();
    if (!batch || query.isError || busy.current || blocker || !live()) return;
    const controller = new AbortController();
    cancellation.current = controller;
    busy.current = true;
    setApplying(true);
    const feedback = toast.loading("Applying review decisions…");
    try {
      const result = await applyReviewedFinanceBatch(api, batch, controller.signal, live);
      if (!live() || result.state === "cancelled") toast.dismiss(feedback);
      else if (result.state === "completed")
        toast.success("Reviewed batch applied", { id: feedback });
      else if (result.state === "needs_review")
        toast.info("Some decisions need review. Check the saved outcomes.", { id: feedback });
      else
        toast.info("Batch paused. Review the saved outcomes before continuing.", { id: feedback });
    } catch {
      if (live() && !controller.signal.aborted)
        toast.error("Could not confirm progress. Refresh the saved batch before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (live()) await query.refetch();
      busy.current = false;
      cancellation.current = null;
      if (live()) setApplying(false);
    }
  }
  return (
    <section aria-label="Grouped Finance reviews" className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-medium">Grouped reviews</h2>
      {query.isPending ? <p>Loading saved decisions…</p> : null}
      {query.isError ? (
        <div className="grid gap-2">
          <p>Could not load this review batch.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {batch && !query.isError ? (
        <>
          <p>
            {batch.pendingCount} pending ·{" "}
            {batch.outcomes.filter((item) => item.status === "applied").length} applied
          </p>
          <ol className="grid gap-3">
            {batch.decisions.map((decision, index) => {
              const outcome = batch.outcomes.find((item) => item.index === index);
              const counterpart = batch.transferCounterparts?.find((item) => item.index === index);
              return (
                <li key={decision.transactionId} className="grid gap-1 border-t pt-3">
                  <p className="font-medium">{decision.rationale}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {decision.evidence}
                  </p>
                  <p className="text-sm capitalize">
                    {(
                      outcome?.status ??
                      (decision.kind === "review" ? decision.action : decision.kind)
                    ).replaceAll("_", " ")}
                  </p>
                  {outcome?.error ? <p className="text-sm">{outcome.error.message}</p> : null}
                  <Link
                    className="text-sm underline"
                    to={`/finances/transactions?transactionId=${encodeURIComponent(decision.transactionId)}`}
                  >
                    View transaction
                  </Link>
                  {counterpart ? (
                    <Link
                      className="text-sm underline"
                      to={`/finances/transactions?transactionId=${encodeURIComponent(counterpart.transactionId)}`}
                    >
                      View other transfer leg
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {blocker ? <p>{blocker}</p> : null}
          {batch.pendingCount > 0 && !blocker ? (
            <Button disabled={applying || query.isFetching} onClick={() => void apply()}>
              Apply reviewed batch ({batch.pendingCount})
            </Button>
          ) : null}
          {applying ? (
            <Button variant="outline" onClick={() => cancellation.current?.abort()}>
              Stop applying
            </Button>
          ) : null}
        </>
      ) : null}
      <Link className="text-sm underline" to="/finances/chat">
        Back to conversation
      </Link>
    </section>
  );
}
