import type { FinanceBudget } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { AppToaster } from "../../components/app-toaster";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { Icon } from "../../components/icons";
import { useTheme, workspaceColor } from "../../theme";
import { categoryIcon } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { formatMoney } from "./presentation";
import { Transactions } from "./spending";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function useBudgetCategory() {
  const { id, month } = useLocalSearchParams<{ id: string; month: string }>();
  const valid =
    typeof month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
    typeof id === "string" &&
    !!id.trim();
  const query = useFinanceRead(
    ["budget-status", month],
    (api) => api.getFinanceBudgetStatus(month),
    valid,
  );
  return { query, item: query.data?.find((item) => item.budget.id === id), valid };
}
export function FinanceBudgetCategoryScreen() {
  const { query, item, valid } = useBudgetCategory();
  const [editing, setEditing] = useState(false);
  if (!valid)
    return (
      <FinanceScreen title="Category budget">
        <Copy>Budget not found.</Copy>
      </FinanceScreen>
    );
  return (
    <FinanceScreen title={item?.budget.category ?? "Category budget"}>
      <ReadState query={query}>
        {item ? (
          <>
            <Card>
              {editing ? (
                <LimitForm
                  key={item.budget.id}
                  record={item.budget}
                  onDone={() => setEditing(false)}
                />
              ) : (
                <FinanceRow
                  centered
                  title="Monthly limit"
                  icon={categoryIcon(item.budget.category)}
                  value={formatMoney(item.budget.limit, "USD")}
                  valueTone={item.budget.limit <= 0 ? "incorrect" : undefined}
                  onPress={() => setEditing(true)}
                />
              )}
              <Copy>
                {formatMoney(item.spent, "USD")} spent · {monthLabel(item.budget.month)}
              </Copy>
              <Copy secondary>
                Posted transactions only. Amounts show the full transaction; splits and refunds
                affect this category’s total.
              </Copy>
            </Card>
            <Transactions budgetId={item.budget.id} />
          </>
        ) : !query.isPending ? (
          <Copy>Budget not found.</Copy>
        ) : null}
      </ReadState>
    </FinanceScreen>
  );
}
function LimitForm({ record, onDone }: { record: FinanceBudget; onDone?: () => void }) {
  const finish = onDone ?? (() => router.back());
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [snapshot] = useState(record);
  const [limit, setLimit] = useState(String(record.limit));
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
  const close = () =>
    edited && !submitted
      ? Alert.alert("Discard changes?", "Your unsaved limit will be lost.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: finish },
        ])
      : finish();
  async function save() {
    if (lock.current || submitted || !edited) return;
    if (
      !/^\d+(\.\d{1,2})?$/.test(limit.trim()) ||
      !Number.isFinite(Number(limit)) ||
      Number(limit) <= 0
    ) {
      toast.error("Enter a limit greater than $0, with up to two decimal places.");
      return;
    }
    lock.current = true;
    setPending(true);
    const id = toast.loading("Saving budget limit…");
    try {
      // Recheck before submitting so a stale editor does not silently replace a newer limit.
      const status = await api.getFinanceBudgetStatus(snapshot.month);
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      const latest = status.find((item) => item.budget.id === snapshot.id)?.budget;
      if (!latest || latest.updatedAt !== snapshot.updatedAt) {
        client.setQueryData(["finances", owner, "budget-status", snapshot.month], status);
        toast.error("This limit changed elsewhere. Close and reopen it before saving.", { id });
        return;
      }
      const result = await api.createFinanceBudget({
        budgetId: snapshot.id,
        expectedBudgetUpdatedAt: snapshot.updatedAt,
        category: snapshot.category,
        month: snapshot.month,
        limit: Number(limit),
        ...(snapshot.bucketId ? { bucketId: snapshot.bucketId } : {}),
      });
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      if ("status" in result && result.status !== "applied") {
        setSubmitted(true);
        toast.info(
          result.status === "needs_input"
            ? "More information is needed. The limit has not changed."
            : "Submitted for approval. The limit has not changed.",
          { id },
        );
        return;
      }
      setSubmitted(true);
      await client.invalidateQueries({ queryKey: ["finances", owner, "budget-status"] });
      await client.invalidateQueries({ queryKey: ["finances", owner, "budget"] });
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      toast.success("Budget limit updated", { id });
      finish();
    } catch {
      if (active.current && currentOwner.current === owner)
        toast.error("Couldn’t confirm the save. Check the current limit before retrying.", { id });
      else toast.dismiss(id);
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  const invalid =
    edited &&
    (!/^\d+(\.\d{1,2})?$/.test(limit.trim()) ||
      !Number.isFinite(Number(limit)) ||
      Number(limit) <= 0);
  if (onDone)
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name={categoryIcon(snapshot.category)} color={workspaceColor(t, "finances")} />
          <Text style={{ color: t.ink, fontSize: 16, flex: 1 }}>Monthly limit</Text>
          <Text style={{ color: invalid ? t.destructive : t.ink }}>$</Text>
          <TextInput
            accessibilityLabel="Monthly budget limit"
            value={limit}
            onChangeText={(value) => {
              setLimit(value);
              setEdited(true);
            }}
            editable={!pending && !submitted}
            keyboardType="decimal-pad"
            placeholder="600.00"
            placeholderTextColor={t.secondary}
            style={{
              color: invalid ? t.destructive : t.ink,
              fontSize: 16,
              minHeight: 44,
              minWidth: 72,
              textAlign: "right",
            }}
          />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={close}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: t.ink }}>{edited && !submitted ? "Cancel" : "Close"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save budget limit"
            disabled={!edited || pending || submitted || invalid}
            onPress={() => void save()}
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: !edited || pending || submitted || invalid ? 0.5 : 1,
            }}
          >
            <Icon name="save" color={workspaceColor(t, "finances")} />
          </Pressable>
        </View>
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited && !submitted ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <FinanceScreen title={snapshot.category}>
        <Card>
          <Copy secondary>{monthLabel(snapshot.month)} · Monthly limit</Copy>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: t.ink, fontSize: 24 }}>$</Text>
            <TextInput
              accessibilityLabel="Monthly budget limit"
              value={limit}
              onChangeText={(value) => {
                setLimit(value);
                setEdited(true);
              }}
              keyboardType="decimal-pad"
              editable={!pending && !submitted}
              placeholder="600.00"
              placeholderTextColor={t.secondary}
              style={{
                color: invalid ? t.destructive : t.ink,
                fontSize: 24,
                flex: 1,
                minHeight: 44,
              }}
            />
          </View>
        </Card>
      </FinanceScreen>
      <FormSave
        workspace="finances"
        disabled={!edited || pending || submitted}
        onPress={() => void save()}
      />
    </View>
  );
}
export function FinanceBudgetEditor() {
  const { query, item, valid } = useBudgetCategory();
  if (!valid)
    return (
      <FinanceScreen title="Category budget">
        <Copy>Budget not found.</Copy>
      </FinanceScreen>
    );
  return (
    <View style={{ flex: 1 }}>
      <ReadState query={query}>
        {item ? (
          <LimitForm key={item.budget.id} record={item.budget} />
        ) : (
          <Copy>Budget not found.</Copy>
        )}
      </ReadState>
      <AppToaster editor />
    </View>
  );
}
