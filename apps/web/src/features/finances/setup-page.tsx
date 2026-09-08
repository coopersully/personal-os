import type {
  FinanceBudgetVersion,
  FinanceMaintenancePayload,
  FinanceSetupInput,
  FinanceSetupPayload,
  FinanceToolResult,
} from "@personal-os/domain";
import { Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { formatMoney } from "./format.js";
import { requireFinanceResult } from "./position-material.js";

const setupStages: Record<FinanceSetupPayload["stage"], string> = {
  collecting_profile: "Building your financial profile",
  budget_proposal: "Preparing your budget",
  budget_approval: "Budget approval",
  initial_maintenance: "Initial maintenance remains",
  settled: "Setup complete",
};
const maintenanceStages: Record<FinanceMaintenancePayload["stage"], string> = {
  deterministic_processing: "Processing transaction evidence",
  agent_reasoning: "Transaction judgment required",
  reconciliation: "Reconciliation remains",
  agent_audit: "Audit judgment required",
  settled: "Maintenance settled",
  failed: "Maintenance failed",
};

export function FinanceSetupPage() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<FinanceToolResult<FinanceSetupPayload> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const requestKey = useRef({ signature: "", key: "" });
  const session = result?.data;
  const question = session?.question;
  const answerKey = session && question ? `${session.sessionId}:${question.id}` : "";
  const answer = answers[answerKey] ?? "";
  const setup = useMutation({
    mutationFn: (input: FinanceSetupInput) => api.setupFinances(input),
    onError: (error) => {
      if (errorMessage(error).includes("previously failed; use a new idempotency key")) {
        requestKey.current = { signature: "", key: "" };
      }
    },
    onSuccess: (response, input) => {
      if (response.outcome === "failed") {
        requestKey.current = { signature: "", key: "" };
        return;
      }
      setResult(response);
      if (input.operation === "answer")
        setAnswers((current) => ({ ...current, [`${input.sessionId}:${input.questionId}`]: "" }));
      requestKey.current = { signature: "", key: "" };
      void queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
      });
    },
  });
  const budget = useQuery({
    queryKey: ["finance-setup-budget", session?.budgetVersionId],
    queryFn: () => api.getFinanceBudget(),
    enabled: Boolean(session?.budgetVersionId),
  });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.getFinanceCategories(),
    enabled: Boolean(session?.budgetVersionId),
  });
  const plan = budget.data?.data;
  const exactPlan = plan && plan.id === session?.budgetVersionId ? plan : null;
  function mutationKey(input: object) {
    const signature = JSON.stringify(input);
    if (signature !== requestKey.current.signature)
      requestKey.current = { signature, key: crypto.randomUUID() };
    return requestKey.current.key;
  }
  function resume() {
    setup.mutate(
      session ? { operation: "resume", sessionId: session.sessionId } : { operation: "start" },
    );
  }
  function submitAnswer() {
    if (!session || !question || setup.isPending || !answer.trim()) return;
    const input = {
      answer: answer.trim(),
      expectedVersion: session.version,
      operation: "answer" as const,
      questionId: question.id,
      sessionId: session.sessionId,
    };
    setup.mutate({ ...input, idempotencyKey: mutationKey(input) });
  }
  function approve() {
    if (
      !session ||
      !exactPlan ||
      exactPlan.status !== "proposed" ||
      exactPlan.balanceDelta !== 0 ||
      setup.isPending ||
      budget.isFetching ||
      budget.isError
    )
      return;
    const input = {
      approvalSource: "user_instruction" as const,
      budgetVersionId: exactPlan.id,
      expectedVersion: session.version,
      operation: "approve_budget" as const,
      sessionId: session.sessionId,
    };
    setup.mutate({ ...input, idempotencyKey: mutationKey(input) });
  }
  return (
    <section className="grid gap-4" aria-label="Financial setup">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>
              {session
                ? session.stage === "settled" &&
                  (result?.outcome !== "completed" || result.remainingWork.count > 0)
                  ? "Setup progress"
                  : setupStages[session.stage]
                : "A plan grounded in your finances"}
            </h2>
          </CardTitle>
          <CardDescription>
            {result?.communication.headline ??
              "Answer one question at a time, review the complete budget, then approve it. Existing progress will resume."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {setup.error ? (
            <Alert variant="destructive">
              <AlertTitle>Setup change not saved</AlertTitle>
              <AlertDescription>
                {errorMessage(setup.error)} Your input is preserved. Resume saved progress if the
                session has changed.
              </AlertDescription>
            </Alert>
          ) : null}
          {setup.data?.outcome === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Setup could not continue</AlertTitle>
              <AlertDescription>{setup.data.communication.headline}</AlertDescription>
            </Alert>
          ) : null}
          {result?.communication.requiredDisclosures.map((disclosure) => (
            <Alert key={disclosure.message}>
              <AlertDescription>{disclosure.message}</AlertDescription>
            </Alert>
          ))}
          {!session ? (
            <Button className="justify-self-start" disabled={setup.isPending} onClick={resume}>
              {setup.isPending ? "Loading saved progress…" : "Start or resume setup"}
            </Button>
          ) : null}
          {session?.stage === "collecting_profile" && question ? (
            <form
              key={question.id}
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitAnswer();
              }}
            >
              <Field>
                <FieldLabel htmlFor="finance-setup-answer">{question.prompt}</FieldLabel>
                <Input
                  id="finance-setup-answer"
                  autoComplete="off"
                  disabled={setup.isPending}
                  inputMode={
                    question.answerType === "currency"
                      ? "decimal"
                      : question.answerType === "integer"
                        ? "numeric"
                        : "text"
                  }
                  maxLength={10000}
                  value={answer}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [answerKey]: event.target.value }))
                  }
                  required
                />
              </Field>
              <Button
                className="justify-self-start"
                type="submit"
                disabled={setup.isPending || !answer.trim()}
              >
                {setup.isPending ? "Saving answer…" : "Save answer"}
              </Button>
            </form>
          ) : null}
          {session?.budgetVersionId ? (
            <>
              {budget.isPending ? <Spinner label="Loading proposed budget" /> : null}
              {budget.error ? <InlineError error={budget.error} /> : null}
              {categories.error ? <InlineError error={categories.error} /> : null}
              {exactPlan ? (
                <SetupBudget
                  plan={exactPlan}
                  categoryNames={
                    new Map(categories.data?.map((category) => [category.id, category.name]))
                  }
                />
              ) : null}
              {!budget.isPending && !budget.isError && !exactPlan ? (
                <Alert>
                  <AlertTitle>Budget version changed</AlertTitle>
                  <AlertDescription>
                    The current plan does not match this setup proposal. Open Plan to inspect the
                    current version before continuing.
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : null}
          {session?.stage === "budget_approval" ? (
            <div className="grid gap-3">
              {question ? <p className="font-medium">{question.prompt}</p> : null}
              <Button
                className="justify-self-start"
                disabled={
                  setup.isPending ||
                  budget.isFetching ||
                  budget.isError ||
                  !exactPlan ||
                  exactPlan.status !== "proposed" ||
                  exactPlan.balanceDelta !== 0
                }
                onClick={approve}
              >
                {setup.isPending ? "Approving budget…" : "Approve displayed budget"}
              </Button>
            </div>
          ) : null}
          {session?.stage === "initial_maintenance" ? <SetupMaintenance session={session} /> : null}
          {session?.stage === "settled" &&
          (result?.outcome !== "completed" || (result?.remainingWork.count ?? 0) > 0) ? (
            <Alert>
              <AlertTitle>Work remains</AlertTitle>
              <AlertDescription>
                {result?.nextAction?.reason ??
                  "The server reports remaining work. Check saved progress before considering setup complete."}
              </AlertDescription>
            </Alert>
          ) : null}
          {result?.communication.optionalDetails.length ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Setup details
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-2 pt-2">
                {result.communication.optionalDetails.map((detail) => (
                  <p className="text-sm text-muted-foreground" key={detail}>
                    {detail}
                  </p>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {session ? (
            <Button
              className="justify-self-start"
              variant="outline"
              disabled={setup.isPending}
              onClick={resume}
            >
              {setup.isPending ? "Loading saved progress…" : "Resume saved progress"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <nav aria-label="Financial setup resources" className="flex flex-wrap gap-2">
        <Button asChild variant="ghost">
          <Link to="/finances/plan">Open Plan</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/finances/accounts">Manage accounts</Link>
        </Button>
      </nav>
    </section>
  );
}

function SetupBudget({
  plan,
  categoryNames,
}: {
  plan: FinanceBudgetVersion;
  categoryNames: Map<string, string>;
}) {
  return (
    <section className="grid gap-3" aria-label="Setup budget">
      <div className="flex flex-wrap gap-2 items-center">
        <h3 className="font-medium">Budget for {plan.effectiveFrom}</h3>
        <Badge variant="secondary">
          {plan.status} · Version {plan.version}
        </Badge>
      </div>
      <p className="text-sm">{plan.rationale}</p>
      <h4 className="font-medium">Resources · {formatMoney(plan.expectedResources)}</h4>
      <ItemGroup>
        {plan.resources.map((resource) => (
          <Item key={resource.key}>
            <ItemContent>
              <ItemTitle>{resource.description ?? resource.key}</ItemTitle>
              <ItemDescription>{resource.kind.replaceAll("_", " ")}</ItemDescription>
            </ItemContent>
            <span className="tabular-nums">{formatMoney(resource.amount)}</span>
          </Item>
        ))}
      </ItemGroup>
      <h4 className="font-medium">Allocations · {formatMoney(plan.allocatedTotal)}</h4>
      <ItemGroup>
        {plan.allocations.map((allocation) => (
          <Item key={allocation.key}>
            <ItemContent>
              <ItemTitle>
                {allocation.description ??
                  (allocation.kind === "spending" && allocation.categoryId
                    ? categoryNames.get(allocation.categoryId)
                    : undefined) ??
                  allocation.key}
              </ItemTitle>
              <ItemDescription>
                {allocation.kind}
                {allocation.kind === "spending" && allocation.legacyCategory
                  ? ` · ${allocation.legacyCategory}`
                  : ""}
              </ItemDescription>
            </ItemContent>
            <span className="tabular-nums">{formatMoney(allocation.amount)}</span>
          </Item>
        ))}
      </ItemGroup>
      <p className="text-sm">Unallocated: {formatMoney(plan.balanceDelta)}</p>
      <h4 className="font-medium">Assumptions</h4>
      {plan.assumptions.length ? (
        <ul className="list-disc pl-5 text-sm grid gap-2">
          {plan.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No assumptions recorded.</p>
      )}
    </section>
  );
}

function SetupMaintenance({ session }: { session: FinanceSetupPayload }) {
  const queryClient = useQueryClient();
  const [run, setRun] = useState<FinanceMaintenancePayload | null>(null);
  const [communication, setCommunication] = useState<
    FinanceToolResult<FinanceMaintenancePayload>["communication"] | null
  >(null);
  const maintenance = useMutation({
    mutationFn: async () =>
      requireFinanceResult(
        await api.maintainFinances(
          run || session.maintenanceRunId
            ? { operation: "resume", runId: run?.runId ?? session.maintenanceRunId ?? "" }
            : { operation: "start", scope: { type: "all_outstanding" } },
        ),
      ),
    onSuccess: (response) => {
      setRun(response.data);
      setCommunication(response.communication);
      void queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
      });
    },
  });
  return (
    <section className="grid gap-3" aria-label="Initial maintenance">
      <h3 className="font-medium">
        {run ? maintenanceStages[run.stage] : "Maintain transaction evidence"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {communication?.headline ??
          "Your profile and budget are saved. Categorization, reconciliation, and audit still need to run."}
      </p>
      {run?.stage === "agent_reasoning" ? (
        <p className="text-sm">
          {run.reasoningBatch.length} transactions need judgment from a connected Finance agent.
          This page does not supply those judgments.
        </p>
      ) : null}
      {run?.stage === "agent_audit" ? (
        <p className="text-sm">
          The audit needs a connected Finance agent to inspect the evidence and submit findings.
        </p>
      ) : null}
      {run?.reviewQuestion ? (
        <Button asChild variant="outline">
          <Link to="/finances/review">Answer in Review</Link>
        </Button>
      ) : null}
      {communication?.requiredDisclosures.map((disclosure) => (
        <Alert key={disclosure.message}>
          <AlertDescription>{disclosure.message}</AlertDescription>
        </Alert>
      ))}
      {maintenance.error ? <InlineError error={maintenance.error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={maintenance.isPending}
          onClick={() => maintenance.mutate()}
          variant="outline"
        >
          {maintenance.isPending
            ? "Checking maintenance…"
            : run || session.maintenanceRunId
              ? "Check maintenance progress"
              : "Start initial maintenance"}
        </Button>
        {run?.stage === "agent_reasoning" || run?.stage === "agent_audit" ? (
          <Button asChild variant="ghost">
            <Link to="/settings?section=agent-connections">Connected agents</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
