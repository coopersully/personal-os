import type { FinanceGoal, ManageFinanceGoalInput } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActionButton as Button } from "@/components/action-button";
import { CurrencyInput } from "@/components/currency-input";
import { BankIcon, DollarIcon, PlusIcon, TargetIcon, WalletIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
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
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
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
  const visibleGoals = goals.data?.data.filter((goal) => goal.status !== "removed");
  return (
    <div className="flex flex-col gap-6">
      <FinanceSourceState label="Wealth snapshot" query={snapshot} />
      {snapshot.data ? (
        <>
          <Carousel
            opts={{ align: "start", loop: true }}
            aria-label="Wealth key metrics"
            className="min-w-0"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-medium">Key metrics</h2>
              <div className="flex gap-2">
                <CarouselPrevious
                  className="static translate-x-0 translate-y-0"
                  title="Previous metrics"
                />
                <CarouselNext className="static translate-x-0 translate-y-0" title="Next metrics" />
              </div>
            </div>
            <CarouselContent>
              {[
                { label: "Net worth", value: snapshot.data.data.netWorth, icon: WalletIcon },
                { label: "Cash", value: snapshot.data.data.cash, icon: BankIcon },
                { label: "Investments", value: snapshot.data.data.investments, icon: TargetIcon },
                { label: "Debt", value: snapshot.data.data.debt, icon: DollarIcon },
              ].map(({ label, value, icon: Icon }) => (
                <CarouselItem key={label} className="basis-4/5 sm:basis-1/2 xl:basis-1/3">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon aria-hidden="true" />
                        {label}
                      </CardTitle>
                      <CardDescription>Current balance</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-semibold tabular-nums">{financeAmount(value)}</p>
                    </CardContent>
                  </Card>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          <FinancePositionMaterial result={snapshot.data} wealth hideMetrics />
        </>
      ) : null}
      <Card aria-label="Financial goals">
        <CardHeader>
          <CardTitle>Financial goals</CardTitle>
          <CardAction>
            <Button size="icon" aria-label="Create goal" onClick={() => setEditor("new")}>
              <PlusIcon />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FinanceSourceState label="Financial goals" query={goals} />
          {changeGoal.isError && !confirm ? (
            <Alert variant="destructive">
              <AlertTitle>Goal was not changed</AlertTitle>
              <AlertDescription>{changeGoal.feedback?.message}</AlertDescription>
            </Alert>
          ) : null}
          {visibleGoals?.length ? (
            <ItemGroup className="finance-bento finance-goal-grid">
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
        </CardContent>
      </Card>
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
                <AlertDescription>{changeGoal.feedback?.message}</AlertDescription>
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit financial goal" : "Create financial goal"}</DialogTitle>
          <DialogDescription>
            {goal
              ? `Revise the target for ${goal.name}.`
              : "Set a target and priority for your financial plan."}
          </DialogDescription>
        </DialogHeader>
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
                <FieldLabel htmlFor="goal-target">Target amount (USD)</FieldLabel>
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
                <NativeSelect
                  name="priority"
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

          <DialogFooter>
            <Button disabled={save.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={save.isPending} type="submit">
              {save.isPending ? "Saving goal…" : goal ? "Save goal" : "Create goal"}
            </Button>
          </DialogFooter>
        </FeedbackForm>
      </DialogContent>
    </Dialog>
  );
}
