import { ApiClientError } from "@personal-os/api-client";
import type { FinanceGoal } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import { useFinance, useFinanceRead } from "./data";
import { parseProgressCents } from "./goal-progress";
import { confirmedRejection, localToday } from "./mutations";
import { Card, Copy, FinanceScreen, ReadState } from "./ui";

function ProgressForm({ goal }: { goal: FinanceGoal }) {
  const { api, owner, timezone } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  // The statement applies to the version that was open; a refresh never moves it.
  const [snapshot] = useState(goal);
  const today = timezone ? localToday(timezone) : null;
  const [amount, setAmount] = useState("");
  // A goal keeps one currency: offer the one its last statement used.
  const [currency, setCurrency] = useState(snapshot.planningEvidence?.currencyCode ?? "");
  const [asOf, setAsOf] = useState<string | null>(today);
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
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
  const cents = parseProgressCents(amount);
  const invalidAmount = !!amount.trim() && cents === undefined;
  const invalidCurrency = !!currency && !/^[A-Z]{3}$/.test(currency);
  const futureDate = !!asOf && !!today && asOf > today;
  const invalid =
    cents === undefined || !/^[A-Z]{3}$/.test(currency) || !asOf || !today || futureDate;
  const close = () =>
    edited
      ? Alert.alert("Discard changes?", "Your progress statement has not been recorded.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ])
      : router.back();
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });

  async function save() {
    if (lock.current || !edited || invalid || cents === undefined || !asOf) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading("Recording goal progress…");
    const statement = {
      goalId: snapshot.id,
      expectedVersion: snapshot.version,
      progressAmountCents: cents,
      currencyCode: currency,
      asOf,
    };
    const payload = JSON.stringify(statement);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    try {
      const result = await api.manageFinanceGoal({
        operation: "confirm_progress",
        ...statement,
        idempotencyKey: attempt.current.key,
      });
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      if (result.outcome !== "completed") {
        if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
        void refresh();
        return;
      }
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success("Goal progress confirmed", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (confirmedRejection(error)) attempt.current = null;
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "This goal changed elsewhere. Close and reopen it to confirm progress for the latest version."
          : confirmedRejection(error)
            ? "Couldn’t record this progress. Check the amount, currency and date; your entries are still here."
            : "Couldn’t confirm the progress was recorded. Your entries are still here. Check the goal before retrying.",
        { id },
      );
      // Rejected or unknown, the cached goal may be stale: reopening must show the latest.
      void refresh();
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          // The page heading below names the screen; the bar carries only dismissal.
          title: "",
          gestureEnabled: false,
          headerBackVisible: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            onPress: close,
            disabled: pending,
          }),
        }}
      />
      <FinanceScreen title="Confirm progress">
        <Copy secondary>{snapshot.name}</Copy>
        <Card rows>
          <PaddedSurfaceRows>
            <TextRow
              label="Amount"
              value={amount}
              onChangeText={edit(setAmount)}
              editable={!pending}
              correction={
                invalidAmount ? "Enter an amount such as 1250.00, up to 21,474,836.47." : undefined
              }
              keyboardType="decimal-pad"
              placeholder="Required"
            />
            <TextRow
              label="Currency"
              value={currency}
              onChangeText={(value) => edit(setCurrency)(value.toUpperCase())}
              editable={!pending}
              correction={invalidCurrency ? "Use a three-letter code such as USD." : undefined}
              maxLength={3}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Required"
            />
            <SettingsAccentProvider workspace="finances">
              <DateField
                label="As of"
                dateOnly
                value={asOf}
                onChange={(value) => {
                  if (!lock.current) edit(setAsOf)(value ? value.slice(0, 10) : null);
                }}
              />
            </SettingsAccentProvider>
          </PaddedSurfaceRows>
        </Card>
        {futureDate && <Copy>The progress date cannot be in the future.</Copy>}
        {!timezone && <Copy>Set your account timezone in Settings to choose the date.</Copy>}
        <Copy secondary>
          Amount, Currency and As of are required. By saving, you state that this amount and
          currency describe your progress toward this goal on that date. Zero is a valid amount.
          Nothing is moved between accounts and no budget allocation changes.
        </Copy>
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        disabled={!edited || pending || invalid}
        onPress={() => void save()}
      />
    </View>
  );
}

/** Records the person's own statement of where the goal named by `id` stands. */
export function FinanceGoalProgress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const query = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  const goal = query.data?.data.find((item) => item.id === id && item.status !== "removed");
  return (
    <ReadState query={query}>
      {goal ? (
        <ProgressForm key={goal.id} goal={goal} />
      ) : (
        <FinanceScreen title="Goal">
          <Copy secondary>This goal is unavailable.</Copy>
        </FinanceScreen>
      )}
    </ReadState>
  );
}
