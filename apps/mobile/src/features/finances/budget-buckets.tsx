import { ApiClientError } from "@personal-os/api-client";
import type { FinanceBudgetBucket, FinanceCategory } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { Action, Actions, ToggleRow } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { PaddedSurfaceRows } from "../../components/forms/section-content";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { TextRow } from "./account-editor";
import { monthName, useCurrentSession, writeFailure } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { appliedTransaction } from "./mutations";
import { formatMoney } from "./presentation";
import {
  Card,
  Copy,
  FinanceFloatingAdd,
  FinanceRow,
  FinanceScreen,
  ReadState,
  Section,
} from "./ui";

const route = "/finance-budget-plan" as const;
const useBuckets = (month: string) =>
  useFinanceRead(["budget-buckets", month], (api) => api.listFinanceBudgetBuckets(month));
const count = (n: number) => `${n} ${n === 1 ? "category" : "categories"}`;

/** The month's totals by bucket and the buckets themselves. */
export function BudgetBuckets({ month }: { month: string }) {
  const query = useBuckets(month);
  const taxonomy = query.data?.taxonomy;
  return (
    <View style={{ flex: 1 }}>
      <FinanceScreen title="Budget buckets">
        <Copy secondary>
          Buckets group transaction categories for planning. A category belongs to one bucket.
        </Copy>
        <ReadState query={query}>
          {taxonomy?.buckets.length ? (
            <>
              <Section title={monthName(month)}>
                <Card rows>
                  {taxonomy.rollups.map((rollup) => (
                    <FinanceRow
                      key={rollup.bucketId ?? "unmapped"}
                      title={rollup.label}
                      subtitle={count(rollup.categoryIds.length)}
                      value={`${formatMoney(rollup.spent, "USD")} of ${formatMoney(rollup.budgeted, "USD")}`}
                      valueTone={rollup.remaining < 0 ? "attention" : undefined}
                      icon="categoryLayers"
                    />
                  ))}
                </Card>
              </Section>
              <Section title="Buckets">
                <Card rows>
                  {taxonomy.buckets.map((bucket) => (
                    <FinanceRow
                      key={bucket.id}
                      title={bucket.name}
                      subtitle={bucket.description ?? count(bucket.categories.length)}
                      icon="categoryLayers"
                      onPress={() =>
                        router.push({
                          pathname: route,
                          params: { view: "bucket", id: bucket.id, month },
                        })
                      }
                    />
                  ))}
                </Card>
              </Section>
            </>
          ) : (
            <Copy secondary>
              No buckets yet. Category limits stay under Unmapped categories until you add one.
            </Copy>
          )}
        </ReadState>
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FinanceFloatingAdd
        label="Add bucket"
        onPress={() => router.push({ pathname: route, params: { view: "bucket", month } })}
      />
    </View>
  );
}

function BucketForm({
  record,
  buckets,
  categories,
  onReload,
}: {
  record: FinanceBudgetBucket | null;
  buckets: FinanceBudgetBucket[];
  categories: FinanceCategory[];
  onReload: () => void;
}) {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  const current = useCurrentSession();
  // The reviewed version stays with the draft; a background refresh never replaces either.
  const [snapshot] = useState(record);
  const [name, setName] = useState(snapshot?.name ?? "");
  const [description, setDescription] = useState(snapshot?.description ?? "");
  const [selected, setSelected] = useState(snapshot?.categories ?? []);
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const invalid = !name.trim();
  const close = () =>
    edited
      ? confirmChoice({
          title: "Discard changes?",
          message: "Unsaved edits to this bucket will be lost.",
          cancel: "Keep editing",
          accept: "Discard",
          destructive: true,
          onAccept: () => router.back(),
        })
      : router.back();
  const reload = () =>
    confirmChoice({
      title: "Reload latest version?",
      message: "Your draft will be replaced by the bucket as it is now.",
      cancel: "Keep draft",
      accept: "Reload",
      destructive: true,
      onAccept: onReload,
    });

  async function save() {
    if (lock.current || !edited || stale || invalid) return;
    const nextDescription = description.trim() || null;
    const sameCategories =
      !!snapshot &&
      selected.length === snapshot.categories.length &&
      selected.every((id) => snapshot.categories.includes(id));
    const changes = snapshot
      ? {
          ...(name.trim() !== snapshot.name ? { name: name.trim() } : {}),
          ...(nextDescription !== snapshot.description ? { description: nextDescription } : {}),
          ...(sameCategories ? {} : { categoryIds: selected }),
        }
      : { name: name.trim(), description: nextDescription };
    if (snapshot && !Object.keys(changes).length) {
      toast.info("No changes to save");
      router.back();
      return;
    }
    const payload = JSON.stringify({ id: snapshot?.id, version: snapshot?.version, changes });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    const idempotencyKey = attempt.current.key;
    lock.current = true;
    setPending(true);
    const id = toast.loading(snapshot ? "Saving bucket…" : "Adding bucket…");
    try {
      const result = snapshot
        ? await api.updateFinanceBudgetBucket(snapshot.id, {
            ...changes,
            expectedVersion: snapshot.version,
            idempotencyKey,
          })
        : await api.createFinanceBudgetBucket({
            name: name.trim(),
            description: nextDescription,
            idempotencyKey,
          });
      if (!current()) return void toast.dismiss(id);
      attempt.current = null;
      void client.invalidateQueries({ queryKey: ["finances", owner, "budget-buckets"] });
      if (!appliedTransaction(result)) {
        toast.info(
          "status" in result && result.status === "needs_input"
            ? "More information is needed. The bucket has not changed."
            : "Submitted for approval. The bucket has not changed.",
          { id },
        );
        router.back();
        return;
      }
      toast.success(snapshot ? "Bucket saved" : "Bucket added", { id });
      router.back();
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      const failure = writeFailure(error);
      if (failure !== "unknown" && failure !== "in_progress") attempt.current = null;
      const taken =
        failure === "conflict" &&
        error instanceof ApiClientError &&
        error.message.includes("already exists");
      if (failure === "conflict" && !taken) {
        setStale(true);
        void client.invalidateQueries({ queryKey: ["finances", owner, "budget-buckets"] });
      }
      toast.error(
        taken
          ? "A bucket with that name already exists. Choose another name."
          : failure === "conflict"
            ? "This bucket changed elsewhere. Your draft is still here; reload the latest version to edit it."
            : failure === "failed_before"
              ? "That save failed and nothing was saved. Your draft is still here; save again to retry."
              : failure === "in_progress"
                ? "This save is still in progress. Wait a moment, then save again."
                : failure === "rejected"
                  ? "Couldn’t save this bucket. Your draft is still here."
                  : "Couldn’t confirm the save. Your draft is still here; saving again won’t apply it twice.",
        { id },
      );
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
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
      <SettingsAccentProvider workspace="finances">
        <FinanceScreen title={snapshot ? "Edit bucket" : "Add bucket"}>
          {stale && (
            <Card>
              <Copy>This bucket was changed elsewhere. Reloading replaces this draft with it.</Copy>
              <Actions inset={false}>
                <Action label="Reload latest version" disabled={pending} onPress={reload} />
              </Actions>
            </Card>
          )}
          <Card rows>
            <PaddedSurfaceRows>
              <TextRow
                label="Name"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setEdited(true);
                }}
                editable={!pending}
                maxLength={80}
                placeholder="Required"
              />
              <TextRow
                label="Description"
                value={description}
                onChangeText={(value) => {
                  setDescription(value);
                  setEdited(true);
                }}
                editable={!pending}
                maxLength={240}
                placeholder="Optional"
              />
            </PaddedSurfaceRows>
          </Card>
          {snapshot ? (
            <Section title="Categories">
              <Card rows>
                {categories.map((category) => {
                  const on = selected.includes(category.id);
                  const other = buckets.find(
                    (item) => item.id !== snapshot.id && item.categories.includes(category.id),
                  );
                  return (
                    <ToggleRow
                      key={category.id}
                      label={category.name}
                      detail={
                        other && !on
                          ? `In ${other.name}. Turning this on moves it here.`
                          : undefined
                      }
                      value={on}
                      disabled={pending}
                      onChange={(value) => {
                        setSelected((list) =>
                          value
                            ? [...list.filter((id) => id !== category.id), category.id]
                            : list.filter((id) => id !== category.id),
                        );
                        setEdited(true);
                      }}
                    />
                  );
                })}
              </Card>
            </Section>
          ) : (
            <Copy secondary>Choose the bucket’s categories after adding it.</Copy>
          )}
          <View style={{ height: 80 }} />
        </FinanceScreen>
        <FormSave
          workspace="finances"
          keyboardOffset={keyboardOffset}
          disabled={!edited || pending || stale || invalid}
          onPress={() => void save()}
        />
      </SettingsAccentProvider>
    </View>
  );
}

/** Adds a bucket, or edits the name, description and categories of the bucket named by `id`. */
export function BudgetBucketEditor({ id, month }: { id?: string; month: string }) {
  const query = useBuckets(month);
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories());
  const [generation, setGeneration] = useState(0);
  const current = useCurrentSession();
  const buckets = query.data?.taxonomy?.buckets ?? [];
  const record = id ? buckets.find((item) => item.id === id) : null;
  async function reload() {
    const feedback = toast.loading("Loading the latest bucket…");
    const result = await query.refetch();
    if (!current()) return void toast.dismiss(feedback);
    if (result.isError) {
      toast.error("Couldn’t load the latest bucket. Your draft is still here.", { id: feedback });
      return;
    }
    toast.success("Latest bucket loaded", { id: feedback });
    setGeneration((value) => value + 1);
  }
  return (
    <ReadState query={query}>
      {record === undefined ? (
        <FinanceScreen title="Bucket">
          <Copy secondary>This bucket is unavailable.</Copy>
        </FinanceScreen>
      ) : (
        <ReadState query={id ? categories : { ...categories, isPending: false, isError: false }}>
          <BucketForm
            key={generation}
            record={record}
            buckets={buckets}
            categories={categories.data ?? []}
            onReload={() => void reload()}
          />
        </ReadState>
      )}
    </ReadState>
  );
}
