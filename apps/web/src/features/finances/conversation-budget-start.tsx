import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { FinanceSection } from "./finance-section";

export function FinanceConversationBudgetStart({
  id,
  sessionKey,
  isCurrent,
}: {
  id: string;
  sessionKey: string;
  isCurrent: () => boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["finance-budget-start-preview", sessionKey, id],
    queryFn: () => api.getFinanceBudgetStartPreview(id),
    retry: false,
  });
  const preview = query.data;
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function approve() {
    const live = () => mounted.current && isCurrent();
    if (
      !preview?.projectedAttention ||
      query.isError ||
      query.isFetching ||
      busy.current ||
      confirmed ||
      !live()
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
      if (live()) {
        setConfirmed(true);
        toast.success("Starting month confirmed", { id: feedback });
        void client.invalidateQueries({ queryKey: ["finance-review-backlog"] });
        void client.invalidateQueries({ queryKey: ["finance-attention", sessionKey] });
      } else toast.dismiss(feedback);
    } catch {
      if (live())
        toast.error(
          "Could not confirm this preview. Ask nohmi for an updated starting-month proposal.",
          { id: feedback },
        );
      else toast.dismiss(feedback);
    } finally {
      busy.current = false;
      if (live()) setPending(false);
    }
  }
  return (
    <FinanceSection title="Starting month">
      <DataViewRecovery
        query={query}
        title="Could not load starting-month preview"
        unavailableLabel="Preview unavailable"
      />
      {query.isPending ? <DataViewLoading label="Loading starting-month preview" /> : null}
      {preview && !query.isError ? (
        <>
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Maintain from</dt>
              <dd>
                {preview.proposedMonth
                  ? new Date(`${preview.proposedMonth}-01T12:00:00Z`).toLocaleDateString(
                      undefined,
                      { month: "long", year: "numeric", timeZone: "UTC" },
                    )
                  : "All history"}
              </dd>
            </div>
            {preview.projectedAttention ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt>Active decisions</dt>
                  <dd>
                    {preview.attention.activeDecisionCount.toLocaleString()} →{" "}
                    {preview.projectedAttention.activeDecisionCount.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Historical cleanup</dt>
                  <dd>
                    {preview.projectedAttention.historicalRecordCount.toLocaleString()} records
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Starting balances</dt>
                  <dd>
                    {preview.projectedAttention.readiness.openingPositionQualified
                      ? "Verified"
                      : "Needs evidence"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          <p className="text-sm text-muted-foreground">
            Older records stay saved. Anything that affects this month remains active. This does not
            approve a budget or change a transaction.
          </p>
          {preview.projectedAttention ? (
            <Button
              disabled={pending || confirmed || query.isFetching}
              onClick={() => void approve()}
            >
              Confirm starting month
            </Button>
          ) : (
            <p>Ask nohmi for a fresh preview with its impact included.</p>
          )}
        </>
      ) : null}
    </FinanceSection>
  );
}
