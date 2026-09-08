import type { FinanceGoal, ManageFinanceGoalInput } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
} from "@/components/workspace-secondary-app-bar";
import { api, errorMessage } from "../../api.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import {
  FinanceAccountRecord,
  FinancePositionMaterial,
  FinanceSourceState,
  financeAmount,
  refreshFinancePosition,
  requireFinanceResult,
} from "./position-material.js";

type GoalOperation = "pause" | "resume" | "complete" | "remove";

export function FinanceWealthPage() {
  const client = useQueryClient();
  const snapshot = useQuery({
    queryKey: ["finance-snapshot"],
    queryFn: async () => requireFinanceResult(await api.getFinanceSnapshot()),
  });
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
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
  const changeGoal = useMutation({
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
  const visibleGoals = goals.data?.data.filter((goal) => goal.status !== "removed");
  return (
    <div className="flex flex-col gap-6">
      <WorkspaceSecondaryAppBar aria-label="Wealth controls">
        <WorkspaceSecondaryAppBarActions>
          <Button onClick={() => setEditor("new")} size="sm">
            Create goal
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/finances/accounts">Manage accounts</Link>
          </Button>
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <FinanceSourceState label="Wealth snapshot" query={snapshot} />
      {snapshot.data ? <FinancePositionMaterial result={snapshot.data} wealth /> : null}
      <section aria-label="Financial goals" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Financial goals</h2>
        <FinanceSourceState label="Financial goals" query={goals} />
        {changeGoal.isError && !confirm ? (
          <Alert variant="destructive">
            <AlertTitle>Goal was not changed</AlertTitle>
            <AlertDescription>{errorMessage(changeGoal.error)}</AlertDescription>
          </Alert>
        ) : null}
        {visibleGoals?.length ? (
          <ItemGroup>
            {visibleGoals.map((goal) => (
              <Item key={goal.id} id={`goal-${goal.id}`}>
                <ItemContent className="min-w-0">
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
                    {financeAmount(goal.currentAmount)} recorded toward{" "}
                    {financeAmount(goal.targetAmount)} ·{" "}
                    {goal.priority === "high"
                      ? "High"
                      : goal.priority === "medium"
                        ? "Medium"
                        : "Low"}{" "}
                    priority{goal.deadline ? ` · Due ${goal.deadline}` : " · No deadline"}
                  </ItemDescription>
                  <p className="text-muted-foreground text-xs">
                    Recorded goal progress · Version {goal.version}
                  </p>
                </ItemContent>
                <ItemActions className="flex-wrap">
                  <Button
                    aria-label={`Edit ${goal.name}`}
                    disabled={changeGoal.isPending}
                    onClick={() => setEditor(goal)}
                    size="sm"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  {goal.status === "active" || goal.status === "paused" ? (
                    <Button
                      aria-label={`${goal.status === "paused" ? "Resume" : "Pause"} ${goal.name}`}
                      disabled={changeGoal.isPending}
                      onClick={() =>
                        changeGoal.mutate({
                          goal,
                          operation: goal.status === "paused" ? "resume" : "pause",
                        })
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {goal.status === "paused" ? "Resume" : "Pause"}
                    </Button>
                  ) : null}
                  {goal.status !== "completed" ? (
                    <Button
                      aria-label={`Complete ${goal.name}`}
                      disabled={changeGoal.isPending}
                      onClick={() => setConfirm({ goal, operation: "complete" })}
                      size="sm"
                      variant="ghost"
                    >
                      Complete
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`Remove ${goal.name}`}
                    disabled={changeGoal.isPending}
                    onClick={() => setConfirm({ goal, operation: "remove" })}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        ) : goals.isSuccess ? (
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
      </section>
      <section aria-label="Accounts behind your position" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Accounts behind your position</h2>
        <FinanceSourceState label="Wealth accounts" query={accounts} />
        {accounts.data?.accounts.length ? (
          <ItemGroup>
            {accounts.data.accounts.map((account) => (
              <FinanceAccountRecord key={account.id} account={account} />
            ))}
          </ItemGroup>
        ) : accounts.isSuccess ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No account evidence yet</EmptyTitle>
              <EmptyDescription>
                Your position becomes available when account evidence is established.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild size="sm" variant="outline">
              <Link to="/finances/accounts">Add accounts</Link>
            </Button>
          </Empty>
        ) : null}
      </section>
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirm.operation === "complete" ? "Complete goal" : "Remove goal"}
              </DialogTitle>
              <DialogDescription>
                {confirm.operation === "complete"
                  ? `Mark ${confirm.goal.name} complete. Its recorded amount will remain ${financeAmount(confirm.goal.currentAmount)}.`
                  : `Remove ${confirm.goal.name} from your active goals. Existing plan allocations remain part of their recorded budget versions.`}
              </DialogDescription>
            </DialogHeader>
            {changeGoal.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Goal was not changed</AlertTitle>
                <AlertDescription>{errorMessage(changeGoal.error)}</AlertDescription>
              </Alert>
            ) : null}
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
  const save = useMutation({
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit financial goal" : "Create financial goal"}</DialogTitle>
          <DialogDescription>
            {goal
              ? `Revise the target for ${goal.name}.`
              : "Set a target and priority for your financial plan."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (validTarget) save.mutate();
          }}
        >
          <FieldSet disabled={save.isPending}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="goal-name">Goal name</FieldLabel>
                <Input
                  id="goal-name"
                  maxLength={240}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-target">Target amount (USD)</FieldLabel>
                <Input
                  id="goal-target"
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.01"
                  required
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-deadline">Deadline</FieldLabel>
                <Input
                  id="goal-deadline"
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-priority">Priority</FieldLabel>
                <NativeSelect
                  id="goal-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as FinanceGoal["priority"])}
                >
                  <NativeSelectOption value="high">High</NativeSelectOption>
                  <NativeSelectOption value="medium">Medium</NativeSelectOption>
                  <NativeSelectOption value="low">Low</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
          </FieldSet>
          {save.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Goal was not saved</AlertTitle>
              <AlertDescription>
                {errorMessage(save.error)}
                {goal ? " Close and reopen the goal to load its latest version." : ""}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={save.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={save.isPending || !validTarget || !name.trim()} type="submit">
              {save.isPending ? "Saving goal…" : goal ? "Save goal" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
