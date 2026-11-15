import type { FinanceCategory } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EntityPicker } from "../../components/forms/entity-picker";
import { EnumChoice } from "../../components/forms/enum-choice";
import { PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import { CategoryCreate } from "./category-create";
import { categoryIcon, categoryLabel } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import {
  appliedTransaction,
  confirmedRejection,
  localToday,
  matchesAttempt,
  parseAmount,
  type TransactionAttempt,
} from "./mutations";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

/** Everything an add sends; any difference from it is an edit the person made afterwards. */
type SentTransaction = TransactionAttempt & {
  direction: "expense" | "income";
  category: string | null;
  notes: string | null;
};

const directions = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
] as const;

/** Adds a transaction a person records themselves, to an account they maintain themselves. */
export function TransactionCreateForm({ accountId: preset }: { accountId?: string }) {
  const { api, owner, timezone } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const keyboardOffset = useFormKeyboardOffset();
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories());
  // The server removes a transaction only from a manual account, so only those can receive one.
  const manual = accounts.data?.accounts.filter((item) => item.provider === "manual") ?? [];
  const [merchant, setMerchant] = useState("");
  const [amountText, setAmountText] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [date, setDate] = useState<string | null>(() => (timezone ? localToday(timezone) : null));
  const [chosenAccount, setChosenAccount] = useState<string | null>(preset ?? null);
  const [category, setCategory] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const lock = useRef(false);
  const unconfirmed = useRef<SentTransaction | null>(null);
  const added = useRef(false);
  const latestSave = useRef<(replaces?: string | number) => Promise<void>>(async () => undefined);
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
  const edit = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      set(value);
      setEdited(true);
    };
  };
  // A lone manual account is the only possible answer; with several the person chooses.
  const accountId =
    manual.find((item) => item.id === chosenAccount)?.id ??
    (manual.length === 1 ? manual[0]?.id : undefined);
  const amount = parseAmount(amountText);
  const invalidAmount = !!amountText.trim() && amount === undefined;
  const invalid = !merchant.trim() || amount === undefined || !date || !accountId;
  const locked = pending || submitted;
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });
  const close = () => {
    if (!edited || submitted) return router.back();
    // An unconfirmed add may be in the ledger: never say it was not added, and re-read on the way out.
    if (unconfirmed.current)
      return Alert.alert(
        "Leave this transaction?",
        "The last attempt may already have added it. Check Transactions before adding it again.",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              void refresh();
              router.back();
            },
          },
        ],
      );
    Alert.alert("Discard this transaction?", "It has not been added.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  /** Looks for the record an earlier, unconfirmed add would have left on that account and day. */
  async function alreadyRecorded(attempt: TransactionAttempt) {
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await api.listFinanceTransactions({
        accountId: attempt.accountId,
        from: attempt.date,
        to: attempt.date,
        limit: 200,
        cursor,
      });
      if (result.items.some((item) => matchesAttempt(item, attempt))) return true;
      if (!result.nextCursor) return false;
      cursor = result.nextCursor;
    }
    return false;
  }

  /** `replaces` is the toast whose action asked for this save; the progress takes its place. */
  async function save(replaces?: string | number) {
    // A toast action can outlive the form or a confirmed add; neither may write again.
    if (!active.current || added.current) return void toast.dismiss(replaces);
    if (lock.current || !edited || submitted || amount === undefined || !date || !accountId) return;
    if (!merchant.trim()) return;
    const attempt: SentTransaction = {
      accountId,
      amount,
      date,
      direction,
      merchant: merchant.trim(),
      category,
      notes: notes.trim() || null,
    };
    lock.current = true;
    setPending(true);
    const id = toast.loading(
      "Adding transaction…",
      replaces === undefined ? undefined : { id: replaces },
    );
    try {
      const earlier = unconfirmed.current;
      if (earlier) {
        // Adding has no retry key: look for the earlier attempt before writing again.
        let recorded: boolean;
        try {
          recorded = await alreadyRecorded(earlier);
        } catch {
          if (current())
            toast.error("Couldn’t check whether the transaction was added. Try again shortly.", {
              id,
            });
          else toast.dismiss(id);
          return;
        }
        if (!current()) return void toast.dismiss(id);
        if (recorded) {
          // The earlier attempt's outcome is now known, whatever happens to this draft.
          unconfirmed.current = null;
          await refresh();
          if (!current()) return void toast.dismiss(id);
          if (JSON.stringify(attempt) !== JSON.stringify(earlier)) {
            // Any field changed since, category and notes included: closing would drop that edit.
            toast.info(
              `Your earlier attempt already added “${earlier.merchant}”. This changed draft has not been added.`,
              // The action hands its own toast to the save, so it cannot be pressed twice.
              { id, action: { label: "Add anyway", onClick: () => void latestSave.current(id) } },
            );
            return;
          }
          toast.info(
            "A matching transaction is already recorded on that account and date, so nothing was added again.",
            { id },
          );
          router.back();
          return;
        }
        unconfirmed.current = null;
      }
      let result: Awaited<ReturnType<typeof api.createFinanceTransaction>>;
      try {
        result = await api.createFinanceTransaction({ ...attempt, categoryConfidence: null });
      } catch (error) {
        if (!current()) return void toast.dismiss(id);
        unconfirmed.current = confirmedRejection(error) ? null : attempt;
        toast.error(
          unconfirmed.current
            ? "Couldn’t confirm the transaction was added. Your draft is still here; saving again checks the account first."
            : "Couldn’t add this transaction. Your draft is still here.",
          { id },
        );
        return;
      }
      if (!current()) return void toast.dismiss(id);
      if (!appliedTransaction(result)) {
        setSubmitted(true);
        toast.info(
          "status" in result && result.status === "needs_input"
            ? "More input is needed. The transaction has not been added."
            : "Submitted for review. The transaction has not been added.",
          { id },
        );
        return;
      }
      // Confirmed: nothing on this form may add it a second time.
      added.current = true;
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success("Transaction added", { id });
      router.back();
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  // The toast's action outlives this render; it must add the draft as it is when pressed.
  latestSave.current = save;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          // The page heading below names the screen; the bar carries only dismissal.
          title: "",
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited && !submitted ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <FinanceScreen title="Add transaction">
        <ReadState query={accounts}>
          {manual.length === 0 ? (
            <Card>
              <Copy>
                A transaction you add yourself belongs to a manual account. Add a manual account in
                Accounts first.
              </Copy>
            </Card>
          ) : (
            <>
              <Card rows>
                <PaddedSurfaceRows>
                  <TextRow
                    label="Merchant"
                    value={merchant}
                    onChangeText={edit(setMerchant)}
                    editable={!locked}
                    maxLength={240}
                    placeholder="Corner bakery"
                  />
                  <TextRow
                    label="Amount"
                    value={amountText}
                    onChangeText={edit(setAmountText)}
                    editable={!locked}
                    correction={
                      invalidAmount ? "Enter an amount above zero, such as 12.50." : undefined
                    }
                    keyboardType="decimal-pad"
                    placeholder="12.50"
                  />
                  <EnumChoice
                    label="Type"
                    value={direction}
                    disabled={locked}
                    options={directions}
                    onChange={(value) => edit(setDirection)(value as "expense" | "income")}
                  />
                  <EnumChoice
                    label="Account"
                    value={accountId ?? null}
                    valueLabel={accountId ? undefined : "Choose"}
                    disabled={locked || manual.length === 1}
                    options={manual.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={edit(setChosenAccount)}
                  />
                  <SettingsAccentProvider workspace="finances">
                    <DateField
                      label="Date"
                      dateOnly
                      value={date}
                      onChange={(value) => {
                        if (!locked) edit(setDate)(value ? value.slice(0, 10) : null);
                      }}
                    />
                  </SettingsAccentProvider>
                </PaddedSurfaceRows>
              </Card>
              <Card rows>
                <FinanceRow
                  centered
                  title="Category"
                  icon={categoryIcon(category ?? "Uncategorized")}
                  value={category ? categoryLabel(category) : "Chosen by nohmi"}
                  onPress={locked ? undefined : () => setChoosing(true)}
                />
                {choosing && (
                  <ReadState query={categories}>
                    <EntityPicker
                      title="Categories"
                      icon="grid"
                      value={category}
                      options={[
                        { label: "Chosen by nohmi", value: null, icon: categoryIcon("Category") },
                        ...(categories.data ?? []).map((item) => ({
                          label: categoryLabel(item.name),
                          icon: categoryIcon(item.name),
                          value: item.name,
                        })),
                      ]}
                      onChange={(value) => {
                        if (!locked) edit(setCategory)(value);
                      }}
                      onClose={() => setChoosing(false)}
                    />
                  </ReadState>
                )}
                {categories.data && (
                  <CategoryCreate
                    categories={categories.data}
                    disabled={locked}
                    onCreated={(created: FinanceCategory) => edit(setCategory)(created.name)}
                  />
                )}
              </Card>
              <Section title="Notes">
                <Card>
                  <TextInput
                    accessibilityLabel="Notes"
                    editable={!locked}
                    multiline
                    maxLength={4000}
                    placeholder="Bread and coffee for the team breakfast."
                    placeholderTextColor={t.secondary}
                    value={notes}
                    onChangeText={edit(setNotes)}
                    style={{ minHeight: 100, color: t.ink, fontSize: 16, textAlignVertical: "top" }}
                  />
                </Card>
              </Section>
              {!timezone && <Copy>Set your account timezone in Settings to choose the date.</Copy>}
              <Copy secondary>
                Merchant, Amount, Account and Date are required. Leave Category to nohmi and it
                chooses one from the merchant.
              </Copy>
            </>
          )}
        </ReadState>
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        label="Add transaction"
        disabled={!edited || locked || invalid}
        onPress={() => void save()}
      />
    </View>
  );
}
