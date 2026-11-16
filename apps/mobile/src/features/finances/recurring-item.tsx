import { Stack, useLocalSearchParams } from "expo-router";
import { editorActionsOptions } from "../../components/editor-header";
import type { RowAction } from "../../components/row-action-button";
import { useTheme } from "../../theme";
import {
  cashflowPage,
  useFinanceWrite,
  useRecurringItem,
  useRecurringSchedules,
  type WriteCopy,
} from "./cashflow-data";
import {
  cadenceLabel,
  cashflowDate,
  costStatement,
  isObligation,
  latestSchedule,
  type RecurringItem,
  type RecurringKind,
  recurringAmount,
  recurringStatusLabel,
  recurringSummary,
  scheduleState,
  scheduleSummary,
} from "./cashflow-rules";
import { useFinance } from "./data";
import { confirmChoice } from "./goal-confirm";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

type Change = "pause" | "resume" | "cancel";
const changeCopy = (operation: Change, confirming: boolean): WriteCopy => {
  const [loading, done, verb] =
    operation === "pause"
      ? ["Pausing…", "Recurring item paused", "pause"]
      : operation === "cancel"
        ? ["Marking cancelled…", "Recurring item marked cancelled", "cancel"]
        : confirming
          ? ["Confirming…", "Recurring item confirmed", "confirm"]
          : ["Resuming…", "Recurring item resumed", "resume"];
  return {
    loading,
    done,
    conflict: "This item changed elsewhere. Review the latest version before trying again.",
    rejected: `Couldn’t ${verb} this item. Nothing was changed.`,
    unknown: "Couldn’t confirm the item was changed. Check its status before trying again.",
  };
};

/** Top-right actions: schedule, cost, pause or resume and, last and destructive, cancel. */
function ItemActions({
  item,
  kind,
  revising,
}: {
  item: RecurringItem;
  kind: RecurringKind;
  revising: boolean;
}) {
  const t = useTheme();
  const { api } = useFinance();
  const write = useFinanceWrite();
  const params = { kind, id: item.id };
  const open = item.status === "active" || item.status === "needs_review";
  const change = (operation: Change) => {
    const input = { operation, itemId: item.id, itemType: kind };
    void write.run(
      input,
      (idempotencyKey) => api.manageFinanceRecurringItem({ ...input, idempotencyKey }),
      changeCopy(operation, item.status === "needs_review"),
    );
  };
  const actions: RowAction[] = [];
  if (open)
    actions.push({
      id: "schedule",
      label: revising ? "Revise schedule" : "Confirm schedule",
      icon: "calendar",
      disabled: write.pending,
      onPress: () => cashflowPage("schedule", params),
    });
  if (open && isObligation(item) && item.kind !== "savings")
    actions.push({
      id: "cost",
      label: costStatement(item) ? "Edit cost statement" : "Confirm cost",
      icon: "receipt",
      disabled: write.pending,
      onPress: () => cashflowPage("cost", { id: item.id }),
    });
  if (item.status === "active")
    actions.push({
      id: "pause",
      label: "Pause",
      icon: "clock",
      disabled: write.pending,
      onPress: () => change("pause"),
    });
  else
    actions.push({
      id: "resume",
      label: item.status === "needs_review" ? "Confirm pattern" : "Resume",
      icon: item.status === "needs_review" ? "check" : "refresh",
      disabled: write.pending,
      onPress: () => change("resume"),
    });
  if (kind === "obligation" && item.status !== "cancelled")
    actions.push({
      id: "cancel",
      label: "Mark cancelled",
      icon: "cancel",
      destructive: true,
      disabled: write.pending,
      onPress: () =>
        confirmChoice({
          title: `Mark ${item.displayName} cancelled?`,
          message:
            "It stops appearing in upcoming money. This does not cancel anything with the provider.",
          cancel: "Keep",
          accept: "Mark cancelled",
          destructive: true,
          onAccept: () => change("cancel"),
        }),
    });
  return <Stack.Screen options={editorActionsOptions("Recurring item actions", actions, t)} />;
}

/** One income stream, bill, subscription or savings pattern: its status, schedule and cost. */
export function FinanceRecurringItemScreen() {
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const { query, accounts, item, account, kind: itemKind } = useRecurringItem(kind, id);
  const open = item?.status === "active" || item?.status === "needs_review";
  const schedules = useRecurringSchedules(!!item);
  const schedule = item ? latestSchedule(schedules.data, { kind: itemKind, id: item.id }) : null;
  const state = item ? scheduleState(schedule, item) : "none";
  const cost = item && isObligation(item) ? costStatement(item) : null;
  return (
    <>
      <Stack.Screen options={{ title: kind === "income" ? "income" : "recurring item" }} />
      <ReadState query={query}>
        {item ? (
          <FinanceScreen title={item.displayName}>
            <ItemActions item={item} kind={itemKind} revising={!!schedule} />
            <Metric
              label="Expected amount"
              value={recurringAmount(item, accounts.data?.accounts)}
              hint={recurringSummary(item)}
            />
            <Card rows>
              <FinanceRow
                centered
                title="Status"
                value={recurringStatusLabel(item.status)}
                valueTone={item.status === "needs_review" ? "attention" : undefined}
                icon="info"
              />
              {isObligation(item) && (
                <FinanceRow
                  centered
                  title="Kind"
                  value={
                    item.kind === "bill"
                      ? "Bill"
                      : item.kind === "subscription"
                        ? "Subscription"
                        : "Savings"
                  }
                  icon="categoryLayers"
                />
              )}
              <FinanceRow
                centered
                title="Repeats"
                value={cadenceLabel(item.cadence)}
                icon="refresh"
              />
              <FinanceRow
                centered
                title="Last seen"
                value={item.lastObservedDate ? cashflowDate(item.lastObservedDate) : "Not yet"}
                icon="history"
              />
              <FinanceRow
                centered
                title="Account"
                value={account?.name ?? (item.accountId ? "Unavailable" : "None established")}
                icon="finances"
              />
              <FinanceRow
                centered
                title="Found by"
                value={item.source === "user" ? "You" : "Account activity"}
                icon="search"
              />
            </Card>
            <Section title="Schedule">
              <ReadState query={schedules}>
                <Card>
                  {schedule && state === "confirmed" ? (
                    <>
                      <Copy>Schedule confirmed</Copy>
                      <Copy secondary>{scheduleSummary(schedule)}</Copy>
                    </>
                  ) : (
                    <>
                      <Copy>
                        {state === "changed"
                          ? "Schedule needs confirming again"
                          : "Schedule not confirmed"}
                      </Copy>
                      <Copy secondary>
                        {state === "changed"
                          ? `This item changed after its schedule was confirmed, so it no longer produces upcoming dates. ${open ? "Use Revise schedule in the actions menu." : "Resume it to revise the schedule."}`
                          : "Upcoming dates come only from a schedule you confirm. Until then this item shows its next expected date and stays out of upcoming money."}
                      </Copy>
                    </>
                  )}
                </Card>
              </ReadState>
            </Section>
            {isObligation(item) && item.kind !== "savings" && (
              <Section title="Cost">
                <Card>
                  <Copy>
                    {cost
                      ? `${cost.fixedness === "fixed" ? "Fixed" : "Variable"} cost`
                      : "Cost not confirmed"}
                  </Copy>
                  <Copy secondary>
                    {cost
                      ? `${cost.provenance === "explicit_user" ? "Your statement" : "Recorded by your agent"} as of ${cashflowDate(cost.asOf)}.`
                      : open
                        ? "State whether this payment is fixed or variable with Confirm cost in the actions menu."
                        : "Resume this item to state whether its payment is fixed or variable."}
                  </Copy>
                </Card>
              </Section>
            )}
          </FinanceScreen>
        ) : (
          <FinanceScreen title="Recurring item">
            <Copy secondary>This recurring item is unavailable.</Copy>
          </FinanceScreen>
        )}
      </ReadState>
    </>
  );
}
