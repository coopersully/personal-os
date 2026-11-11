import {
  ApiClientError,
  applyReviewedFinanceBatch,
  financeReviewBatchApprovalBlocker,
} from "@personal-os/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { TagsIcon } from "@/components/icons";
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
  const [confirmed, setConfirmed] = useState<typeof query.data>();
  const unavailable =
    query.error instanceof ApiClientError && [401, 403, 404].includes(query.error.status);
  const retained =
    confirmed && (!query.data || confirmed.pendingCount < query.data.pendingCount)
      ? confirmed
      : query.data;
  const batch = unavailable ? undefined : retained;
  const needsCategories = !!batch?.decisions.some(
    (item) => item.kind === "categorization" || item.action === "recategorize",
  );
  const categories = useQuery({
    queryKey: ["finance-conversation-categories", sessionKey],
    queryFn: () => api.getFinanceCategories(),
    enabled: needsCategories,
    retry: false,
  });
  const categoryBlocker =
    needsCategories &&
    (categories.isFetching ||
      categories.isError ||
      batch?.decisions.some(
        (item) =>
          (item.kind === "categorization" || item.action === "recategorize") &&
          !categories.data?.some((category) => category.id === item.categoryId),
      ));
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
    if (!batch || query.isError || busy.current || blocker || categoryBlocker || !live()) return;
    const controller = new AbortController();
    cancellation.current = controller;
    busy.current = true;
    setApplying(true);
    const feedback = toast.loading("Applying review decisions…");
    try {
      const result = await applyReviewedFinanceBatch(
        api,
        batch,
        controller.signal,
        live,
        (receipt) => {
          if (live()) setConfirmed(receipt);
        },
      );
      if (!live() || result.state === "cancelled") toast.dismiss(feedback);
      else if (result.state === "completed")
        toast.success("Reviewed batch applied", { id: feedback });
      else if (result.state === "needs_review")
        toast.info("Some decisions need review. Check the saved outcomes.", { id: feedback });
      else
        toast.info("Batch paused. Review the saved outcomes before continuing.", { id: feedback });
    } catch {
      if (live() && !controller.signal.aborted)
        toast.error(
          "Could not finish checking the batch. Refresh saved progress before retrying.",
          {
            id: feedback,
          },
        );
      else toast.dismiss(feedback);
    } finally {
      if (live()) await query.refetch();
      busy.current = false;
      cancellation.current = null;
      if (live()) setApplying(false);
    }
  }
  async function refreshCategories() {
    const feedback = toast.loading("Refreshing target categories…");
    const result = await categories.refetch();
    if (!mounted.current || !isCurrent()) toast.dismiss(feedback);
    else if (result.isError) toast.error("Could not refresh target categories.", { id: feedback });
    else toast.success("Target categories refreshed", { id: feedback });
  }
  return (
    <section aria-label="Grouped Finance reviews" className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-medium">Grouped reviews</h2>
      {query.isPending ? <p>Loading saved decisions…</p> : null}
      {query.isError ? (
        <div className="grid gap-2">
          <p>
            {batch
              ? "The latest batch read failed. Showing confirmed outcomes."
              : "Could not load this review batch."}
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {batch ? (
        <>
          <p>
            {batch.pendingCount} pending ·{" "}
            {batch.outcomes.filter((item) => item.status === "applied").length} applied
          </p>
          <ol className="grid gap-3">
            {batch.decisions.map((decision, index) => {
              const target =
                decision.kind === "categorization" || decision.action === "recategorize"
                  ? categories.data?.find((category) => category.id === decision.categoryId)
                  : undefined;
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
                  {target ? (
                    <p className="flex items-center gap-1 text-sm">
                      <TagsIcon aria-hidden="true" className="size-4" />
                      Category: {target.name}
                    </p>
                  ) : null}
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
          {categoryBlocker ? (
            <Button
              variant="outline"
              disabled={categories.isFetching}
              onClick={() => void refreshCategories()}
            >
              Refresh target categories before applying
            </Button>
          ) : null}
          {batch.pendingCount > 0 && !blocker && !categoryBlocker && !query.isError ? (
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
