import { ApiClientError, financeReviewBatchApprovalBlocker } from "@personal-os/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { TagsIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { formatReviewedAmount } from "./format";

export function FinanceConversationReviewBatch({
  id,
  sessionKey,
  isCurrent,
}: {
  id: string;
  sessionKey: string;
  isCurrent: () => boolean;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const approvalKey = ["finance-batch-continuation", sessionKey, id];
  const approval = useQuery({
    queryKey: approvalKey,
    queryFn: () => api.getFinanceBatchContinuation(id),
    retry: false,
    refetchInterval: (query) =>
      ["pending", "running"].includes(query.state.data?.state ?? "") ? 5_000 : false,
  });
  const processing = approval.data?.state === "pending" || approval.data?.state === "running";
  const query = useQuery({
    queryKey: ["finance-conversation-review-batch", sessionKey, id],
    queryFn: () => api.getFinanceReviewBatch(id),
    retry: false,
    refetchInterval: processing ? 5_000 : false,
  });
  const approvalState = approval.data?.state;
  const refreshBatch = query.refetch;
  useEffect(() => {
    if (approvalState) void refreshBatch();
  }, [approvalState, refreshBatch]);
  const busy = useRef(false);
  const [applying, setApplying] = useState(false);
  const unavailable =
    query.error instanceof ApiClientError && [401, 403, 404].includes(query.error.status);
  const batch = unavailable ? undefined : query.data;
  const needsCategories = !!batch?.decisions.some(
    (item) =>
      item.kind === "categorization" || (item.kind === "review" && item.action === "recategorize"),
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
          (item.kind === "categorization" ||
            (item.kind === "review" && item.action === "recategorize")) &&
          !categories.data?.some((category) => category.id === item.categoryId),
      ));
  const blocker = batch ? financeReviewBatchApprovalBlocker(batch) : null;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function saveApproval(cancel = false) {
    const live = () => mounted.current && isCurrent();
    if (!batch || busy.current || !live()) return;
    if (
      !cancel &&
      (query.isError ||
        blocker ||
        categoryBlocker ||
        approval.isPending ||
        approval.isError ||
        approval.data)
    )
      return;
    if (cancel && !processing) return;
    busy.current = true;
    setApplying(true);
    const feedback = toast.loading(
      cancel ? "Stopping remaining decisions…" : "Saving batch approval…",
    );
    try {
      const receipt = cancel
        ? await api.cancelFinanceBatchContinuation(id)
        : await (batch.decisions.some((decision) => decision.kind === "transfer_pair")
            ? api.approveFinanceBatchContinuation(id, batch.fingerprint, true)
            : api.approveFinanceBatchContinuation(id, batch.fingerprint));
      if (live()) {
        client.setQueryData(approvalKey, receipt);
        toast.success(
          cancel
            ? "Remaining decisions stopped. Saved changes are kept."
            : "Batch approved. Progress is saved in Finance Chat.",
          { id: feedback },
        );
      } else toast.dismiss(feedback);
    } catch {
      if (live())
        toast.error("Could not confirm the request. Refresh saved progress before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (live()) {
        await Promise.all([query.refetch(), approval.refetch()]);
        setApplying(false);
      }
      busy.current = false;
    }
  }
  const correctionKeys = useRef(new Map<number, string>());
  async function previewUndo(index: number) {
    const live = () => mounted.current && isCurrent();
    if (!batch || busy.current || !live()) return;
    busy.current = true;
    setApplying(true);
    const feedback = toast.loading("Preparing correction…");
    const key = correctionKeys.current.get(index) ?? crypto.randomUUID();
    correctionKeys.current.set(index, key);
    try {
      const correction = await api.previewFinanceReviewBatchUndo({
        batchId: id,
        outcomeIndexes: [index],
        idempotencyKey: key,
      });
      toast.dismiss(feedback);
      if (live()) navigate(`/finances/chat?correction=${encodeURIComponent(correction.id)}`);
    } catch {
      if (live())
        toast.error("Could not prepare this correction. Check the latest saved changes.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
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
                decision.kind === "categorization" ||
                (decision.kind === "review" && decision.action === "recategorize")
                  ? categories.data?.find((category) => category.id === decision.categoryId)
                  : undefined;
              const summary = batch.transactionSummaries?.find((item) => item.index === index);
              const outcome = batch.outcomes.find((item) => item.index === index);
              const counterpart = batch.transferCounterparts?.find((item) => item.index === index);
              return (
                <li key={decision.transactionId} className="grid gap-1 border-t pt-3">
                  <p className="font-medium">{summary?.merchant ?? decision.rationale}</p>
                  {summary ? (
                    <p className="text-sm">
                      {formatReviewedAmount(summary.amountCents, summary.currencyCode)} ·{" "}
                      {summary.date}
                    </p>
                  ) : null}
                  {summary ? <p className="text-sm">{decision.rationale}</p> : null}
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
                      {counterpart.summary
                        ? `${counterpart.summary.merchant} · ${formatReviewedAmount(counterpart.summary.amountCents, counterpart.summary.currencyCode)} · ${counterpart.summary.date}`
                        : "View other transfer leg"}
                    </Link>
                  ) : null}
                  {outcome?.status === "applied" ? (
                    <Button
                      variant="ghost"
                      className="justify-self-start"
                      disabled={applying || query.isFetching || query.isError}
                      onClick={() => void previewUndo(index)}
                    >
                      Review undo for decision {index + 1}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {batch.decisions.some((decision) => decision.kind === "transfer_pair") ? (
            <p>
              Confirm that each pair is the same movement between your own accounts. Both
              transactions will be excluded from income and spending.
            </p>
          ) : null}
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
          {approval.data ? (
            <p>
              {approval.data.state === "pending"
                ? "Approved · waiting to process"
                : approval.data.state === "running"
                  ? "Processing · safe to close this page"
                  : approval.data.state.replaceAll("_", " ")}
            </p>
          ) : null}
          {approval.data?.recovery === "new_preview" ? (
            <p>Ask nohmi for a fresh preview of the remaining decisions.</p>
          ) : null}
          {approval.isError ? (
            <Button variant="outline" onClick={() => void approval.refetch()}>
              Refresh saved approval
            </Button>
          ) : null}
          {batch.pendingCount > 0 &&
          !blocker &&
          !categoryBlocker &&
          !query.isError &&
          !approval.data &&
          !approval.isError ? (
            <Button
              disabled={applying || query.isFetching || approval.isPending}
              onClick={() => void saveApproval()}
            >
              {batch.decisions.some((decision) => decision.kind === "transfer_pair")
                ? "Confirm transfers and approve"
                : "Approve batch"}{" "}
              ({batch.pendingCount})
            </Button>
          ) : null}
          {processing ? (
            <Button variant="outline" disabled={applying} onClick={() => void saveApproval(true)}>
              Stop remaining decisions
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
