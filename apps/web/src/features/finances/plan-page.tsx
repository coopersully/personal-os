import type {
  CreateFinanceBudgetVersionInput,
  FinanceAccount,
  FinanceBudgetAllocation,
  FinanceBudgetBucket,
  FinanceBudgetVersion,
  FinanceCategory,
  FinanceGoal,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarLeading,
} from "@/components/workspace-secondary-app-bar";
import { api, errorMessage } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import { FinanceBudgetBucketManager } from "./bucket-manager.js";
import { formatMoney } from "./format.js";
import { isConfirmedFinanceMutationFailure } from "./mutation-retry.js";
import { FinancePlanEditor } from "./plan-editor.js";
import {
  allocationLabels,
  isFinancePlanConflict,
  requireFinancePlanResult,
  resourceLabels,
} from "./plan-helpers.js";

type Relations = {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  goals: FinanceGoal[];
  buckets: FinanceBudgetBucket[];
};

function AllocationRelation({
  allocation,
  relations,
}: {
  allocation: FinanceBudgetAllocation;
  relations: Relations;
}) {
  if (allocation.kind === "spending") {
    const category = relations.categories.find((item) => item.id === allocation.categoryId);
    const bucket = relations.buckets.find(
      (item) => allocation.categoryId && item.categories.includes(allocation.categoryId),
    );
    return (
      <>
        <span>
          {category?.name ??
            allocation.legacyCategory ??
            (allocation.categoryId ? "Category unavailable" : "No category linked")}
        </span>
        {allocation.legacyCategory && category?.name !== allocation.legacyCategory ? (
          <span className="block text-xs text-muted-foreground">
            Category label · {allocation.legacyCategory}
          </span>
        ) : null}
        {bucket ? (
          <span className="block text-xs text-muted-foreground">Bucket · {bucket.name}</span>
        ) : null}
      </>
    );
  }
  if (allocation.kind === "debt")
    return (
      <Link className="underline underline-offset-4" to="/finances/accounts">
        {relations.accounts.find((item) => item.id === allocation.accountId)?.name ??
          "Account unavailable"}
      </Link>
    );
  if ((allocation.kind === "goal" || allocation.kind === "savings") && allocation.goalId)
    return (
      <Link className="underline underline-offset-4" to="/finances/wealth">
        {relations.goals.find((item) => item.id === allocation.goalId)?.name ?? "Goal unavailable"}
      </Link>
    );
  return <span className="text-muted-foreground">No linked record</span>;
}

function PlanDetails({ plan, relations }: { plan: FinanceBudgetVersion; relations: Relations }) {
  return (
    <div className="grid min-w-0 gap-7">
      <section aria-label="Plan resources" className="grid min-w-0 gap-3">
        <h2 className="text-base font-medium">Resources</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resource</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Planned amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.resources.map((resource) => (
              <TableRow key={resource.key}>
                <TableCell className="min-w-40 whitespace-normal">
                  <span className="font-medium">{resource.key}</span>
                  <span className="block text-xs text-muted-foreground">
                    {resourceLabels[resource.kind]}
                  </span>
                  {resource.description ? (
                    <span className="block text-sm text-muted-foreground">
                      {resource.description}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  {resource.sourceId ? (
                    <span>
                      {relations.accounts.find((account) => account.id === resource.sourceId)
                        ?.name ?? "Saved source"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No linked source</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(resource.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section aria-label="Plan allocations" className="grid min-w-0 gap-3">
        <h2 className="text-base font-medium">Allocations</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Allocation</TableHead>
              <TableHead>Linked record</TableHead>
              <TableHead className="text-right">Planned amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.allocations.map((allocation) => (
              <TableRow key={allocation.key}>
                <TableCell className="min-w-40 whitespace-normal">
                  <span className="font-medium">{allocation.key}</span>
                  <span className="block text-xs text-muted-foreground">
                    {allocationLabels[allocation.kind]}
                  </span>
                  {allocation.description ? (
                    <span className="block text-sm text-muted-foreground">
                      {allocation.description}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  <AllocationRelation allocation={allocation} relations={relations} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(allocation.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section aria-label="Plan reasoning" className="grid gap-3">
        <h2 className="text-base font-medium">Rationale</h2>
        <p className="whitespace-pre-wrap text-sm">{plan.rationale}</p>
        <h3 className="font-medium">Assumptions</h3>
        {plan.assumptions.length ? (
          <ul className="grid list-disc gap-2 pl-5 text-sm">
            {plan.assumptions.map((assumption) => (
              <li className="whitespace-pre-wrap" key={assumption}>
                {assumption}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No assumptions recorded.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Created {new Date(plan.createdAt).toLocaleString()}
          {plan.approvedAt ? ` · Approved ${new Date(plan.approvedAt).toLocaleString()}` : ""}
        </p>
      </section>
    </div>
  );
}

export function FinancePlanPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ plan: FinanceBudgetVersion | null } | null>(null);
  const approvalKeys = useRef(new Map<string, string>());
  const planQuery = useQuery({
    queryKey: ["finance-plan"],
    queryFn: async () => requireFinancePlanResult(await api.getFinanceBudget()),
  });
  const statusQuery = useQuery({
    queryKey: ["finance-canonical-budget-status"],
    queryFn: async () => requireFinancePlanResult(await api.getCanonicalFinanceBudgetStatus()),
  });
  const categoryQuery = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.getFinanceCategories(),
  });
  const accountQuery = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
  });
  const goalQuery = useQuery({
    queryKey: ["finance-goals"],
    queryFn: async () => requireFinancePlanResult(await api.listFinanceGoals()),
  });
  const plan = planQuery.data?.data;
  const month = plan?.effectiveFrom ?? new Date().toISOString().slice(0, 7);
  const bucketQuery = useQuery({
    queryKey: ["finance-budget-buckets", month],
    queryFn: () => api.listFinanceBudgetBuckets(month),
  });
  const relations: Relations = {
    accounts: accountQuery.data?.accounts ?? [],
    categories: categoryQuery.data ?? [],
    goals: goalQuery.data?.data ?? [],
    buckets: bucketQuery.data?.taxonomy?.buckets ?? [],
  };
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
    });
  const save = useMutation({
    mutationFn: async (input: CreateFinanceBudgetVersionInput) => {
      const result = editing?.plan
        ? await api.reviseFinanceBudget({
            ...input,
            expectedVersion: editing.plan.version,
            planId: editing.plan.planId,
          })
        : await api.createFinanceBudget(input);
      return requireFinancePlanResult(result);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["finance-plan"], result);
      setEditing(null);
      await refresh();
    },
  });
  const approve = useMutation({
    mutationFn: async (displayed: FinanceBudgetVersion) => {
      const identity = `${displayed.id}:${displayed.version}`;
      let key = approvalKeys.current.get(identity);
      if (!key) {
        key = crypto.randomUUID();
        approvalKeys.current.set(identity, key);
      }
      return requireFinancePlanResult(
        await api.approveFinanceBudget({
          budgetVersionId: displayed.id,
          expectedVersion: displayed.version,
          approvalSource: "user_instruction",
          idempotencyKey: key,
        }),
      );
    },
    onError: (error, displayed) => {
      if (isConfirmedFinanceMutationFailure(error))
        approvalKeys.current.delete(`${displayed.id}:${displayed.version}`);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["finance-plan"], result);
      queryClient.setQueryData(["finance-canonical-budget-status"], result);
      await refresh();
    },
  });
  const active = statusQuery.data?.data;
  const distinctActive = active?.status === "active" && active.id !== plan?.id;
  const loaded = !planQuery.isPending && !planQuery.isError;
  function openEditor() {
    approve.reset();
    save.reset();
    setEditing({ plan: plan ?? null });
  }
  function reload() {
    approve.reset();
    save.reset();
    setEditing(null);
    void refresh();
  }

  return (
    <>
      <WorkspaceSecondaryAppBar aria-label="Plan controls">
        <WorkspaceSecondaryAppBarLeading>
          <Button asChild size="sm" variant="ghost">
            <Link to="/finances/setup">Financial setup</Link>
          </Button>
        </WorkspaceSecondaryAppBarLeading>
        <WorkspaceSecondaryAppBarActions>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost">
                Budget buckets
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Organize budget categories</DialogTitle>
                <DialogDescription>
                  Group transaction categories into planning buckets.
                </DialogDescription>
              </DialogHeader>
              {categoryQuery.isError ? (
                <InlineError error={categoryQuery.error} />
              ) : (
                <FinanceBudgetBucketManager categories={relations.categories} month={month} />
              )}
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            variant="ghost"
            disabled={planQuery.isFetching || approve.isPending || save.isPending}
            onClick={reload}
          >
            Refresh
          </Button>
          {plan && loaded ? (
            <Button size="sm" variant="outline" disabled={approve.isPending} onClick={openEditor}>
              Revise plan
            </Button>
          ) : null}
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <div className="grid min-w-0 gap-7">
        {planQuery.isPending ? <PageLoading workspace="finances" /> : null}
        {planQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{plan ? "Saved plan may be out of date" : "Plan unavailable"}</AlertTitle>
            <AlertDescription>
              {errorMessage(planQuery.error)}
              <Button variant="outline" onClick={reload}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {loaded && !plan ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No complete plan yet</EmptyTitle>
              <EmptyDescription>
                Allocate income and other resources across spending, savings, debt, goals, and a
                buffer.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openEditor}>Create plan</Button>
              <Button asChild variant="ghost">
                <Link to="/finances/setup">Continue financial setup</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {plan ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Version {plan.version}</CardTitle>
                  <Badge variant={plan.status === "active" ? "default" : "secondary"}>
                    {plan.status === "proposed"
                      ? "Proposed"
                      : plan.status === "active"
                        ? "Active"
                        : plan.status === "retired"
                          ? "Retired"
                          : "Incomplete"}
                  </Badge>
                </div>
                <CardDescription>
                  Effective {plan.effectiveFrom} · Complete monthly allocation
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <dl className="grid gap-4 sm:grid-cols-3">
                  {[
                    ["Expected resources", plan.expectedResources],
                    ["Allocated", plan.allocatedTotal],
                    ["Unassigned", plan.balanceDelta],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="text-xl font-medium tabular-nums">
                        {typeof value === "number" ? formatMoney(value) : "Unavailable"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted-foreground">
                  These are planned amounts. Review actual spending in Transactions.
                </p>
                {planQuery.data?.communication.requiredDisclosures.map((disclosure) => (
                  <p className="text-sm" key={disclosure.message}>
                    {disclosure.message}
                  </p>
                ))}
                {plan.status === "proposed" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={
                        approve.isPending ||
                        !loaded ||
                        plan.balanceDelta !== 0 ||
                        isFinancePlanConflict(approve.error)
                      }
                      onClick={() => approve.mutate(plan)}
                    >
                      {approve.isPending ? "Approving…" : `Approve version ${plan.version}`}
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Activates this exact proposal for {plan.effectiveFrom}.
                    </p>
                  </div>
                ) : null}
                {approve.error ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      {isFinancePlanConflict(approve.error)
                        ? "The plan changed before approval"
                        : "Approval did not complete"}
                    </AlertTitle>
                    <AlertDescription>
                      {errorMessage(approve.error)}
                      {isFinancePlanConflict(approve.error) ? (
                        <Button variant="outline" onClick={reload}>
                          Reload latest plan
                        </Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {approve.isSuccess ? (
                  <p role="status" className="text-sm">
                    Version {approve.data.data.version} approved.
                  </p>
                ) : null}
              </CardContent>
            </Card>
            {statusQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Checking active plan…</p>
            ) : statusQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Active plan status unavailable</AlertTitle>
                <AlertDescription>{errorMessage(statusQuery.error)}</AlertDescription>
              </Alert>
            ) : !active ? (
              <p className="text-sm text-muted-foreground">No approved plan is active yet.</p>
            ) : null}
            {[categoryQuery, accountQuery, goalQuery, bucketQuery].some(
              (query) => query.isError,
            ) ? (
              <Alert>
                <AlertTitle>Some linked records are unavailable</AlertTitle>
                <AlertDescription>
                  Saved identities and amounts remain visible. Refresh to reload category, account,
                  goal, or bucket names.
                </AlertDescription>
              </Alert>
            ) : null}
            <PlanDetails plan={plan} relations={relations} />
          </>
        ) : null}
        {distinctActive && active ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline">
                View active version {active.version} · {active.effectiveFrom}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-5">
              <p className="mb-5 text-sm">
                Active plan · Expected resources {formatMoney(active.expectedResources)} · Allocated{" "}
                {formatMoney(active.allocatedTotal)}
              </p>
              <PlanDetails plan={active} relations={relations} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
      {editing ? (
        <FinancePlanEditor
          plan={editing.plan}
          accounts={relations.accounts}
          categories={relations.categories}
          goals={relations.goals}
          error={save.error}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate(input)}
          onReload={reload}
        />
      ) : null}
    </>
  );
}
