import type { FinanceOccurrenceMatchEvent, FinanceRecurringOccurrence } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Action, Actions, PaddedSurfaceRows } from "../../components/forms/form-rows";
import { InlineOptions } from "../../components/forms/inline-options";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { TextRow } from "./account-editor";
import {
  cashflowPage,
  until,
  useCashflowSources,
  useFinanceWrite,
  useOccurrences,
  useSettled,
} from "./cashflow-data";
import { CashflowForm } from "./cashflow-form";
import {
  activeMatches,
  type CashflowTransaction,
  cashflowDate,
  eligibleAllocations,
  eligibleTransactions,
  occurrenceEvents,
  occurrenceStateLabel,
  parseCents,
  shiftDate,
} from "./cashflow-rules";
import { useFinance } from "./data";
import { isCalendarDate } from "./goal-progress";
import { localToday } from "./mutations";
import { formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

const money = (cents: number | null, currency: string) =>
  cents == null ? "Unavailable" : formatMoney(cents / 100, currency);

/** The occurrence named by the route's `key`, read for the route's date range. */
function useOccurrence() {
  const params = useLocalSearchParams<{
    key?: string;
    from?: string;
    to?: string;
    match?: string;
  }>();
  const range =
    params.from && params.to && isCalendarDate(params.from) && isCalendarDate(params.to)
      ? { from: params.from, to: params.to }
      : null;
  const query = useOccurrences(range);
  const occurrence = query.data?.occurrences.find((item) => item.key === params.key);
  return {
    query: { ...query, configurationMissing: !range },
    occurrence,
    events: query.data?.matchEvents ?? [],
    params,
  };
}
const canMatch = (occurrence: FinanceRecurringOccurrence) =>
  occurrence.inCurrentSchedule &&
  occurrence.matchState !== "invalidated" &&
  occurrence.accountId !== null &&
  (occurrence.remainingExpectedCents ?? 0) > 0;
/** The day something was recorded, in the account planning timezone when it is known. */
function useRecordedDay() {
  const { timezone } = useFinance();
  return (recordedAt: string) =>
    cashflowDate(timezone ? localToday(timezone, new Date(recordedAt)) : recordedAt.slice(0, 10));
}
const eventActor = (event: FinanceOccurrenceMatchEvent) =>
  event.approvalActor ? "your agent" : "you";

/** One expected item: what was expected, what has been matched to it, and its history. */
export function FinanceOccurrenceScreen() {
  const { query, occurrence, events, params } = useOccurrence();
  const recordedDay = useRecordedDay();
  const history = occurrence ? occurrenceEvents(occurrence, events) : [];
  const matches = occurrence ? activeMatches(occurrence, events) : [];
  const route = { key: params.key ?? "", from: params.from ?? "", to: params.to ?? "" };
  return (
    <>
      <Stack.Screen options={{ title: "expected item" }} />
      <ReadState query={query}>
        {occurrence ? (
          <FinanceScreen title={occurrence.displayName}>
            <Metric
              label={occurrence.source.kind === "income" ? "Expected income" : "Expected payment"}
              value={money(occurrence.expectedAmountCents, occurrence.currencyCode)}
              hint={`${cashflowDate(occurrence.localDate)} · ${occurrenceStateLabel(occurrence.matchState)}`}
            />
            <Card rows>
              <FinanceRow
                centered
                title="Matched"
                value={money(occurrence.matchedAmountCents, occurrence.currencyCode)}
                icon="check"
              />
              <FinanceRow
                centered
                title="Still expected"
                value={money(occurrence.remainingExpectedCents, occurrence.currencyCode)}
                icon="clock"
              />
              <FinanceRow
                centered
                title="Amount"
                value={occurrence.amountBasis === "fixed" ? "Fixed" : "Variable"}
                icon="wallet"
              />
              <FinanceRow
                centered
                title="Recurring item"
                icon="refresh"
                onPress={() =>
                  cashflowPage("item", {
                    kind: occurrence.source.kind,
                    id: occurrence.source.id,
                  })
                }
              />
            </Card>
            <Section title="Matches">
              {canMatch(occurrence) && (
                <SettingsAccentProvider workspace="finances">
                  <Actions inset={false}>
                    <Action
                      label="Match"
                      accessibilityLabel="Match a transaction"
                      onPress={() => cashflowPage("match", route)}
                    />
                  </Actions>
                </SettingsAccentProvider>
              )}
              {matches.length ? (
                <Card rows>
                  {matches.map((event) => (
                    <FinanceRow
                      key={event.id}
                      title={formatMoney(event.amountCents / 100, event.currencyCode)}
                      subtitle={`${occurrence.matchIds.includes(event.id) ? "Matched" : "No longer counted, matched"} by ${eventActor(event)} · ${recordedDay(event.recordedAt)} · ${event.rationale}`}
                      icon="check"
                      accessibilityHint="Opens the form that reverses this match"
                      onPress={() => cashflowPage("match", { ...route, match: event.id })}
                    />
                  ))}
                </Card>
              ) : (
                <Card>
                  <Copy secondary>
                    {occurrence.inCurrentSchedule
                      ? "Nothing is matched to this expected item."
                      : "This item belongs to an earlier schedule. Nothing is matched to it, and only an existing match could be reversed."}
                  </Copy>
                </Card>
              )}
              <Copy secondary>
                A match links a posted transaction to this expected item. It never creates or
                changes a payment. Open a match to reverse it.
              </Copy>
            </Section>
            {history.length > matches.length && (
              <Section title="History">
                <Card rows>
                  {history.map((event) => (
                    <FinanceRow
                      key={event.id}
                      title={event.kind === "reverse" ? "Match reversed" : "Matched"}
                      subtitle={`By ${eventActor(event)} · ${recordedDay(event.recordedAt)} · ${event.rationale}`}
                      value={formatMoney(event.amountCents / 100, event.currencyCode)}
                      icon="history"
                    />
                  ))}
                </Card>
              </Section>
            )}
          </FinanceScreen>
        ) : (
          <FinanceScreen title="Expected item">
            <Copy secondary>This expected item is unavailable.</Copy>
          </FinanceScreen>
        )}
      </ReadState>
    </>
  );
}

const matchCopy = {
  loading: "Recording match…",
  done: "Transaction matched",
  conflict:
    "This match could not be recorded: the transaction or the expected item changed, or the amount is more than is still unmatched. Close and reopen it to review; your entries are still here.",
  rejected: "Couldn’t record this match. Check the entries; they are still here.",
  unknown:
    "Couldn’t confirm the match was recorded. Your entries are still here. Check the expected item before retrying.",
};
const reverseCopy = {
  loading: "Reversing match…",
  done: "Match reversed",
  conflict: "This match changed elsewhere and may already be reversed. Review the expected item.",
  rejected: "Couldn’t reverse this match. Nothing was changed.",
  unknown: "Couldn’t confirm the match was reversed. Check the expected item before trying again.",
};

function MatchForm(props: {
  occurrence: FinanceRecurringOccurrence;
  candidates: CashflowTransaction[];
  truncated: boolean;
}) {
  const { api } = useFinance();
  const write = useFinanceWrite();
  // The match is stated against the revisions that were open; a refresh never moves them.
  const [{ occurrence, candidates, truncated }] = useState(props);
  const [transactionId, setTransactionId] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [rationale, setRationale] = useState("");
  const [edited, setEdited] = useState(false);
  const edit = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      if (write.locked.current) return;
      set(value);
      setEdited(true);
    };
  };
  const expense = occurrence.source.kind === "obligation";
  const transaction = candidates.find((item) => item.id === transactionId);
  const allocations = transaction ? eligibleAllocations(transaction) : [];
  const allocation =
    allocations.length === 1
      ? allocations[0]
      : allocations.find((item) => item.id === allocationId);
  const cents = parseCents(amount);
  const remaining = occurrence.remainingExpectedCents ?? 0;
  const limit = Math.min(
    remaining,
    expense ? (allocation?.amountCents ?? remaining) : (transaction?.amountCents ?? remaining),
  );
  const amountCorrection = !amount.trim()
    ? undefined
    : cents === undefined || cents < 1
      ? "Enter an amount such as 125.00."
      : cents > limit
        ? `At most ${money(limit, occurrence.currencyCode)} can be matched here.`
        : undefined;
  const invalid =
    !transaction ||
    (expense && !allocation) ||
    cents === undefined ||
    cents < 1 ||
    cents > limit ||
    !rationale.trim();
  async function save() {
    if (invalid || !transaction || cents === undefined) return;
    const common = {
      occurrence: {
        scheduleVersionId: occurrence.scheduleVersionId,
        localDate: occurrence.localDate,
        slot: occurrence.slot,
      },
      transactionId: transaction.id,
      expectedTransactionRevision: transaction.transactionRevision,
      expectedReimbursementRelationshipRevision: transaction.reimbursementRelationshipRevision,
      amountCents: cents,
      currencyCode: occurrence.currencyCode,
      rationale: rationale.trim(),
    };
    const input =
      expense && allocation
        ? {
            ...common,
            operation: "match_expense" as const,
            allocationId: allocation.id,
            expectedAllocationRevision: allocation.revision,
          }
        : { ...common, operation: "match_income" as const };
    const saved = await write.run(
      input,
      (idempotencyKey) => api.manageFinanceOccurrenceMatch({ ...input, idempotencyKey }),
      matchCopy,
    );
    if (saved) router.back();
  }
  return (
    <CashflowForm
      title="Match a transaction"
      edited={edited}
      pending={write.pending}
      invalid={invalid}
      saveLabel="Record match"
      saveIcon="check"
      discard="This match has not been recorded."
      onSave={() => void save()}
    >
      <Copy secondary>
        {occurrence.displayName} · {cashflowDate(occurrence.localDate)} ·{" "}
        {money(occurrence.remainingExpectedCents, occurrence.currencyCode)} still expected
      </Copy>
      <Section title="Posted transaction">
        {candidates.length ? (
          <Card rows>
            <SettingsAccentProvider workspace="finances">
              <InlineOptions
                value={transactionId || null}
                options={candidates.map((item) => ({
                  value: item.id,
                  label: `${item.merchant} · ${cashflowDate(item.date)} · ${money(item.amountCents, occurrence.currencyCode)}`,
                }))}
                onChange={(value) => {
                  edit(setTransactionId)(value);
                  setAllocationId("");
                }}
              />
            </SettingsAccentProvider>
          </Card>
        ) : (
          <Card>
            <Copy secondary>
              No posted transaction in this account and currency within two weeks of this date can
              be matched. Review the transaction first if it is uncategorized or pending.
            </Copy>
          </Card>
        )}
        {truncated && (
          <Copy secondary>
            Only part of this period’s transactions could be read, so some may be missing here.
          </Copy>
        )}
      </Section>
      {expense && allocations.length > 1 && (
        <Section title="Part of the transaction">
          <Card rows>
            <SettingsAccentProvider workspace="finances">
              <InlineOptions
                value={allocationId || null}
                options={allocations.map((item) => ({
                  value: item.id,
                  label: `${money(item.amountCents, occurrence.currencyCode)} · ${item.treatment === "personal" ? "Mine" : "Reimbursable"}`,
                }))}
                onChange={edit(setAllocationId)}
              />
            </SettingsAccentProvider>
          </Card>
        </Section>
      )}
      <Card rows>
        <PaddedSurfaceRows>
          <TextRow
            label="Amount matched"
            value={amount}
            onChangeText={edit(setAmount)}
            editable={!write.pending}
            correction={amountCorrection}
            keyboardType="decimal-pad"
            placeholder="Required"
          />
          <TextRow
            label="Reason"
            value={rationale}
            onChangeText={edit(setRationale)}
            editable={!write.pending}
            maxLength={2000}
            placeholder="Required"
          />
        </PaddedSurfaceRows>
      </Card>
      <Copy secondary>
        Choose the posted transaction, the amount of this expected item it covers and your reason. A
        part of the amount can be matched now and the rest later. Matching never creates a payment.
      </Copy>
    </CashflowForm>
  );
}

function ReverseForm(props: {
  occurrence: FinanceRecurringOccurrence;
  match: FinanceOccurrenceMatchEvent;
}) {
  const { api } = useFinance();
  const write = useFinanceWrite();
  const [{ occurrence, match }] = useState(props);
  const recordedDay = useRecordedDay();
  const [rationale, setRationale] = useState("");
  async function save() {
    if (!rationale.trim()) return;
    const input = { operation: "reverse" as const, matchId: match.id, rationale: rationale.trim() };
    const saved = await write.run(
      input,
      (idempotencyKey) => api.manageFinanceOccurrenceMatch({ ...input, idempotencyKey }),
      reverseCopy,
    );
    if (saved) router.back();
  }
  return (
    <CashflowForm
      title="Reverse match"
      edited={!!rationale}
      pending={write.pending}
      invalid={!rationale.trim()}
      saveLabel="Reverse match"
      saveIcon="refresh"
      discard="This match has not been reversed."
      onSave={() => void save()}
    >
      <Copy secondary>
        {occurrence.displayName} · {cashflowDate(occurrence.localDate)}
      </Copy>
      <Card rows>
        <PaddedSurfaceRows>
          <FinanceRow
            centered
            title="Matched amount"
            value={formatMoney(match.amountCents / 100, match.currencyCode)}
            icon="check"
          />
          <FinanceRow
            centered
            title="Recorded"
            value={recordedDay(match.recordedAt)}
            icon="history"
          />
          <TextRow
            label="Reason"
            value={rationale}
            onChangeText={(value) => {
              if (!write.locked.current) setRationale(value);
            }}
            editable={!write.pending}
            maxLength={2000}
            placeholder="Required"
          />
        </PaddedSurfaceRows>
      </Card>
      <Copy secondary>
        This reverses the whole match and needs your reason. The original match and its reason stay
        in the history.
      </Copy>
    </CashflowForm>
  );
}

/** Matches a posted transaction to an expected item, or reverses the match named by `match`. */
export function FinanceOccurrenceMatch() {
  const { query, occurrence, events, params } = useOccurrence();
  const reversing = !!params.match;
  const match = occurrence
    ? activeMatches(occurrence, events).find((event) => event.id === params.match)
    : undefined;
  // Once a form has opened it stays. Its own write re-reads the expected item, which then no
  // longer takes a match or no longer has the match: that must not unmount the form before it
  // has reported the write and closed.
  const opened = useRef<
    | { reverse: Parameters<typeof ReverseForm>[0] }
    | { match: Parameters<typeof MatchForm>[0] }
    | null
  >(null);
  const subject = opened.current
    ? "match" in opened.current
      ? opened.current.match.occurrence
      : null
    : occurrence && !reversing && canMatch(occurrence)
      ? occurrence
      : null;
  // Transactions are read around the expected date, where its actual movement posts.
  const sources = useCashflowSources(
    subject
      ? { from: shiftDate(subject.localDate, -14), to: shiftDate(subject.localDate, 14) }
      : null,
  );
  const settled = useSettled(query);
  const sourcesSettled = useSettled(sources);
  if (!opened.current && settled && occurrence) {
    if (reversing) {
      if (match) opened.current = { reverse: { occurrence, match } };
    } else if (canMatch(occurrence) && sourcesSettled && sources.data)
      opened.current = {
        match: {
          occurrence,
          candidates: eligibleTransactions(occurrence, sources.data.transactions),
          truncated: sources.data.coverage.truncated,
        },
      };
  }
  const form = opened.current;
  return (
    <ReadState query={until(query, settled)}>
      <Stack.Screen options={{ title: "match" }} />
      {form ? (
        "match" in form ? (
          <MatchForm {...form.match} />
        ) : (
          <ReverseForm {...form.reverse} />
        )
      ) : occurrence && !reversing && canMatch(occurrence) ? (
        <ReadState query={until(sources, sourcesSettled)}>{null}</ReadState>
      ) : (
        <FinanceScreen title="Match">
          <Copy secondary>
            {occurrence
              ? reversing
                ? "This match is unavailable. It may already be reversed."
                : "This expected item cannot take a match."
              : "This expected item is unavailable."}
          </Copy>
        </FinanceScreen>
      )}
    </ReadState>
  );
}
