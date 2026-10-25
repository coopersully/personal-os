import type {
  CreateFinanceBudgetVersionInput,
  FinanceAccount,
  FinanceBudgetAllocation,
  FinanceBudgetBucket,
  FinanceBudgetVersion,
  FinanceCategory,
  FinanceGoal,
} from "@personal-os/domain";
import {
  financeBudgetApprovalReadinessSchema,
  financeConfigurationCapabilities,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ActionButton as Button } from "@/components/action-button";
import { QueryFeedback } from "@/components/async-state";
import { EditIcon, SettingsIcon } from "@/components/icons";
import { RecoveryRequest } from "@/components/recovery-request";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { PageLoading } from "../../components/async-state.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceBudgetBucketManager } from "./bucket-manager.js";
import {
  BudgetApprovalReadiness,
  isBudgetApprovalConflict,
  useBudgetApproval,
} from "./budget-approval.js";
import { FinanceDisclosure } from "./disclosure";
import { FinanceSection } from "./finance-section";
import { formatMoney } from "./format.js";
import { isConfirmedFinanceMutationFailure } from "./mutation-retry.js";
import { FinancePlanEditor } from "./plan-editor.js";
import { allocationLabels, requireFinancePlanResult, resourceLabels } from "./plan-helpers.js";
import { FinancePrerequisiteScreen } from "./prerequisite-screen.js";

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
      <FinanceSection title="Resources" label="Plan resources">
        <Card>
          <CardContent>
            {plan.resources.length ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">
                No resources recorded. Add income or other available funds in your financial
                profile.
              </p>
            )}
          </CardContent>
        </Card>
      </FinanceSection>
      <FinanceSection title="Allocations" label="Plan allocations">
        <Card>
          <CardContent>
            {plan.allocations.length ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing allocated yet. Add expenses and priorities in your financial profile, then
                revise this budget.
              </p>
            )}
          </CardContent>
        </Card>
      </FinanceSection>
      <section aria-label="Plan reasoning" className="flex flex-col gap-2">
        <FinanceDisclosure title={`${plan.assumptions.length} assumptions · Show details`}>
          {plan.assumptions.length ? (
            <ul className="flex flex-col gap-2">
              {plan.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          ) : (
            <p>No assumptions recorded.</p>
          )}
        </FinanceDisclosure>
        <FinanceDisclosure title="Why this budget?">
          <p className="whitespace-pre-wrap">{plan.rationale}</p>
          <p className="text-xs text-muted-foreground">
            Created {new Date(plan.createdAt).toLocaleString()}
            {plan.approvedAt ? ` · Approved ${new Date(plan.approvedAt).toLocaleString()}` : ""}
          </p>
        </FinanceDisclosure>
      </section>
    </div>
  );
}

export function FinancePlanPage({ approvalTask = false }: { approvalTask?: boolean }) {
  const [params] = useSearchParams();
  const requestedPlanId = params.get("planId");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ plan: FinanceBudgetVersion | null } | null>(null);
  const [approvalNeedsRefresh, setApprovalNeedsRefresh] = useState(false);
  const approvalKeys = useRef(new Map<string, string>());
  const planQuery = useQuery({
    queryKey: ["finance-plan", requestedPlanId],
    queryFn: async () => {
      const result = await (requestedPlanId
        ? api.getFinanceBudget(requestedPlanId)
        : api.getFinanceBudget());
      requireFinancePlanResult(result);
      const readiness = financeBudgetApprovalReadinessSchema.safeParse(
        "approvalReadiness" in result ? result.approvalReadiness : undefined,
      );
      return { ...result, approvalReadiness: readiness.success ? readiness.data : undefined };
    },
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
  const save = useFeedbackMutation({
    feedback: { action: "save this financial plan", safeToRetry: false, form: true },
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
      toast.success(`Version ${result.data.version} saved.`);
      queryClient.setQueryData(["finance-plan", requestedPlanId], result);
      setEditing(null);
      await refresh();
    },
  });
  const approve = useBudgetApproval({
    refresh: refreshApproval,
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
          expectedProfileVersionId: displayed.profileVersionId ?? null,
          approvalSource: "user_instruction",
          idempotencyKey: key,
        }),
      );
    },
    onError: (error, displayed) => {
      if (isBudgetApprovalConflict(error)) setApprovalNeedsRefresh(true);
      if (isConfirmedFinanceMutationFailure(error))
        approvalKeys.current.delete(`${displayed.id}:${displayed.version}`);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["finance-plan", requestedPlanId], result);
      queryClient.setQueryData(["finance-canonical-budget-status"], result);
      await refresh();
    },
  });
  const active = statusQuery.data?.data;
  const distinctActive = active?.status === "active" && active.id !== plan?.id;
  const loaded = !planQuery.isPending && !planQuery.isError;
  function openEditor() {
    if (approvalTask) return;
    approve.reset();
    save.reset();
    setEditing({ plan: plan ?? null });
  }

  async function refreshApproval() {
    const notification = toast.loading("Refreshing plan…");
    const refreshed = await planQuery.refetch();
    if (refreshed.isError) {
      toast.error(
        "Could not refresh the plan. Your local decisions are preserved. Try refreshing again.",
        { id: notification },
      );
      return;
    }
    approve.reset();
    setApprovalNeedsRefresh(false);
    toast.success("Plan refreshed. Review readiness before approving.", { id: notification });
  }

  function reload() {
    approve.reset();
    save.reset();
    setEditing(null);
    void refresh();
  }

  return (
    <>
      <WorkspaceHeaderControls label="Plan controls">
        {!approvalTask && plan && loaded ? (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={approve.isPending}
            onClick={openEditor}
            aria-label="Revise plan"
            title="Revise plan"
          >
            <EditIcon />
          </Button>
        ) : null}
      </WorkspaceHeaderControls>
      <div className="grid min-w-0 gap-7">
        {!approvalTask ? (
          <WorkspaceHeaderControls label="Budget controls">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Budget buckets"
                      title="Budget buckets"
                    >
                      <SettingsIcon />
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-finance-dialog data-finance-size="wide">
                    <DialogHeader>
                      <DialogTitle>Organize budget categories</DialogTitle>
                      <DialogDescription>
                        Group transaction categories into planning buckets.
                      </DialogDescription>
                    </DialogHeader>
                    <ResponsiveDialogBody>
                      {categoryQuery.isError ? (
                        <Button variant="secondary" onClick={() => void categoryQuery.refetch()}>
                          Retry categories
                        </Button>
                      ) : (
                        <FinanceBudgetBucketManager
                          categories={relations.categories}
                          month={month}
                        />
                      )}
                    </ResponsiveDialogBody>
                  </DialogContent>
                </Dialog>
              </div>
              {bucketQuery.isPending ? (
                <p role="status">Loading buckets…</p>
              ) : bucketQuery.isSuccess && !relations.buckets.length ? (
                <p className="text-sm text-muted-foreground">No budget buckets yet.</p>
              ) : null}
            </div>
          </WorkspaceHeaderControls>
        ) : null}
        {planQuery.isPending ? <PageLoading workspace="finances" /> : null}
        <QueryFeedback query={planQuery} title="Couldn’t load the plan." />
        <QueryFeedback query={categoryQuery} title="Couldn’t load categories." />
        <QueryFeedback query={accountQuery} title="Couldn’t load accounts." />
        <QueryFeedback query={goalQuery} title="Couldn’t load goals." />
        <QueryFeedback query={bucketQuery} title="Couldn’t load buckets." />
        {loaded && !plan && approvalTask ? (
          <p>No budget proposal is available to approve.</p>
        ) : null}
        {loaded && !plan && !approvalTask ? (
          <FinancePrerequisiteScreen
            title="Set up your budget"
            readiness={financeConfigurationCapabilities({ state: "loaded", value: null }).budget}
            returnTo="/finances/plan"
            retry={reload}
          />
        ) : null}
        {plan ? (
          <>
            <FinanceSection
              title="Monthly budget"
              description={<>Effective {plan.effectiveFrom} · Monthly budget</>}
              action={
                <div className="flex items-center gap-2">
                  {" "}
                  <span className="text-xs text-muted-foreground">Version {plan.version}</span>
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
              }
            >
              <Card>
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
                          {typeof value === "number"
                            ? !plan.resources.length &&
                              label !== "Allocated" &&
                              plan.status !== "active"
                              ? "Not provided"
                              : formatMoney(value)
                            : "Unavailable"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {plan.expectedResources > 0 ? (
                    <div className="grid gap-2">
                      <Progress
                        aria-label="Budget allocated"
                        value={Math.min(
                          100,
                          Math.max(0, (plan.allocatedTotal / plan.expectedResources) * 100),
                        )}
                      />
                      <p className="text-sm text-muted-foreground">
                        {Math.round((plan.allocatedTotal / plan.expectedResources) * 100)}%
                        allocated
                        {plan.balanceDelta < 0 ? " · Over budget" : ""}
                      </p>
                    </div>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    These are planned amounts. Review actual spending in Transactions.
                  </p>
                  {plan.status !== "active" &&
                  plan.status !== "proposed" &&
                  plan.status !== "retired" ? (
                    <Alert variant="warning">
                      <AlertTitle>Complete your financial profile</AlertTitle>
                      <AlertDescription>
                        This budget is incomplete. Missing information is not a confirmed zero.
                        <Button asChild variant="outline">
                          <Link to="/finances/setup">Update financial profile</Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {plan.status === "proposed" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        disabled={
                          approve.isPending ||
                          !loaded ||
                          planQuery.isFetching ||
                          !planQuery.data?.approvalReadiness?.ready ||
                          approvalNeedsRefresh
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
                  <BudgetApprovalReadiness
                    readiness={planQuery.data?.approvalReadiness}
                    revisionHref={`/finances/plan?planId=${encodeURIComponent(plan.planId)}`}
                    onRevise={approvalTask ? undefined : openEditor}
                    onRefresh={() => void refreshApproval()}
                  />
                  <RecoveryRequest
                    toastId={approve.feedback?.toastId}
                    open={approve.isError}
                    title="Approval needs review"
                    description={
                      approve.feedback?.message ?? "Check the latest plan before trying again."
                    }
                    actions={
                      <>
                        <Button variant="secondary" onClick={() => approve.reset()}>
                          Return to plan
                        </Button>
                        <Button onClick={() => void refreshApproval()}>Refresh plan</Button>
                      </>
                    }
                  />
                  {approve.error || approvalNeedsRefresh ? (
                    <Button variant="outline" onClick={() => void refreshApproval()}>
                      Refresh plan
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </FinanceSection>
            {statusQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Checking active plan…</p>
            ) : statusQuery.isError ? (
              <QueryFeedback query={statusQuery} title="Couldn’t load active plan status." />
            ) : !active ? (
              <p className="text-sm text-muted-foreground">No approved plan is active yet.</p>
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
      {!approvalTask && editing ? (
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
