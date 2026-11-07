import { ApiClientError } from "@personal-os/api-client";
import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { AppToaster } from "../../components/app-toaster";
import { EntityPicker } from "../../components/forms/entity-picker";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { useTheme } from "../../theme";
import { useFinance, useFinanceRead } from "./data";
import { appliedTransaction } from "./mutations";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

function TransactionForm({ record }: { record: FinanceTransaction }) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const t = useTheme();
  const keyboardOffset = useFormKeyboardOffset();
  // Keep the original revision with the draft; background refresh never overwrites edits.
  const [snapshot] = useState(record);
  const [notes, setNotes] = useState(record.notes ?? "");
  const [category, setCategory] = useState(record.category);
  const [edited, setEdited] = useState(false);
  const [choosing, setChoosing] = useState(false);
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
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories());
  const close = () =>
    edited && !submitted
      ? Alert.alert("Discard changes?", "Unsaved edits will be lost.", [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ])
      : router.back();
  async function save() {
    if (lock.current || !edited || submitted) return;
    const noteValue = notes.trim() || null;
    const changedCategory = category !== snapshot.category;
    const changedNotes = noteValue !== snapshot.notes;
    if (!changedCategory && !changedNotes) {
      toast.info("No changes to save");
      router.back();
      return;
    }
    lock.current = true;
    setPending(true);
    const id = toast.loading("Saving transaction…");
    try {
      const result = await api.updateFinanceTransaction(snapshot.id, {
        ...(changedCategory ? { category } : {}),
        ...(changedNotes ? { notes: noteValue } : {}),
        expectedTransactionUpdatedAt: snapshot.updatedAt,
      });
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      const saved = appliedTransaction(result);
      if (!saved) {
        setSubmitted(true);
        toast.info(
          result && "status" in result && result.status === "needs_input"
            ? "More input is needed. Your changes have not been applied."
            : "Submitted for review. Your changes have not been applied.",
          { id },
        );
        return;
      }
      await client.invalidateQueries({ queryKey: ["finances", owner] });
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      toast.success("Transaction updated", { id });
      router.back();
    } catch (error) {
      if (!active.current || currentOwner.current !== owner) {
        toast.dismiss(id);
        return;
      }
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "This transaction changed elsewhere. Close and reopen it to review the latest version; your draft is still here."
          : "Couldn’t confirm the save. Your draft is still here. Check the transaction before retrying.",
        { id },
      );
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "edit transaction",
          gestureEnabled: false,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={close}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: t.ink, fontSize: 16 }}>
                {edited && !submitted ? "Cancel" : "Close"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <FinanceScreen title={record.merchant}>
        <Card rows>
          <FinanceRow
            centered
            title="Category"
            icon="grid"
            value={category ?? "Uncategorized"}
            onPress={pending || submitted ? undefined : () => setChoosing(!choosing)}
          />
          {choosing && (
            <ReadState query={categories}>
              <EntityPicker
                title="Categories"
                icon="grid"
                value={category}
                options={[
                  { label: "Uncategorized", value: null },
                  ...(categories.data ?? []).map((item) => ({
                    label: item.name,
                    value: item.name,
                  })),
                ]}
                onChange={(value) => {
                  if (pending || submitted) return;
                  setCategory(value);
                  setEdited(true);
                }}
                onClose={() => setChoosing(false)}
              />
            </ReadState>
          )}
        </Card>
        <Section title="Notes">
          <Card>
            <TextInput
              accessibilityLabel="Notes"
              editable={!pending && !submitted}
              multiline
              maxLength={4000}
              placeholder="Dinner with Maya after the gallery opening."
              placeholderTextColor={t.secondary}
              value={notes}
              onChangeText={(value) => {
                setNotes(value);
                setEdited(true);
              }}
              style={{ minHeight: 100, color: t.ink, fontSize: 16, textAlignVertical: "top" }}
            />
          </Card>
        </Section>
        <Copy secondary>
          Changes apply to this transaction. Split allocations retain their existing category
          assignments.
        </Copy>
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        disabled={!edited || pending || submitted}
        onPress={() => void save()}
      />
    </View>
  );
}
export function FinanceTransactionEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useFinanceRead(["transaction", id], (api) => api.getFinanceTransaction(id), !!id);
  return (
    <View style={{ flex: 1 }}>
      <ReadState query={query}>
        {query.data?.data ? <TransactionForm key={id} record={query.data.data} /> : null}
      </ReadState>
      <AppToaster editor />
    </View>
  );
}
