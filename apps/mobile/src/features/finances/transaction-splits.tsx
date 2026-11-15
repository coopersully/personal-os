import { ApiClientError } from "@personal-os/api-client";
import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EntityPicker } from "../../components/forms/entity-picker";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { TextRow } from "./account-editor";
import { categoryIcon, categoryLabel } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { appliedTransaction, confirmedRejection, parseAmount } from "./mutations";
import { formatMoney } from "./presentation";
import {
  centsText,
  initialSplitParts,
  maxSplitParts,
  type SplitPart,
  type SplitTreatment,
  splitBalance,
  splitRationale,
} from "./splits";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

const treatments = [
  { value: "personal", label: "Mine" },
  { value: "reimbursable", label: "Reimbursable" },
] as const;

/**
 * Divides one posted transaction across categories. The parts are a draft until the server
 * confirms them: the transaction itself is only ever shown from what the server returned.
 */
export function TransactionSplitForm({ record }: { record: FinanceTransaction }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  // Keep the revision the draft was made from; a background refresh never rewrites the parts.
  const [snapshot] = useState(record);
  const [parts, setParts] = useState<SplitPart[]>(() => initialSplitParts(record));
  const [choosing, setChoosing] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // A save whose outcome is unknown may have replaced the splits already.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const lock = useRef(false);
  const nextKey = useRef(2);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories());
  const current = () => active.current && currentOwner.current === owner;
  const locked = pending || submitted;
  const balance = splitBalance(parts, snapshot.amount);
  const money = (cents: number) => formatMoney(Math.abs(cents) / 100, snapshot.currencyCode);

  const change = (key: string, patch: Partial<SplitPart>) => {
    if (lock.current || submitted) return;
    setParts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setEdited(true);
  };
  const add = () => {
    if (lock.current || submitted || parts.length >= maxSplitParts) return;
    const key = `new-${nextKey.current}`;
    nextKey.current += 1;
    // A new part starts with whatever is still unassigned, which is the usual next entry.
    const amount = balance.remainingCents > 0 ? centsText(balance.remainingCents) : "";
    setParts((rows) => [
      ...rows,
      { key, amount, categoryId: null, rationale: splitRationale, treatment: "personal" },
    ]);
    setEdited(true);
  };
  const remove = (key: string) => {
    if (lock.current || submitted || parts.length < 2) return;
    setParts((rows) => rows.filter((row) => row.key !== key));
    if (choosing === key) setChoosing(null);
    setEdited(true);
  };
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });
  const close = () => {
    if (!edited || submitted) return router.back();
    if (unconfirmed)
      return Alert.alert(
        "Leave these splits?",
        "The last save may already have gone through. Check the transaction before splitting it again.",
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
    Alert.alert("Discard changes?", "The splits have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  async function save() {
    if (lock.current || !edited || submitted || !balance.balanced) return;
    const allocations = parts.flatMap((part) => {
      const amount = parseAmount(part.amount);
      return amount === undefined || !part.categoryId
        ? []
        : [
            {
              amount,
              categoryId: part.categoryId,
              rationale: part.rationale,
              treatment: part.treatment,
            },
          ];
    });
    // `balanced` already requires every part to be complete; never send a shorter list.
    if (allocations.length !== parts.length) return;
    lock.current = true;
    setPending(true);
    setChoosing(null);
    const id = toast.loading("Saving splits…");
    try {
      const result = await api.setFinanceTransactionBreakdown(snapshot.id, {
        allocations,
        expectedTransactionUpdatedAt: snapshot.updatedAt,
        rationale: splitRationale,
      });
      if (!current()) return void toast.dismiss(id);
      if (!appliedTransaction(result)) {
        setSubmitted(true);
        toast.info("Submitted for review. The splits have not been applied.", { id });
        return;
      }
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success(allocations.length > 1 ? "Splits saved" : "Saved as one category", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error(
          "Nothing was saved. This transaction changed, or a reimbursement depends on its splits. Close and reopen it to see the latest; your draft is still here.",
          { id },
        );
      } else if (confirmedRejection(error)) {
        toast.error("Couldn’t save these splits. Nothing was changed; your draft is still here.", {
          id,
        });
      } else {
        setUnconfirmed(true);
        toast.error(
          "Couldn’t confirm the save. Check the transaction’s splits before trying again; your draft is still here.",
          { id },
        );
      }
      // Rejected or unknown, the transaction on the page behind may be out of date.
      void refresh();
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  const names = new Map((categories.data ?? []).map((item) => [item.id, item.name]));
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "split transaction",
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited && !submitted ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <SettingsAccentProvider workspace="finances">
        <FinanceScreen title={record.merchant}>
          <Metric
            label={balance.remainingCents < 0 ? "Over-assigned" : "Left to assign"}
            value={money(balance.remainingCents)}
            hint={
              balance.remainingCents === 0
                ? "Every cent is assigned."
                : `Of ${money(Math.round(snapshot.amount * 100))}`
            }
          />
          <ReadState query={categories}>
            {parts.map((part, index) => {
              const number = index + 1;
              const name = part.categoryId ? names.get(part.categoryId) : undefined;
              const typed = part.amount.trim();
              return (
                <Section key={part.key} title={`Part ${number}`}>
                  <Card rows>
                    <FinanceRow
                      centered
                      title="Category"
                      icon={categoryIcon(name ?? "Category")}
                      value={
                        name ? categoryLabel(name) : part.categoryId ? "Unavailable" : "Choose"
                      }
                      valueTone={part.categoryId ? undefined : "attention"}
                      accessibilityHint={`Part ${number}. Choose a category.`}
                      onPress={
                        locked
                          ? undefined
                          : () => setChoosing(choosing === part.key ? null : part.key)
                      }
                    />
                    {choosing === part.key && (
                      <EntityPicker
                        title="Categories"
                        icon="grid"
                        value={part.categoryId}
                        options={(categories.data ?? []).map((item) => ({
                          label: categoryLabel(item.name),
                          icon: categoryIcon(item.name),
                          value: item.id,
                        }))}
                        onChange={(value) => {
                          if (value) change(part.key, { categoryId: value });
                        }}
                        onClose={() => setChoosing(null)}
                      />
                    )}
                    <PaddedSurfaceRows>
                      <TextRow
                        label="Amount"
                        accessibilityLabel={`Part ${number} amount`}
                        value={part.amount}
                        onChangeText={(value) => change(part.key, { amount: value })}
                        editable={!locked}
                        correction={
                          typed && parseAmount(typed) === undefined
                            ? "Enter an amount above zero, such as 12.50."
                            : undefined
                        }
                        keyboardType="decimal-pad"
                        placeholder="Required"
                      />
                      <EnumChoice
                        label="Treatment"
                        value={part.treatment}
                        disabled={locked}
                        options={treatments}
                        onChange={(value) =>
                          change(part.key, { treatment: value as SplitTreatment })
                        }
                      />
                    </PaddedSurfaceRows>
                    {parts.length > 1 && (
                      <Actions inset={false}>
                        <Action
                          label="Remove part"
                          accessibilityLabel={`Remove part ${number}`}
                          destructive
                          disabled={locked}
                          onPress={() => remove(part.key)}
                        />
                      </Actions>
                    )}
                  </Card>
                </Section>
              );
            })}
            <Actions inset={false}>
              <Action
                label="Add part"
                disabled={locked || parts.length >= maxSplitParts}
                onPress={add}
              />
            </Actions>
            {balance.duplicate && (
              <Copy>
                Two parts use the same category and treatment. Combine them into one part.
              </Copy>
            )}
          </ReadState>
          <Copy secondary>
            The parts must add up to the transaction amount before you can save. Mark a part
            Reimbursable only when someone will repay it. One part alone assigns the whole
            transaction to its category.
          </Copy>
          <View style={{ height: 80 }} />
        </FinanceScreen>
      </SettingsAccentProvider>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        label="Save splits"
        disabled={!edited || locked || !balance.balanced}
        onPress={() => void save()}
      />
    </View>
  );
}
