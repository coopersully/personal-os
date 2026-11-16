import type { FinanceRecurringSchedule } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { EnumChoice } from "../../components/forms/enum-choice";
import { PaddedSurfaceRows } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import {
  until,
  useFinanceWrite,
  useRecurringItem,
  useRecurringSchedules,
  useSettled,
} from "./cashflow-data";
import { CashflowForm } from "./cashflow-form";
import {
  cashflowDate,
  latestSchedule,
  type RecurringItem,
  type RecurringKind,
  type ScheduleDraft,
  scheduleCadences,
  scheduleStatement,
} from "./cashflow-rules";
import { useFinance } from "./data";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

const bases = [
  { value: "fixed", label: "Fixed" },
  { value: "variable", label: "Variable" },
];

function ScheduleForm(props: {
  item: RecurringItem & { revision: number };
  kind: RecurringKind;
  previous: FinanceRecurringSchedule | null;
  account: { name: string; currencyCode: string | null } | undefined;
  timezone: string | undefined;
  /** The item was paused or cancelled after this form opened. */
  closed: boolean;
}) {
  const { api } = useFinance();
  const write = useFinanceWrite();
  // The statement is made about the versions that were open; a refresh never moves them.
  const [{ item, kind, previous, account, timezone }] = useState(props);
  const [draft, setDraft] = useState<ScheduleDraft>({
    cadence: previous?.cadence ?? "",
    timezone: previous?.timezone ?? timezone ?? "",
    anchorLocalDate: previous?.anchorLocalDate ?? null,
    effectiveFrom: null,
    day1: previous?.semimonthlyDays ? String(previous.semimonthlyDays[0]) : "",
    day2: previous?.semimonthlyDays ? String(previous.semimonthlyDays[1]) : "",
    amountBasis: previous?.amountBasis ?? "",
    amount: previous?.amountCents == null ? "" : (previous.amountCents / 100).toFixed(2),
    currencyCode: account?.currencyCode ?? previous?.currencyCode ?? "",
  });
  const [edited, setEdited] = useState(false);
  const set = <K extends keyof ScheduleDraft>(key: K) => {
    return (value: ScheduleDraft[K]) => {
      if (write.locked.current) return;
      setDraft((current) => ({ ...current, [key]: value }));
      setEdited(true);
    };
  };
  const { statement, errors } = scheduleStatement(draft, {
    source: { kind, id: item.id },
    expectedSourceRevision: item.revision,
    supersedes: previous,
    accountId: item.accountId,
    accountCurrency: account?.currencyCode ?? null,
  });
  async function save() {
    if (!statement) return;
    const saved = await write.run(
      statement,
      (idempotencyKey) => api.confirmFinanceRecurringSchedule({ ...statement, idempotencyKey }),
      {
        loading: "Recording your schedule…",
        done: "Recurring schedule confirmed",
        conflict:
          "This schedule could not be recorded: the item or its schedule changed elsewhere, or a matched date falls on or after the effective date. Close and reopen it to review; your entries are still here.",
        rejected: "Couldn’t record this schedule. Check the entries; they are still here.",
        unknown:
          "Couldn’t confirm the schedule was recorded. Your entries are still here. Check the item before retrying.",
      },
    );
    if (saved) router.back();
  }
  return (
    <CashflowForm
      title={previous ? "Revise schedule" : "Confirm schedule"}
      edited={edited}
      pending={write.pending}
      invalid={!statement || props.closed}
      discard="Your schedule statement has not been recorded."
      onSave={() => void save()}
    >
      <Copy secondary>{item.displayName}</Copy>
      {props.closed && (
        <Copy>
          This item is now paused, cancelled or unavailable, so a schedule cannot be recorded for
          it. Your entries are still here; close this form and resume the item first.
        </Copy>
      )}
      <Card rows>
        <PaddedSurfaceRows>
          <FinanceRow
            centered
            title="Account"
            value={account?.name ?? (item.accountId ? "Unavailable" : "None established")}
            icon="finances"
          />
          <EnumChoice
            label="Repeats"
            icon="refresh"
            value={draft.cadence || null}
            valueLabel={draft.cadence ? undefined : "Required"}
            disabled={write.pending}
            options={scheduleCadences}
            onChange={set("cadence")}
          />
          <TextRow
            label="Timezone"
            value={draft.timezone}
            onChangeText={set("timezone")}
            editable={!write.pending}
            correction={draft.timezone.trim() ? errors.timezone : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Required"
          />
          <SettingsAccentProvider workspace="finances">
            <DateField
              label="First date"
              dateOnly
              value={draft.anchorLocalDate}
              onChange={(value) => set("anchorLocalDate")(value ? value.slice(0, 10) : null)}
            />
            <DateField
              label="Effective from"
              dateOnly
              value={draft.effectiveFrom}
              onChange={(value) => set("effectiveFrom")(value ? value.slice(0, 10) : null)}
            />
          </SettingsAccentProvider>
          {draft.cadence === "semimonthly" && (
            <>
              <TextRow
                label="First day of month"
                value={draft.day1}
                onChangeText={set("day1")}
                editable={!write.pending}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="Required"
              />
              <TextRow
                label="Second day of month"
                value={draft.day2}
                onChangeText={set("day2")}
                editable={!write.pending}
                correction={draft.day1 && draft.day2 ? errors.days : undefined}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="Required"
              />
            </>
          )}
          <EnumChoice
            label="Amount type"
            icon="wallet"
            value={draft.amountBasis || null}
            valueLabel={draft.amountBasis ? undefined : "Required"}
            disabled={write.pending}
            options={bases}
            onChange={set("amountBasis")}
          />
          <TextRow
            label="Expected amount"
            value={draft.amount}
            onChangeText={set("amount")}
            editable={!write.pending}
            correction={
              draft.amount.trim() || draft.amountBasis === "fixed" ? errors.amount : undefined
            }
            keyboardType="decimal-pad"
            placeholder={draft.amountBasis === "fixed" ? "Required" : "Optional"}
          />
          <TextRow
            label="Currency"
            value={draft.currencyCode}
            onChangeText={(value) => set("currencyCode")(value.toUpperCase())}
            editable={!write.pending}
            correction={draft.currencyCode ? errors.currencyCode : undefined}
            maxLength={3}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Required"
          />
        </PaddedSurfaceRows>
      </Card>
      {draft.anchorLocalDate && errors.anchorLocalDate && <Copy>{errors.anchorLocalDate}</Copy>}
      {draft.effectiveFrom && errors.effectiveFrom && <Copy>{errors.effectiveFrom}</Copy>}
      <Copy secondary>
        State the schedule you know: how often it repeats, the first date it follows and the date
        this statement takes effect. Every field is required except the amount of a variable
        schedule. No date is taken from the next expected payment, and confirming does not schedule
        a payment with your bank. Saving starts a new version of this item, so a cost statement will
        need confirming again.
        {previous
          ? ` This replaces the schedule in effect since ${cashflowDate(previous.effectiveFrom)}; earlier history is kept, and matched dates on or after the new effective date must be reversed first.`
          : ""}
      </Copy>
    </CashflowForm>
  );
}

/** Confirms or revises the schedule of the recurring item named by `kind` and `id`. */
export function FinanceRecurringScheduleEditor() {
  const { kind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const { query, accounts, item, account, kind: itemKind, timezone } = useRecurringItem(kind, id);
  const schedules = useRecurringSchedules();
  const settled = useSettled(query, schedules, accounts);
  const open = item && (item.status === "active" || item.status === "needs_review");
  // Once the form has opened it stays: a re-read that finds the item paused must not discard
  // the entries. The form then says why it cannot be saved.
  const opened = useRef<Omit<Parameters<typeof ScheduleForm>[0], "closed"> | null>(null);
  if (!opened.current && settled && item && open && item.revision && schedules.data)
    opened.current = {
      item: { ...item, revision: item.revision },
      kind: itemKind,
      previous: latestSchedule(schedules.data, { kind: itemKind, id: item.id }),
      account,
      timezone,
    };
  return (
    <ReadState query={until(query, settled)}>
      <Stack.Screen options={{ title: "schedule" }} />
      <ReadState query={accounts}>
        <ReadState query={schedules}>
          {opened.current ? (
            <ScheduleForm {...opened.current} closed={!open} />
          ) : (
            <FinanceScreen title="Schedule">
              <Copy secondary>
                {item && !open
                  ? "A paused or cancelled item cannot take a schedule. Resume it first."
                  : "This recurring item is unavailable."}
              </Copy>
            </FinanceScreen>
          )}
        </ReadState>
      </ReadState>
    </ReadState>
  );
}
