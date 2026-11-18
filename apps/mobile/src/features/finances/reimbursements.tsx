import { ApiClientError } from "@personal-os/api-client";
import type {
  FinanceReimbursement,
  FinanceReimbursementMatch,
  ReconcileFinanceReimbursementInput,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { Action, Actions, PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { TextRow } from "./account-editor";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { appliedRecord, confirmedRejection, parseAmount } from "./mutations";
import { financeLabel, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

type Correction = Extract<
  ReconcileFinanceReimbursementInput,
  { operation: "correct_expected" | "unmatch_credit" }
>;

const useReimbursements = () =>
  useFinanceRead(["reimbursements"], (api) => api.listFinanceReimbursements());
const currencyOf = (item: FinanceReimbursement) => item.sourceExpense?.currency;
const payerOf = (item: FinanceReimbursement) => item.payer ?? "Payer not set";
const attention = (item: FinanceReimbursement) =>
  item.status === "overdue" || item.status === "needs_input" ? ("attention" as const) : undefined;
const go = (params: Record<string, string>) =>
  router.push({ pathname: "/finance-reviews", params });

/** What the person still expects to recover, and what has been received against it. */
export function Reimbursements() {
  const query = useReimbursements();
  const items = query.data?.reimbursements ?? [];
  return (
    <FinanceScreen title="Reimbursements">
      <Stack.Screen options={{ title: "reimbursements" }} />
      <Copy secondary>Recorded receipts and what you still expect to recover.</Copy>
      <ReadState query={query}>
        <Card rows>
          {items.length ? (
            items.map((item) => (
              <FinanceRow
                key={item.id}
                title={payerOf(item)}
                subtitle={`${formatMoney(item.receivedAmount, currencyOf(item))} received of ${formatMoney(item.expectedAmount, currencyOf(item))}${item.dueDate ? ` · due ${formatLocalDate(item.dueDate)}` : ""}`}
                value={financeLabel(item.status)}
                valueTone={attention(item)}
                icon="receipt"
                onPress={() => go({ view: "reimbursement", id: item.id })}
              />
            ))
          ) : (
            <Copy secondary>No reimbursements outstanding.</Copy>
          )}
        </Card>
      </ReadState>
    </FinanceScreen>
  );
}

export function ReimbursementDetail({ id }: { id: string }) {
  const query = useReimbursements();
  const item = query.data?.reimbursements.find((entry) => entry.id === id);
  const money = (value: number) => formatMoney(value, item ? currencyOf(item) : null);
  const expense = item?.sourceExpense;
  return (
    <FinanceScreen title="Reimbursement">
      <Stack.Screen options={{ title: "reimbursement" }} />
      <SettingsAccentProvider workspace="finances">
        <ReadState query={query}>
          {item ? (
            <>
              <Metric
                label={payerOf(item)}
                value={money(Math.max(0, item.expectedAmount - item.receivedAmount))}
                hint={item.status === "cancelled" ? "Cancelled remainder" : "Still expected"}
              />
              <Card rows>
                <FinanceRow
                  centered
                  title="Status"
                  value={financeLabel(item.status)}
                  valueTone={attention(item)}
                  icon="attention"
                />
                <FinanceRow
                  centered
                  title="Expected"
                  value={money(item.expectedAmount)}
                  icon="finances"
                />
                <FinanceRow
                  centered
                  title="Received"
                  value={money(item.receivedAmount)}
                  icon="finances"
                />
                <FinanceRow
                  centered
                  title="Due"
                  value={item.dueDate ? formatLocalDate(item.dueDate) : "No due date"}
                  icon="calendar"
                />
                {expense ? (
                  <FinanceRow
                    centered
                    title={expense.merchant}
                    subtitle="Source expense"
                    icon="receipt"
                    onPress={() =>
                      router.push({
                        pathname: "/finance-transaction",
                        params: { id: expense.transactionId },
                      })
                    }
                  />
                ) : null}
              </Card>
              <Copy secondary>{item.rationale}</Copy>
              {item.status !== "cancelled" && (
                <Actions inset={false}>
                  <Action
                    label="Correct expectation"
                    onPress={() => go({ view: "reimbursement-correct", id: item.id })}
                  />
                </Actions>
              )}
              <Section title="Receipts">
                {item.matches.length ? (
                  item.matches.map((match, index) => (
                    <Card key={match.id}>
                      <FinanceRow
                        centered
                        title={money(match.amount)}
                        subtitle={`${match.rationale} · ${new Date(match.createdAt).toLocaleDateString()}`}
                        icon="receipt"
                      />
                      {/* A cancelled claim cannot be corrected, so no correction is offered. */}
                      {item.status !== "cancelled" && (
                        <Actions inset={false}>
                          <Action
                            label="Remove receipt match"
                            accessibilityLabel={`Remove receipt match ${index + 1}`}
                            destructive
                            onPress={() =>
                              go({ view: "reimbursement-correct", id: item.id, match: match.id })
                            }
                          />
                        </Actions>
                      )}
                    </Card>
                  ))
                ) : (
                  <Copy secondary>No receipts recorded yet.</Copy>
                )}
              </Section>
              {item.corrections?.length ? (
                <Section title="Corrections">
                  <Card rows>
                    {item.corrections.map((entry) => (
                      <FinanceRow
                        key={entry.id}
                        title={
                          entry.operation === "unmatch_credit"
                            ? "Receipt match removed"
                            : "Expectation corrected"
                        }
                        subtitle={entry.rationale}
                        value={new Date(entry.recordedAt).toLocaleDateString()}
                        icon="history"
                      />
                    ))}
                  </Card>
                </Section>
              ) : null}
            </>
          ) : (
            <Copy secondary>This reimbursement is unavailable.</Copy>
          )}
        </ReadState>
      </SettingsAccentProvider>
    </FinanceScreen>
  );
}

/** Loads the claim, then hands the form the revision its correction will be checked against. */
export function ReimbursementCorrection({ id, matchId }: { id: string; matchId?: string }) {
  const query = useReimbursements();
  const record = query.data?.reimbursements.find((entry) => entry.id === id);
  const match = matchId ? record?.matches.find((entry) => entry.id === matchId) : undefined;
  // Once open, the form keeps the claim it opened with: a correction that landed without an
  // answer can remove the very receipt being corrected, and the draft must not vanish with it.
  const opened = useRef<{ record: FinanceReimbursement; match?: FinanceReimbursementMatch }>(null);
  if (!opened.current && record && record.status !== "cancelled" && (!matchId || match))
    opened.current = { record, match };
  if (opened.current)
    return <CorrectionForm record={opened.current.record} match={opened.current.match} />;
  return (
    <FinanceScreen title="Correction">
      <Stack.Screen options={{ title: "correction" }} />
      <ReadState query={query}>
        <Copy secondary>This correction is unavailable.</Copy>
      </ReadState>
    </FinanceScreen>
  );
}

function LongText({
  label,
  value,
  onChangeText,
  editable,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  placeholder: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, paddingVertical: 12 }}>
      <Text style={{ color: t.secondary, fontSize: 13 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline
        maxLength={1000}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={t.secondary}
        style={{ color: t.ink, fontSize: 17, minHeight: 66, padding: 0, textAlignVertical: "top" }}
      />
    </View>
  );
}

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const cents = (value: number) => Math.round(value * 100);

/**
 * A correction is one request with one key. Until the server answers it, the same request
 * is the only thing that can be sent again; a definite rejection is the only thing that
 * frees the form to make a different one.
 */
function CorrectionForm({
  record,
  match,
}: {
  record: FinanceReimbursement;
  match: FinanceReimbursementMatch | undefined;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  const [snapshot] = useState(record);
  const [amount, setAmount] = useState(record.expectedAmount.toFixed(2));
  const [payer, setPayer] = useState(record.payer ?? "");
  const [dueDate, setDueDate] = useState(record.dueDate ?? "");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<Correction | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentOwner.current === owner;
  const locked = pending || submitted || uncertain;
  const set = (write: (value: string) => void) => (value: string) => {
    if (locked) return;
    write(value);
    setEdited(true);
  };
  const currency = currencyOf(snapshot);
  const parsed = parseAmount(amount);
  const amountValid = parsed !== undefined && cents(parsed) >= cents(snapshot.receivedAmount);
  const due = dueDate.trim();
  const dueValid = !due || validDate(due);
  const valid = !!reason.trim() && !!summary.trim() && (match ? true : amountValid && dueValid);

  function build(): Correction | null {
    const common = {
      idempotencyKey: randomUUID(),
      reimbursementId: snapshot.id,
      expectedRevision: snapshot.revision,
      rationale: reason.trim(),
    };
    if (match)
      return {
        ...common,
        operation: "unmatch_credit",
        matchId: match.id,
        evidence: { summary: summary.trim(), sourceRefs: match.evidence.sourceRefs },
      };
    if (parsed === undefined) return null;
    return {
      ...common,
      operation: "correct_expected",
      expectedAmount: parsed,
      payer: payer.trim() || null,
      dueDate: due || null,
      evidence: { summary: summary.trim(), sourceRefs: snapshot.evidence.sourceRefs },
    };
  }
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });

  async function save() {
    if (lock.current || submitted || (!attempt.current && (!edited || !valid))) return;
    attempt.current ??= build();
    const request = attempt.current;
    if (!request) return;
    lock.current = true;
    setPending(true);
    const retrying = uncertain;
    const id = toast.loading("Saving reimbursement correction…");
    try {
      const response = await api.reconcileFinanceReimbursement(request);
      const saved = appliedRecord<FinanceReimbursement>(response);
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      setUncertain(false);
      if (saved?.id !== snapshot.id) {
        setSubmitted(true);
        toast.info(
          "status" in response && response.status === "needs_input"
            ? "Not applied. nohmi needs an answer from you before this correction can go ahead."
            : "Submitted for review. The correction has not been applied.",
          { id },
        );
        return;
      }
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success("Reimbursement correction saved", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      const conflict = error instanceof ApiClientError && error.status === 409;
      if (conflict && retrying && /already in progress/i.test(error.message)) {
        // The first send is still running on the server; its outcome stays unknown.
        toast.error(
          "The earlier attempt is still being processed. Wait a moment, then retry the same correction.",
          { id },
        );
      } else if (conflict && retrying && /previously failed/i.test(error.message)) {
        // The server recorded the first send as failed and retired its key: nothing was
        // saved, and the same draft can go again as a new request.
        attempt.current = null;
        setUncertain(false);
        toast.error(
          "Nothing was saved. The earlier attempt failed on the server. Save again to send your draft as a new correction.",
          { id },
        );
      } else if (retrying && confirmedRejection(error)) {
        // Refusing the retry says nothing about the first send, which may have been saved.
        toast.error(
          "This retry was refused, so the earlier attempt is still unconfirmed. Check the reimbursement before sending anything else.",
          { id },
        );
      } else if (confirmedRejection(error)) {
        attempt.current = null;
        setUncertain(false);
        toast.error(
          conflict
            ? "Nothing was saved. This reimbursement changed. Close and reopen it to see the latest; your draft is still here."
            : "Couldn’t save this correction. Nothing was changed; your draft is still here.",
          { id },
        );
      } else {
        setUncertain(true);
        toast.error(
          "Couldn’t confirm the correction. Retry to send the same correction again; it will not be applied twice.",
          { id },
        );
      }
      void refresh();
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  const close = () => {
    if (!edited || submitted) return router.back();
    if (uncertain)
      return confirmChoice({
        title: "Leave this correction?",
        message:
          "The last save may already have gone through. Check the reimbursement before correcting it again.",
        cancel: "Keep editing",
        accept: "Leave",
        destructive: true,
        onAccept: () => {
          void refresh();
          router.back();
        },
      });
    confirmChoice({
      title: "Discard changes?",
      message: "The correction has not been saved.",
      cancel: "Keep editing",
      accept: "Discard",
      destructive: true,
      onAccept: () => router.back(),
    });
  };

  const title = match ? "remove receipt match" : "correct expectation";
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title,
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited && !submitted ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <SettingsAccentProvider workspace="finances">
        <FinanceScreen title={payerOf(snapshot)}>
          <Copy secondary>
            {match
              ? `Remove the link to a ${formatMoney(match.amount, currency)} credit. The credit stays in your ledger and the correction is kept in this reimbursement's history.`
              : "Correct the existing claim. This does not create a new expense or bank transaction."}
          </Copy>
          <Card rows>
            <PaddedSurfaceRows>
              {!match && (
                <>
                  <TextRow
                    label="Expected amount"
                    value={amount}
                    onChangeText={set(setAmount)}
                    editable={!locked}
                    keyboardType="decimal-pad"
                    placeholder="80.00"
                    correction={
                      amountValid
                        ? undefined
                        : `Enter an amount of at least ${formatMoney(snapshot.receivedAmount, currency)}, the amount already received.`
                    }
                  />
                  <TextRow
                    label="Payer"
                    value={payer}
                    onChangeText={set(setPayer)}
                    editable={!locked}
                    maxLength={240}
                    placeholder="Who owes you"
                  />
                  <TextRow
                    label="Due date"
                    value={dueDate}
                    onChangeText={set(setDueDate)}
                    editable={!locked}
                    placeholder="2026-12-31"
                    correction={
                      dueValid ? undefined : "Use a date such as 2026-12-31, or leave it blank."
                    }
                  />
                </>
              )}
              <LongText
                label="Reason for correction"
                value={reason}
                onChangeText={set(setReason)}
                editable={!locked}
                placeholder="Why the record needs to change"
              />
              <LongText
                label="Supporting evidence"
                value={summary}
                onChangeText={set(setSummary)}
                editable={!locked}
                placeholder="What shows this is right"
              />
            </PaddedSurfaceRows>
          </Card>
          <View style={{ height: 80 }} />
        </FinanceScreen>
      </SettingsAccentProvider>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        label={
          uncertain ? "Retry same correction" : match ? "Remove receipt match" : "Save correction"
        }
        disabled={pending || submitted || (!uncertain && (!edited || !valid))}
        onPress={() => void save()}
      />
    </View>
  );
}
