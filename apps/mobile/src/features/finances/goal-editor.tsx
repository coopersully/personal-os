import { ApiClientError } from "@personal-os/api-client";
import type { FinanceGoal } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import { PaddedSurfaceRows } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { goalPriorities, isCalendarDate, parseTarget } from "./goal-progress";
import { confirmedRejection } from "./mutations";
import { Card, Copy, FinanceScreen, ReadState } from "./ui";

function GoalForm({ record, known }: { record: FinanceGoal | null; known: string[] }) {
  const { api, owner, timezone } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  // Keep the reviewed version with the draft; background refresh never overwrites edits.
  const [snapshot] = useState(record);
  const [knownIds] = useState(known);
  const [name, setName] = useState(snapshot?.name ?? "");
  const [target, setTarget] = useState(snapshot ? String(snapshot.targetAmount) : "");
  const [deadline, setDeadline] = useState(snapshot?.deadline ?? null);
  const [priority, setPriority] = useState<FinanceGoal["priority"]>(snapshot?.priority ?? "medium");
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  // A create whose outcome is unknown: the payload it was sent with and the name to look for.
  const unconfirmed = useRef<{ payload: string; name: string } | null>(null);
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
  const amount = parseTarget(target);
  const invalidTarget = !!target.trim() && amount === undefined;
  const invalidDeadline = !!deadline && !isCalendarDate(deadline);
  const invalid = !name.trim() || amount === undefined || invalidDeadline;
  const close = () =>
    edited
      ? confirmChoice({
          title: "Discard changes?",
          message: "Unsaved edits will be lost.",
          cancel: "Keep editing",
          accept: "Discard",
          destructive: true,
          onAccept: () => router.back(),
        })
      : router.back();
  const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });
  /** Reports a write the server answered; returns whether it was applied. */
  const applied = (
    result: { outcome: string; communication: { headline: string } },
    id: string | number,
  ) => {
    if (result.outcome === "completed") return true;
    if (result.outcome === "failed") toast.error(result.communication.headline, { id });
    else toast.info(result.communication.headline, { id });
    void refresh();
    return false;
  };

  async function create(targetAmount: number, id: string | number) {
    const input = { deadline, name: name.trim(), priority, targetAmount };
    const payload = JSON.stringify(input);
    const earlier = unconfirmed.current;
    if (earlier && earlier.payload !== payload) {
      // The same draft is retried under its key, which the server answers once. A corrected
      // draft is a different write: look for the earlier attempt before adding a second goal.
      let recorded: boolean;
      try {
        recorded = (await api.listFinanceGoals()).data.some(
          (goal) => !knownIds.includes(goal.id) && goal.name === earlier.name,
        );
      } catch {
        if (current())
          toast.error("Couldn’t check whether the goal was added. Try again shortly.", { id });
        else toast.dismiss(id);
        return;
      }
      if (!current()) return void toast.dismiss(id);
      if (recorded) {
        await refresh();
        if (!current()) return void toast.dismiss(id);
        toast.info(
          `Your earlier attempt already added “${earlier.name}”. Open that goal to change it.`,
          { id },
        );
        router.back();
        return;
      }
      unconfirmed.current = null;
    }
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    try {
      const result = await api.manageFinanceGoal({
        operation: "create",
        ...input,
        idempotencyKey: attempt.current.key,
      });
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      unconfirmed.current = null;
      if (!applied(result, id)) return;
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      const rejected = confirmedRejection(error);
      if (rejected) attempt.current = null;
      unconfirmed.current = rejected ? null : { payload, name: input.name };
      toast.error(
        rejected
          ? "Couldn’t add this goal. Your draft is still here."
          : "Couldn’t confirm the goal was added. Your draft is still here; saving again won’t add it twice.",
        { id },
      );
      return;
    }
    await refresh();
    if (!current()) return void toast.dismiss(id);
    toast.success("Goal added", { id });
    router.back();
  }

  async function update(goal: FinanceGoal, targetAmount: number, id: string | number) {
    const changes = {
      ...(name.trim() !== goal.name ? { name: name.trim() } : {}),
      ...(targetAmount !== goal.targetAmount ? { targetAmount } : {}),
      ...(deadline !== goal.deadline ? { deadline } : {}),
      ...(priority !== goal.priority ? { priority } : {}),
    };
    if (!Object.keys(changes).length) {
      toast.info("No changes to save", { id });
      router.back();
      return;
    }
    const input = { goalId: goal.id, expectedVersion: goal.version, changes };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    try {
      const result = await api.manageFinanceGoal({
        operation: "update",
        ...input,
        idempotencyKey: attempt.current.key,
      });
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      if (!applied(result, id)) return;
      await refresh();
      if (!current()) return void toast.dismiss(id);
      toast.success("Goal updated", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (confirmedRejection(error)) attempt.current = null;
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "This goal changed elsewhere. Close and reopen it to review the latest version; your draft is still here."
          : confirmedRejection(error)
            ? "Couldn’t save this goal. Your draft is still here."
            : "Couldn’t confirm the save. Your draft is still here. Check the goal before retrying.",
        { id },
      );
      // Rejected or unknown, the cached goal may be stale: reopening must show the latest.
      void refresh();
    }
  }

  async function save() {
    if (lock.current || !edited || invalid || amount === undefined) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading(snapshot ? "Saving goal…" : "Adding goal…");
    try {
      await (snapshot ? update(snapshot, amount, id) : create(amount, id));
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
      <FinanceScreen title={snapshot ? "Edit goal" : "Add goal"}>
        <Card rows>
          {/* Shared rows pad themselves; let them span the card so every row lines up. */}
          <PaddedSurfaceRows>
            <TextRow
              label="Name"
              value={name}
              onChangeText={edit(setName)}
              editable={!pending}
              maxLength={240}
              placeholder="Required"
            />
            <TextRow
              label="Target"
              value={target}
              onChangeText={edit(setTarget)}
              editable={!pending}
              correction={
                invalidTarget ? "Enter an amount such as 5000.00, up to 21,474,836.47." : undefined
              }
              keyboardType="decimal-pad"
              placeholder="Required"
            />
            <SettingsAccentProvider workspace="finances">
              <DateField
                label="Deadline"
                dateOnly
                value={deadline}
                onChange={(value) => {
                  if (!lock.current) edit(setDeadline)(value ? value.slice(0, 10) : null);
                }}
              />
            </SettingsAccentProvider>
            <EnumChoice
              label="Priority"
              value={priority}
              disabled={pending}
              options={goalPriorities}
              onChange={(value) => edit(setPriority)(value as FinanceGoal["priority"])}
            />
          </PaddedSurfaceRows>
        </Card>
        {invalidDeadline && <Copy>Enter the deadline as a date such as 2028-03-01.</Copy>}
        <Copy secondary>
          Name and Target are required. Deadline is optional.
          {timezone ? "" : " Set your account timezone in Settings to choose a deadline."}
          {snapshot
            ? " Saving a change starts a new version of the goal, so its progress will need confirming again."
            : " Progress is confirmed separately once the goal exists."}
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

/** Adds a goal, or edits the name, target, deadline and priority of the goal named by `id`. */
export function FinanceGoalEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const query = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  const record = id
    ? query.data?.data.find((item) => item.id === id && item.status !== "removed")
    : null;
  return (
    <ReadState query={query}>
      {record === undefined ? (
        <FinanceScreen title="Goal">
          <Copy secondary>This goal is unavailable.</Copy>
        </FinanceScreen>
      ) : (
        <GoalForm
          key={id ?? "new"}
          record={record}
          known={query.data?.data.map((item) => item.id) ?? []}
        />
      )}
    </ReadState>
  );
}
