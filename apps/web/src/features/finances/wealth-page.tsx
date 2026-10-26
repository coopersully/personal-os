import { ApiClientError } from "@personal-os/api-client";
import {
  type FinanceGoal,
  localDateAt,
  localDateToIso,
  type ManageFinanceGoalInput,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActionButton as Button } from "@/components/action-button";
import { CurrencyInput } from "@/components/currency-input";
import {
  BankIcon,
  DollarIcon,
  EditIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/icons";
import { KeyMetric, KeyMetrics } from "@/components/key-metrics";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/settings-field";
import { SettingsSelect } from "@/components/settings-select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceSection } from "./finance-section";
import { formatCompactMoney } from "./format";
import {
  GoalProgressConfirmation,
  goalProgressApplicability,
} from "./goal-progress-confirmation.js";
import { FinanceGoalScenarioExplorer } from "./goal-scenario-explorer.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import {
  FinancePositionMaterial,
  FinanceSourceState,
  financeAmount,
  refreshFinancePosition,
  requireFinanceResult,
} from "./position-material.js";

type GoalOperation = "pause" | "resume" | "complete" | "remove";

export function FinanceWealthPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  let todayLocalDate: string | null = null;
  if (me.data?.planningTimezone) {
    try {
      todayLocalDate = localDateToIso(localDateAt(new Date(), me.data.planningTimezone));
    } catch {
      /* An unknown planning timezone cannot authorize a confirmation date. */
    }
  }
  const [progressGoal, setProgressGoal] = useState<FinanceGoal | null>(null);
  const [exploreGoalId, setExploreGoalId] = useState<string | null>(null);
  const snapshot = useQuery({
    queryKey: ["finance-snapshot"],
    queryFn: async () => requireFinanceResult(await api.getFinanceSnapshot()),
  });
  const goals = useQuery({
    queryKey: ["finance-goals"],
    queryFn: async () => requireFinanceResult(await api.listFinanceGoals()),
  });
  const [editor, setEditor] = useState<FinanceGoal | "new" | null>(null);
  const [confirm, setConfirm] = useState<{
    goal: FinanceGoal;
    operation: "complete" | "remove";
  } | null>(null);
  const lastAction = useRef<{ payload: string; key: string } | null>(null);
  const changeGoal = useFeedbackMutation({
    feedback: { action: "update this goal", safeToRetry: false, form: false },
    mutationFn: async ({ goal, operation }: { goal: FinanceGoal; operation: GoalOperation }) => {
      const changes = { goalId: goal.id, expectedVersion: goal.version, operation };
      const payload = JSON.stringify(changes);
      if (lastAction.current?.payload !== payload)
        lastAction.current = { payload, key: crypto.randomUUID() };
      return requireFinanceMutationResult(
        await api.manageFinanceGoal({ ...changes, idempotencyKey: lastAction.current.key }),
      );
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      setConfirm(null);
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) lastAction.current = null;
      void refreshFinancePosition(client);
    },
  });
  const accessDenied = [goals, me].some(
    (query) =>
      query.isError &&
      query.error instanceof ApiClientError &&
      [401, 403].includes(query.error.status),
  );
  useEffect(() => {
    if (accessDenied) {
      setProgressGoal(null);
      setExploreGoalId(null);
    }
  }, [accessDenied]);
  const visibleGoals = accessDenied
    ? undefined
    : goals.data?.data.filter((goal) => goal.status !== "removed");
  const exploredGoal = visibleGoals?.find((goal) => goal.id === exploreGoalId);
  return (
    <div className="flex flex-col gap-6">
      <FinanceSourceState label="Wealth snapshot" query={snapshot} />
      {snapshot.data ? (
        <FinanceSection title="At a glance">
          <KeyMetrics label="Wealth key metrics">
            {[
              {
                label: "Net worth",
                value: snapshot.data.data.netWorth,
                icon: WalletIcon,
                description: "Planning assets minus debt · your share",
              },
              {
                label: "Cash",
                value: snapshot.data.data.cash,
                icon: BankIcon,
                description: "Recorded planning cash · your share",
              },
              {
                label: "Investments",
                value: snapshot.data.data.investments,
                icon: TargetIcon,
                description: "Planning investments · your share",
              },
              {
                label: "Debt",
                value: snapshot.data.data.debt,
                icon: DollarIcon,
                description: "Planning debt · your share",
              },
            ].map(({ label, value, icon, description }) => (
              <KeyMetric
                compact
                key={label}
                label={label}
                value={value === null ? "Unavailable" : formatCompactMoney(value)}
                exactValue={financeAmount(value)}
                icon={icon}
                description={description}
              />
            ))}
          </KeyMetrics>
        </FinanceSection>
      ) : null}
      <FinanceSection title="Financial goals">
        <WorkspaceHeaderControls label="Wealth controls">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Create goal"
            onClick={() => setEditor("new")}
          >
            <PlusIcon />
          </Button>
        </WorkspaceHeaderControls>
        <div className="flex min-w-0 flex-col gap-3">
          <FinanceSourceState label="Financial goals" query={goals} />
          <FinanceSourceState label="Goal confirmation context" query={me} />

          {visibleGoals?.length ? (
            <ItemGroup className="gap-3">
              {visibleGoals.map((goal) => {
                const progress =
                  me.data && todayLocalDate
                    ? goalProgressApplicability(goal, me.data.id, todayLocalDate)
                    : null;
                const evidence =
                  progress?.state === "applicable" && progress.evidence.kind === "goal"
                    ? progress.evidence
                    : null;
                return (
                  <Item
                    variant="outline"
                    key={goal.id}
                    id={`goal-${goal.id}`}
                    className="flex-col items-stretch sm:flex-row sm:items-center"
                  >
                    <ItemContent className="min-w-0 w-full sm:w-auto">
                      <ItemTitle>
                        {goal.name}
                        <Badge variant="secondary">
                          {goal.status === "active"
                            ? "Active"
                            : goal.status === "paused"
                              ? "Paused"
                              : "Completed"}
                        </Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {evidence
                          ? `${new Intl.NumberFormat(undefined, { style: "currency", currency: evidence.currencyCode }).format(evidence.progressAmountCents / 100)} confirmed toward ${new Intl.NumberFormat(undefined, { style: "currency", currency: evidence.currencyCode }).format(goal.targetAmount)}`
                          : `Progress and currency unknown · Recorded target ${goal.targetAmount}`}{" "}
                        ·{" "}
                        {goal.priority === "high"
                          ? "High"
                          : goal.priority === "medium"
                            ? "Medium"
                            : "Low"}{" "}
                        priority{goal.deadline ? ` · Due ${goal.deadline}` : " · No deadline"}
                      </ItemDescription>
                      {evidence && goal.targetAmount > 0 ? (
                        <Progress
                          aria-label={`Confirmed progress for ${goal.name}`}
                          value={Math.max(
                            0,
                            Math.min(
                              100,
                              (evidence.progressAmountCents / 100 / goal.targetAmount) * 100,
                            ),
                          )}
                        />
                      ) : null}
                      <p className="text-muted-foreground text-xs">
                        {evidence
                          ? `Your statement as of ${evidence.asOf} · Version ${goal.version}`
                          : `Recorded amount ${goal.currentAmount} is not confirmed progress · Version ${goal.version}`}
                      </p>
                    </ItemContent>
                    <ItemActions className="flex-wrap gap-1 self-end sm:self-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!me.data || !todayLocalDate || changeGoal.isPending}
                        aria-label={`${evidence ? "Reconfirm" : "Confirm"} progress for ${goal.name}`}
                        onClick={() => setProgressGoal(goal)}
                      >
                        {evidence ? "Reconfirm" : "Confirm progress"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!me.data || !todayLocalDate}
                        aria-label={`Explore ${goal.name}`}
                        onClick={() => setExploreGoalId(goal.id)}
                      >
                        Explore
                      </Button>
                      <Button
                        aria-label={`Edit ${goal.name}`}
                        disabled={changeGoal.isPending}
                        onClick={() => setEditor(goal)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <EditIcon />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Actions for ${goal.name}`}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {goal.status === "active" || goal.status === "paused" ? (
                            <DropdownMenuItem
                              disabled={changeGoal.isPending}
                              aria-label={`${goal.status === "paused" ? "Resume" : "Pause"} ${goal.name}`}
                              onSelect={() =>
                                changeGoal.mutate({
                                  goal,
                                  operation: goal.status === "paused" ? "resume" : "pause",
                                })
                              }
                            >
                              {goal.status === "paused" ? "Resume" : "Pause"}
                            </DropdownMenuItem>
                          ) : null}
                          {goal.status !== "completed" ? (
                            <DropdownMenuItem
                              disabled={changeGoal.isPending}
                              aria-label={`Complete ${goal.name}`}
                              onSelect={() => setConfirm({ goal, operation: "complete" })}
                            >
                              Mark complete
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={changeGoal.isPending}
                            aria-label={`Remove ${goal.name}`}
                            onSelect={() => setConfirm({ goal, operation: "remove" })}
                          >
                            Remove goal
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          ) : goals.isSuccess && !accessDenied ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No financial goals yet</EmptyTitle>
                <EmptyDescription>
                  Give a reserve, debt milestone, or future expense a target.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => setEditor("new")} size="sm">
                Create your first goal
              </Button>
            </Empty>
          ) : null}
        </div>
      </FinanceSection>
      {snapshot.data ? <FinancePositionMaterial result={snapshot.data} wealth hideMetrics /> : null}
      {exploredGoal && me.data && todayLocalDate ? (
        <>
          <Button variant="ghost" onClick={() => setExploreGoalId(null)}>
            Explore a separate hypothetical goal
          </Button>
          <FinanceGoalScenarioExplorer
            key={`${exploredGoal.id}:${exploredGoal.version}:${exploredGoal.planningEvidence?.evidenceId ?? "unknown"}`}
            connectedGoal={{ goal: exploredGoal, ownerUserId: me.data.id, todayLocalDate }}
            onConfirmProgress={() => setProgressGoal(exploredGoal)}
          />
        </>
      ) : (
        <FinanceGoalScenarioExplorer />
      )}
      {progressGoal && todayLocalDate && !accessDenied ? (
        <GoalProgressConfirmation
          goal={progressGoal}
          todayLocalDate={todayLocalDate}
          onClose={() => setProgressGoal(null)}
        />
      ) : null}
      {editor ? (
        <GoalEditor
          key={editor === "new" ? "new" : `${editor.id}:${editor.version}`}
          goal={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {confirm ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !changeGoal.isPending) setConfirm(null);
          }}
        >
          <DialogContent data-finance-dialog data-finance-size="default">
            <DialogHeader>
              <DialogTitle>
                {confirm.operation === "complete" ? "Complete goal" : "Remove goal"}
              </DialogTitle>
              <DialogDescription>
                {confirm.operation === "complete"
                  ? `Mark ${confirm.goal.name} complete. Its recorded amount will remain ${confirm.goal.currentAmount}. Progress and currency require a separate confirmation for the resulting goal version.`
                  : `Remove ${confirm.goal.name} from your active goals. Existing plan allocations remain part of their recorded budget versions.`}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                disabled={changeGoal.isPending}
                onClick={() => setConfirm(null)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={changeGoal.isPending}
                onClick={() => changeGoal.mutate(confirm)}
                variant={confirm.operation === "remove" ? "destructive" : "default"}
              >
                {changeGoal.isPending
                  ? "Saving…"
                  : confirm.operation === "complete"
                    ? "Confirm completion"
                    : "Remove goal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function GoalEditor({ goal, onClose }: { goal: FinanceGoal | null; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : "");
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [priority, setPriority] = useState<FinanceGoal["priority"]>(goal?.priority ?? "medium");
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
  const save = useFeedbackMutation({
    feedback: { action: "save this goal", safeToRetry: false, form: true },
    mutationFn: async () => {
      const changes = {
        deadline: deadline || null,
        name: name.trim(),
        priority,
        targetAmount: Number(target),
      };
      const payload = JSON.stringify(changes);
      if (lastAttempt.current?.payload !== payload)
        lastAttempt.current = { payload, key: crypto.randomUUID() };
      const input: ManageFinanceGoalInput = goal
        ? {
            operation: "update",
            goalId: goal.id,
            expectedVersion: goal.version,
            changes,
            idempotencyKey: lastAttempt.current.key,
          }
        : { operation: "create", ...changes, idempotencyKey: lastAttempt.current.key };
      return requireFinanceMutationResult(await api.manageFinanceGoal(input));
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) lastAttempt.current = null;
      void refreshFinancePosition(client);
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
  });
  const validTarget =
    target.trim() !== "" &&
    Number.isFinite(Number(target)) &&
    Number(target) >= 0 &&
    Number(target) <= 100_000_000;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent data-finance-dialog data-finance-size="default" className="settings-panel">
        <SettingsControlsContext.Provider value={true}>
          <DialogHeader>
            <DialogTitle>{goal ? "Edit financial goal" : "Create financial goal"}</DialogTitle>
            <DialogDescription>
              {goal
                ? `Revise the target for ${goal.name}.`
                : "Set a target and priority for your financial plan."}
            </DialogDescription>
          </DialogHeader>
          <div data-responsive-slot="layout">
            <FeedbackForm
              feedback={save.feedback}
              fieldNames={{
                targetAmount: "target",
                "changes.targetAmount": "target",
                "changes.name": "name",
                "changes.deadline": "deadline",
                "changes.priority": "priority",
              }}
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (validTarget) save.mutate();
              }}
            >
              <ResponsiveDialogBody>
                <FieldSet disabled={save.isPending}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="goal-name">Goal name</FieldLabel>
                      <Input
                        name="name"
                        id="goal-name"
                        maxLength={240}
                        required
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="goal-target">Target amount</FieldLabel>
                      <CurrencyInput
                        name="target"
                        id="goal-target"
                        min={0}
                        max={100000000}
                        required
                        value={target}
                        onValueChange={setTarget}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="goal-deadline">Deadline</FieldLabel>
                      <Input
                        name="deadline"
                        id="goal-deadline"
                        type="date"
                        value={deadline}
                        onChange={(event) => setDeadline(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="goal-priority">Priority</FieldLabel>
                      <SettingsSelect
                        name="priority"
                        id="goal-priority"
                        value={priority}
                        onChange={(event) =>
                          setPriority(event.target.value as FinanceGoal["priority"])
                        }
                      >
                        <NativeSelectOption value="high">High</NativeSelectOption>
                        <NativeSelectOption value="medium">Medium</NativeSelectOption>
                        <NativeSelectOption value="low">Low</NativeSelectOption>
                      </SettingsSelect>
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </ResponsiveDialogBody>
              <DialogFooter>
                <Button disabled={save.isPending} onClick={onClose} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={save.isPending} type="submit">
                  {save.isPending ? "Saving goal…" : goal ? "Save goal" : "Create goal"}
                </Button>
              </DialogFooter>
            </FeedbackForm>
          </div>
        </SettingsControlsContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
