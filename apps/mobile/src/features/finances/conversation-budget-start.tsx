import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Button } from "../../components/detail-content";
import { useFinance, useFinanceRead } from "./data";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

export function BudgetStartReference({ id }: { id: string }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const query = useFinanceRead(["budget-start-preview", id], (api) =>
    api.getFinanceBudgetStartPreview(id),
  );
  const preview = query.data;
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const active = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function approve() {
    if (
      !preview?.projectedAttention ||
      query.isError ||
      query.isFetching ||
      busy.current ||
      confirmed
    )
      return;
    busy.current = true;
    setPending(true);
    const feedback = toast.loading("Confirming starting month…");
    try {
      const policy = await api.applyFinanceBudgetStart({
        previewId: preview.id,
        fingerprint: preview.fingerprint,
      });
      if (
        policy.firstMonth !== preview.proposedMonth ||
        policy.revision !== preview.expectedPolicyRevision + 1
      )
        throw new Error("Policy not confirmed");
      if (active.current) {
        setConfirmed(true);
        toast.success("Starting month confirmed", { id: feedback });
        void client.invalidateQueries({ queryKey: ["finances", owner] });
      } else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error(
          "Could not confirm this preview. Ask nohmi for an updated starting-month proposal.",
          { id: feedback },
        );
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <FinanceScreen title="Starting month">
      <ReadState query={query}>
        {preview ? (
          <>
            <Card rows>
              <FinanceRow
                title="Maintain from"
                icon="calendar"
                value={
                  preview.proposedMonth
                    ? new Date(`${preview.proposedMonth}-01T12:00:00Z`).toLocaleDateString(
                        undefined,
                        { month: "long", year: "numeric", timeZone: "UTC" },
                      )
                    : "All history"
                }
              />
              {preview.projectedAttention ? (
                <>
                  <FinanceRow
                    title="Active decisions"
                    icon="categoryTags"
                    value={`${preview.attention.activeDecisionCount} → ${preview.projectedAttention.activeDecisionCount}`}
                  />
                  <FinanceRow
                    title="Historical cleanup"
                    icon="history"
                    value={`${preview.projectedAttention.historicalRecordCount.toLocaleString()} records`}
                  />
                  <FinanceRow
                    title="Starting balances"
                    icon="wallet"
                    value={
                      preview.projectedAttention.readiness.openingPositionQualified
                        ? "Verified"
                        : "Needs evidence"
                    }
                    valueTone={
                      preview.projectedAttention.readiness.openingPositionQualified
                        ? undefined
                        : "attention"
                    }
                  />
                </>
              ) : null}
            </Card>
            <Copy>
              Older records stay saved. Anything that affects this month remains active. This does
              not approve a budget or change a transaction.
            </Copy>
            {preview.projectedAttention ? (
              <Button
                disabled={pending || confirmed || query.isFetching || query.isError}
                onPress={() => void approve()}
              >
                Confirm starting month
              </Button>
            ) : (
              <Copy>Ask nohmi for a fresh preview with its impact included.</Copy>
            )}
          </>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}
