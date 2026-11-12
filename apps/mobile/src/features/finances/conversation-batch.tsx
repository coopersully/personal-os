import { financeReviewBatchApprovalBlocker } from "@personal-os/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Button } from "../../components/detail-content";
import { categoryIcon } from "./category-presentation";
import { useFinance, useFinancePoll, useFinanceRead } from "./data";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

export function BatchReference({ id }: { id: string }) {
  const { api } = useFinance();
  const query = useFinanceRead(["chat-review-batch", id], (api) => api.getFinanceReviewBatch(id));
  const client = useQueryClient();
  const { owner } = useFinance();
  const approval = useFinanceRead(["batch-continuation", id], (api) =>
    api.getFinanceBatchContinuation(id),
  );
  const processing = approval.data?.state === "pending" || approval.data?.state === "running";
  useFinancePoll(processing, [approval.refetch, query.refetch]);
  const approvalState = approval.data?.state;
  const refreshBatch = query.refetch;
  useEffect(() => {
    if (approvalState) void refreshBatch();
  }, [approvalState, refreshBatch]);
  const batch = query.data;
  const needsCategories = !!batch?.decisions.some(
    (item) =>
      item.kind === "categorization" || (item.kind === "review" && item.action === "recategorize"),
  );
  const categories = useFinanceRead(
    ["categories"],
    (api) => api.getFinanceCategories(),
    needsCategories,
  );
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
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const blocker = batch ? financeReviewBatchApprovalBlocker(batch) : null;
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  async function saveApproval(cancel = false) {
    if (!batch || busy.current || !active.current) return;
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
    setPending(true);
    const feedback = toast.loading(
      cancel ? "Stopping remaining decisions…" : "Saving batch approval…",
    );
    try {
      const receipt = cancel
        ? await api.cancelFinanceBatchContinuation(id)
        : await api.approveFinanceBatchContinuation(id, batch.fingerprint);
      if (active.current) {
        client.setQueryData(["finances", owner, "batch-continuation", id], receipt);
        toast.success(
          cancel
            ? "Remaining decisions stopped. Saved changes are kept."
            : "Batch approved. Progress is saved in Finance Chat.",
          { id: feedback },
        );
      } else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error("Could not confirm the request. Refresh saved progress before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (active.current) {
        await Promise.all([query.refetch(), approval.refetch()]);
        setPending(false);
      }
      busy.current = false;
    }
  }
  const correctionKeys = useRef(new Map<number, string>());
  async function previewUndo(index: number) {
    if (!batch || busy.current || !active.current) return;
    busy.current = true;
    setPending(true);
    const feedback = toast.loading("Preparing correction…");
    const key = correctionKeys.current.get(index) ?? randomUUID();
    correctionKeys.current.set(index, key);
    try {
      const correction = await api.previewFinanceReviewBatchUndo({
        batchId: id,
        outcomeIndexes: [index],
        idempotencyKey: key,
      });
      if (active.current) {
        toast.dismiss(feedback);
        router.push({
          pathname: "/finance-chat-reference",
          params: { kind: "review_batch_undo", id: correction.id },
        });
      } else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error("Could not prepare this correction. Check the latest saved changes.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  async function refreshCategories() {
    const feedback = toast.loading("Refreshing target categories…");
    const result = await categories.refetch();
    if (!active.current) toast.dismiss(feedback);
    else if (result.isError) toast.error("Could not refresh target categories.", { id: feedback });
    else toast.success("Target categories refreshed", { id: feedback });
  }
  return (
    <FinanceScreen title="Grouped reviews">
      <ReadState query={query}>
        {batch ? (
          <>
            <Copy>
              {batch.pendingCount} pending ·{" "}
              {batch.outcomes.filter((item) => item.status === "applied").length} applied
            </Copy>
            <Card rows>
              {batch.decisions.map((decision, index) => {
                const target =
                  decision.kind === "categorization" ||
                  (decision.kind === "review" && decision.action === "recategorize")
                    ? categories.data?.find((category) => category.id === decision.categoryId)
                    : undefined;
                const summary = batch.transactionSummaries?.find((item) => item.index === index);
                const outcome = batch.outcomes.find((item) => item.index === index);
                const counterpart = batch.transferCounterparts?.find(
                  (item) => item.index === index,
                );
                return (
                  <Fragment key={decision.transactionId}>
                    <FinanceRow
                      title={
                        summary?.merchant ??
                        financeLabel(decision.kind === "review" ? decision.action : decision.kind)
                      }
                      icon={target ? categoryIcon(target.name) : "receipt"}
                      subtitle={[
                        ...new Set(
                          [
                            summary
                              ? `${summary.currencyCode ? formatMoney(summary.amountCents / 100, summary.currencyCode) : "Currency unknown"} · ${summary.date}`
                              : undefined,
                            target ? `Category: ${target.name}` : undefined,
                            decision.rationale,
                            decision.evidence,
                            outcome?.error?.message,
                          ]
                            .map((text) => text?.trim())
                            .filter(Boolean),
                        ),
                      ].join("\n")}
                      value={outcome ? financeLabel(outcome.status) : undefined}
                      onPress={() =>
                        router.push({
                          pathname: "/finance-transaction",
                          params: { id: decision.transactionId },
                        })
                      }
                    />
                    {counterpart ? (
                      <FinanceRow
                        title="View other transfer leg"
                        onPress={() =>
                          router.push({
                            pathname: "/finance-transaction",
                            params: { id: counterpart.transactionId },
                          })
                        }
                      />
                    ) : null}
                    {outcome?.status === "applied" ? (
                      <FinanceRow
                        title={`Review undo for decision ${index + 1}`}
                        icon="history"
                        onPress={
                          pending || query.isFetching || query.isError
                            ? undefined
                            : () => void previewUndo(index)
                        }
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </Card>
            {blocker ? <Copy>{blocker}</Copy> : null}
            {categoryBlocker ? (
              <FinanceRow
                title="Refresh target categories"
                subtitle="Confirm each target category before applying."
                onPress={categories.isFetching ? undefined : () => void refreshCategories()}
              />
            ) : null}
            {approval.data ? (
              <Copy>
                {approval.data.state === "pending"
                  ? "Approved · waiting to process"
                  : approval.data.state === "running"
                    ? "Processing · safe to close this page"
                    : financeLabel(approval.data.state)}
              </Copy>
            ) : null}
            {approval.data?.recovery === "new_preview" ? (
              <Copy>Ask nohmi for a fresh preview of the remaining decisions.</Copy>
            ) : null}
            {approval.isError ? (
              <Button onPress={() => void approval.refetch()}>Refresh saved approval</Button>
            ) : null}
            {batch.pendingCount > 0 &&
            !blocker &&
            !categoryBlocker &&
            !query.isFetching &&
            !query.isError &&
            !pending &&
            !approval.isPending &&
            !approval.isError &&
            !approval.data ? (
              <Button onPress={() => void saveApproval()}>
                Approve batch ({batch.pendingCount})
              </Button>
            ) : null}
            {processing ? (
              <Button disabled={pending} onPress={() => void saveApproval(true)}>
                Stop remaining decisions
              </Button>
            ) : null}
          </>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}
