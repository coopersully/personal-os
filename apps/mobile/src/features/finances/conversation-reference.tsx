import {
  applyReviewedFinanceBatch,
  financeReviewBatchApprovalBlocker,
} from "@personal-os/api-client";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner-native";
import { Button } from "../../components/detail-content";
import { categoryIcon } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

export function FinanceConversationReference() {
  const { id, kind, versionId } = useLocalSearchParams<{
    id?: string;
    kind?: string;
    versionId?: string;
  }>();
  const { owner } = useFinance();
  if (!id || !owner)
    return (
      <FinanceScreen title="Finance reference">
        <Copy>Reference unavailable.</Copy>
      </FinanceScreen>
    );
  if (kind === "budget_plan" && versionId)
    return <BudgetReference key={`${owner}:${id}:${versionId}`} id={id} versionId={versionId} />;
  if (kind === "review_batch") return <BatchReference key={`${owner}:${id}`} id={id} />;
  if (kind === "review_case" || kind === "contextual_question")
    return <CaseReference key={`${owner}:${id}`} id={id} kind={kind} />;
  return (
    <FinanceScreen title="Finance reference">
      <Copy>Reference unavailable.</Copy>
    </FinanceScreen>
  );
}

function useMountedReference() {
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}

function BudgetReference({ id, versionId }: { id: string; versionId: string }) {
  const { api } = useFinance();
  const query = useFinanceRead(["chat-budget-plan", id], (api) => api.getFinanceBudget(id));
  const currentPlan = query.data?.data;
  const plan = currentPlan?.id === versionId ? currentPlan : null;
  const readiness = query.data?.approvalReadiness;
  const month = plan
    ? new Date(`${plan.effectiveFrom}-01T12:00:00Z`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const categories = useFinanceRead(
    ["categories"],
    (api) => api.getFinanceCategories(),
    !!plan?.allocations.some((item) => item.kind === "spending" && !!item.categoryId),
  );
  const [showAssumptions, setShowAssumptions] = useState(false);
  const active = useMountedReference();
  const approval = useRef<{ version: string; key: string } | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  async function approve() {
    if (!plan || busy.current || query.isError || !readiness?.ready) return;
    if (approval.current?.version !== plan.id)
      approval.current = { version: plan.id, key: randomUUID() };
    busy.current = true;
    setPending(true);
    const feedback = toast.loading("Approving budget…");
    try {
      const result = await api.approveFinanceBudget({
        budgetVersionId: plan.id,
        expectedVersion: plan.version,
        expectedProfileVersionId: plan.profileVersionId ?? null,
        approvalSource: "user_instruction",
        idempotencyKey: approval.current.key,
      });
      if (
        result.data?.status !== "active" ||
        result.data.id !== plan.id ||
        result.data.version !== plan.version
      )
        throw new Error("Approval was not confirmed.");
      if (active.current) toast.success("Budget approved", { id: feedback });
      else toast.dismiss(feedback);
    } catch {
      if (active.current)
        toast.error("Could not confirm approval. Review the current proposal before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (active.current) await query.refetch();
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <FinanceScreen title="Budget proposal">
      <ReadState query={query}>
        {plan ? (
          <>
            <Copy>
              {month} · v{plan.version} · {financeLabel(plan.status)}
            </Copy>
            <Copy>{plan.rationale}</Copy>
            <Section title="Resources">
              <Card rows>
                {plan.resources.map((resource) => (
                  <FinanceRow
                    key={resource.key}
                    title={resource.description ?? financeLabel(resource.kind)}
                    value={formatMoney(resource.amount, null)}
                  />
                ))}
              </Card>
            </Section>
            <Section title="Allocations">
              <Card rows>
                {plan.allocations.map((allocation) => (
                  <FinanceRow
                    key={allocation.key}
                    title={
                      allocation.description ??
                      (allocation.kind === "spending"
                        ? (categories.data?.find((item) => item.id === allocation.categoryId)
                            ?.name ?? allocation.legacyCategory)
                        : undefined) ??
                      financeLabel(allocation.key.replaceAll("-", " "))
                    }
                    icon={
                      allocation.kind === "spending"
                        ? categoryIcon(allocation.legacyCategory ?? allocation.key)
                        : allocation.kind === "goal"
                          ? "target"
                          : "wallet"
                    }
                    value={formatMoney(allocation.amount, null)}
                  />
                ))}
              </Card>
            </Section>
            {plan.assumptions.length ? (
              <Card rows>
                <FinanceRow
                  title={showAssumptions ? "Hide assumptions" : "Review assumptions"}
                  onPress={() => setShowAssumptions(!showAssumptions)}
                />
                {showAssumptions
                  ? [...new Set(plan.assumptions)].map((assumption) => (
                      <Copy key={assumption} secondary>
                        {assumption}
                      </Copy>
                    ))
                  : null}
              </Card>
            ) : null}
            {readiness?.ready && !query.isError && !query.isFetching && !pending ? (
              <Button onPress={() => void approve()}>
                Approve {month} v{plan.version} · {formatMoney(plan.allocatedTotal, null)}
              </Button>
            ) : plan.status === "proposed" && readiness && !readiness.ready ? (
              <Copy>{readiness.message}</Copy>
            ) : null}
            {plan.status === "proposed" ? (
              <FinanceRow title="Ask for changes in Chat" onPress={() => router.back()} />
            ) : null}
          </>
        ) : (
          <Copy>
            {currentPlan
              ? "This chat link points to an earlier budget version. Ask for the current proposal in Chat."
              : "Proposal unavailable."}
          </Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

function BatchReference({ id }: { id: string }) {
  const { api } = useFinance();
  const query = useFinanceRead(["chat-review-batch", id], (api) => api.getFinanceReviewBatch(id));
  const batch = query.data;
  const active = useMountedReference();
  const blocker = batch ? financeReviewBatchApprovalBlocker(batch) : null;
  const cancellation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => () => cancellation.current?.abort(), []);
  async function apply() {
    if (!batch || busy.current || query.isError || blocker || !active.current) return;
    const controller = new AbortController();
    cancellation.current = controller;
    busy.current = true;
    setPending(true);
    const feedback = toast.loading("Applying review decisions…");
    try {
      const result = await applyReviewedFinanceBatch(
        api,
        batch,
        controller.signal,
        () => active.current,
      );
      if (!active.current || result.state === "cancelled") toast.dismiss(feedback);
      else if (result.state === "completed")
        toast.success("Reviewed batch applied", { id: feedback });
      else if (result.state === "needs_review")
        toast.info("Some decisions need review. Check the saved outcomes.", { id: feedback });
      else
        toast.info("Batch paused. Review the saved outcomes before continuing.", { id: feedback });
    } catch {
      if (active.current && !controller.signal.aborted)
        toast.error("Could not confirm progress. Review the saved batch before retrying.", {
          id: feedback,
        });
      else toast.dismiss(feedback);
    } finally {
      if (active.current) await query.refetch();
      busy.current = false;
      cancellation.current = null;
      if (active.current) setPending(false);
    }
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
                const outcome = batch.outcomes.find((item) => item.index === index);
                const counterpart = batch.transferCounterparts?.find(
                  (item) => item.index === index,
                );
                return (
                  <Fragment key={decision.transactionId}>
                    <FinanceRow
                      title={decision.rationale}
                      subtitle={`${decision.evidence}${outcome?.error ? `\n${outcome.error.message}` : ""}`}
                      value={
                        outcome
                          ? financeLabel(outcome.status)
                          : financeLabel(
                              decision.kind === "review" ? decision.action : decision.kind,
                            )
                      }
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
                  </Fragment>
                );
              })}
            </Card>
            {blocker ? <Copy>{blocker}</Copy> : null}
            {batch.pendingCount > 0 &&
            !blocker &&
            !query.isFetching &&
            !query.isError &&
            !pending ? (
              <Button onPress={() => void apply()}>
                Apply reviewed batch ({batch.pendingCount})
              </Button>
            ) : null}
            {pending ? (
              <Button onPress={() => cancellation.current?.abort()}>Stop applying</Button>
            ) : null}
          </>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}

function CaseReference({ id, kind }: { id: string; kind: "review_case" | "contextual_question" }) {
  const query = useFinanceRead(["chat-case", kind, id], async (api) => {
    if (kind === "review_case") {
      const [review] = await api.getFinanceReviewQueue(1, id);
      return review?.id === id
        ? { text: financeLabel(review.reason), transactionId: review.transaction.id }
        : null;
    }
    const question = await api.getFinanceContextualQuestion(id);
    return question.state === "available"
      ? { text: question.question.prompt, transactionId: question.question.transactionId }
      : null;
  });
  return (
    <FinanceScreen title={kind === "review_case" ? "Review case" : "Finance question"}>
      <ReadState query={query}>
        {query.data ? (
          <>
            <Copy>{query.data.text}</Copy>
            {query.data.transactionId ? (
              <FinanceRow
                title="View transaction"
                onPress={() => {
                  const transactionId = query.data?.transactionId;
                  if (transactionId)
                    router.push({
                      pathname: "/finance-transaction",
                      params: { id: transactionId },
                    });
                }}
              />
            ) : null}
          </>
        ) : (
          <Copy>Reference unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}
