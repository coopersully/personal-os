import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Button } from "../../components/detail-content";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

export function CorrectionReference({ id }: { id: string }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const query = useFinanceRead(["batch-correction", id], (api) =>
    api.getFinanceReviewBatchUndo(id),
  );
  const correction = query.data;
  const batchId = correction?.batchId;
  const batch = useFinanceRead(
    ["chat-review-batch", batchId],
    (api) => {
      if (!batchId) throw new Error("Batch unavailable");
      return api.getFinanceReviewBatch(batchId);
    },
    !!batchId,
  );
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function apply() {
    if (
      !correction ||
      !batch.data ||
      !correction.pendingCount ||
      query.isError ||
      batch.isError ||
      busy.current
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
      if (active.current) {
        client.setQueryData(["finances", owner, "batch-correction", id], result);
        if (result.status === "completed" && result.pendingCount === 0)
          toast.success("Reviewed changes undone", { id: feedback });
        else
          toast.info("Some changes could not be undone. Review saved outcomes.", { id: feedback });
      } else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error("Could not confirm the correction. Refresh saved outcomes before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (active.current) {
        await query.refetch();
        setPending(false);
      }
      busy.current = false;
    }
  }
  return (
    <FinanceScreen title="Review correction">
      <ReadState query={query}>
        {correction ? (
          <>
            <Copy>
              Undo only these saved decisions. Later edits are preserved. The original changes stay
              in your history.
            </Copy>
            <ReadState query={batch}>
              <Card rows>
                {correction.outcomeIndexes.map((index) => {
                  const decision = batch.data?.decisions[index];
                  const summary = batch.data?.transactionSummaries?.find(
                    (item) => item.index === index,
                  );
                  const outcome = correction.outcomes.find((item) => item.index === index);
                  return decision ? (
                    <FinanceRow
                      key={index}
                      title={summary?.merchant ?? decision.rationale}
                      icon="receipt"
                      subtitle={[
                        summary
                          ? `${summary.currencyCode ? formatMoney(summary.amountCents / 100, summary.currencyCode) : "Currency unknown"} · ${summary.date}`
                          : undefined,
                        outcome?.error?.message,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      value={outcome ? financeLabel(outcome.status) : "Undo"}
                      onPress={() =>
                        router.push({
                          pathname: "/finance-transaction",
                          params: { id: decision.transactionId },
                        })
                      }
                    />
                  ) : null;
                })}
              </Card>
            </ReadState>
            {correction.pendingCount ? (
              <Button
                disabled={
                  pending || query.isFetching || batch.isFetching || batch.isError || !batch.data
                }
                onPress={() => void apply()}
              >
                Confirm undo ({correction.pendingCount})
              </Button>
            ) : null}
          </>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}
