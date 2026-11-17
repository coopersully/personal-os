import {
  createFinanceBudgetVersionInputSchema,
  type FinanceBudgetAllocation,
  type FinanceBudgetResource,
  type FinanceBudgetVersion,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { PaddedSurfaceRows } from "../../components/forms/section-content";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { TextRow } from "./account-editor";
import { amountCents, budgetMonth, useCurrentSession, writeFailure } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmChoice } from "./goal-confirm";
import { formatMoney, periodScope } from "./presentation";
import { Card, Copy, FinanceScreen, ReadState, Section } from "./ui";

type Named = { id: string; name: string };
type AllocationKind = FinanceBudgetAllocation["kind"];
interface ResourceDraft {
  rowId: number;
  key: string;
  kind: FinanceBudgetResource["kind"];
  amount: string;
  description: string;
  sourceId: string;
}
interface AllocationDraft {
  rowId: number;
  key: string;
  kind: AllocationKind;
  amount: string;
  description: string;
  categoryId: string;
  legacyCategory: string;
  accountId: string;
  goalId: string;
}

const resourceKinds = [
  { value: "income", label: "Income" },
  { value: "reserve_draw", label: "Reserve draw" },
  { value: "borrowing", label: "Borrowing" },
  { value: "other", label: "Other resource" },
] as const;
const allocationKinds = [
  { value: "spending", label: "Spending" },
  { value: "savings", label: "Savings" },
  { value: "debt", label: "Debt payment" },
  { value: "goal", label: "Goal contribution" },
  { value: "buffer", label: "Buffer" },
] as const;

/** Says plainly whether the version being revised is the approved budget or not. */
const versionStatus: Record<FinanceBudgetVersion["status"], string> = {
  active: "the approved budget",
  proposed: "a proposal that is not approved",
  incomplete: "an incomplete draft that is not approved",
  retired: "a retired budget",
};

let rows = 0;
const nextRow = () => {
  rows += 1;
  return rows;
};
const resourceDraft = (value?: FinanceBudgetResource): ResourceDraft => ({
  rowId: nextRow(),
  key: value?.key ?? "",
  kind: value?.kind ?? "income",
  amount: value ? value.amount.toFixed(2) : "",
  description: value?.description ?? "",
  sourceId: value?.sourceId ?? "",
});
const allocationDraft = (value?: FinanceBudgetAllocation): AllocationDraft => ({
  rowId: nextRow(),
  key: value?.key ?? "",
  kind: value?.kind ?? "spending",
  amount: value ? value.amount.toFixed(2) : "",
  description: value?.description ?? "",
  categoryId: value?.kind === "spending" ? (value.categoryId ?? "") : "",
  legacyCategory: value?.kind === "spending" ? (value.legacyCategory ?? "") : "",
  accountId: value?.kind === "debt" ? value.accountId : "",
  goalId: value && "goalId" in value ? (value.goalId ?? "") : "",
});
const optional = <K extends string>(key: K, value: string) =>
  (value.trim() ? { [key]: value.trim() } : {}) as { [P in K]?: string };

function resourceInput(row: ResourceDraft): FinanceBudgetResource {
  return {
    key: row.key.trim(),
    kind: row.kind,
    amount: Number(row.amount),
    ...optional("description", row.description),
    ...optional("sourceId", row.sourceId),
  };
}
/** Only the links that belong to the row's kind are sent; a kind change never carries one over. */
function allocationInput(row: AllocationDraft): FinanceBudgetAllocation {
  const base = {
    key: row.key.trim(),
    amount: Number(row.amount),
    ...optional("description", row.description),
  };
  if (row.kind === "spending")
    return {
      ...base,
      kind: "spending",
      ...optional("categoryId", row.categoryId),
      ...optional("legacyCategory", row.legacyCategory),
    };
  if (row.kind === "debt") return { ...base, kind: "debt", accountId: row.accountId };
  if (row.kind === "goal") return { ...base, kind: "goal", goalId: row.goalId };
  if (row.kind === "savings")
    return { ...base, kind: "savings", ...optional("goalId", row.goalId) };
  return { ...base, kind: "buffer" };
}

/** A saved link stays selectable even when its record can no longer be listed. */
function linkOptions(records: Named[], value: string, none: string) {
  return [
    { value: "", label: none },
    ...(value && !records.some((item) => item.id === value)
      ? [{ value, label: "Saved record" }]
      : []),
    ...records.map((item) => ({ value: item.id, label: item.name })),
  ];
}

function PlanForm({
  record,
  categories,
  accounts,
  goals,
  onReload,
}: {
  record: FinanceBudgetVersion | null;
  categories: Named[];
  accounts: Named[];
  goals: Named[];
  onReload: () => void;
}) {
  const { api, owner, timezone } = useFinance();
  const client = useQueryClient();
  const keyboardOffset = useFormKeyboardOffset();
  const current = useCurrentSession();
  // The reviewed version stays with the draft; a background refresh never replaces either.
  const [snapshot] = useState(record);
  const [month, setMonth] = useState(
    () =>
      snapshot?.effectiveFrom ?? (timezone ? periodScope("month", timezone).from.slice(0, 7) : ""),
  );
  const [rationale, setRationale] = useState(snapshot?.rationale ?? "");
  const [assumptions, setAssumptions] = useState(() =>
    (snapshot?.assumptions ?? []).map((value) => ({ rowId: nextRow(), value })),
  );
  const [resources, setResources] = useState<ResourceDraft[]>(() =>
    snapshot ? snapshot.resources.map(resourceDraft) : [{ ...resourceDraft(), key: "Income" }],
  );
  const [allocations, setAllocations] = useState<AllocationDraft[]>(() =>
    snapshot
      ? snapshot.allocations.map(allocationDraft)
      : [{ ...allocationDraft(), key: "Spending" }],
  );
  const [edited, setEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  const changeResource = (rowId: number, change: Partial<ResourceDraft>) => {
    setResources((list) => list.map((row) => (row.rowId === rowId ? { ...row, ...change } : row)));
    setEdited(true);
  };
  const changeAllocation = (rowId: number, change: Partial<AllocationDraft>) => {
    setAllocations((list) =>
      list.map((row) => (row.rowId === rowId ? { ...row, ...change } : row)),
    );
    setEdited(true);
  };

  const resourceCents = resources.map((row) => amountCents(row.amount));
  const allocationCents = allocations.map((row) => amountCents(row.amount));
  const amountsValid = [...resourceCents, ...allocationCents].every((value) => value !== null);
  const total = (list: (number | null)[]) => list.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const delta = total(resourceCents) - total(allocationCents);
  const balanced = amountsValid && delta === 0 && resources.length > 0 && allocations.length > 0;
  const unique = (list: { key: string }[]) =>
    list.every((row) => row.key.trim()) &&
    new Set(list.map((row) => row.key.trim())).size === list.length;
  const problem = !budgetMonth(month)
    ? "Enter the effective month, such as 2026-12."
    : !unique(resources) || !unique(allocations)
      ? "Give each resource and each allocation its own name."
      : allocations.some(
            (row) =>
              (row.kind === "debt" && !row.accountId) || (row.kind === "goal" && !row.goalId),
          )
        ? "Choose the account for each debt payment and the goal for each goal contribution."
        : !rationale.trim()
          ? "Add a rationale for this plan."
          : assumptions.some((row) => !row.value.trim())
            ? "Fill in or remove empty assumptions."
            : null;
  const balance = !amountsValid
    ? "Enter amounts with up to two decimal places"
    : balanced
      ? "Every cent assigned"
      : `${formatMoney(Math.abs(delta) / 100, "USD")} ${delta > 0 ? "left to assign" : "over-assigned"}`;

  const close = () =>
    edited
      ? confirmChoice({
          title: "Discard changes?",
          message: "Unsaved edits to this plan will be lost.",
          cancel: "Keep editing",
          accept: "Discard",
          destructive: true,
          onAccept: () => router.back(),
        })
      : router.back();
  const reload = () =>
    confirmChoice({
      title: "Reload latest version?",
      message: "Your draft will be replaced by the latest saved plan.",
      cancel: "Keep draft",
      accept: "Reload",
      destructive: true,
      onAccept: onReload,
    });

  async function save() {
    if (lock.current || !edited || stale || !balanced || problem) return;
    const parsed = createFinanceBudgetVersionInputSchema.safeParse({
      allocations: allocations.map(allocationInput),
      assumptions: assumptions.map((row) => row.value.trim()),
      effectiveFrom: month,
      rationale: rationale.trim(),
      resources: resources.map(resourceInput),
      idempotencyKey: "validate",
    });
    if (!parsed.success) {
      toast.error(
        `Check this plan before saving: ${parsed.error.issues[0]?.message ?? "a field is not valid"}.`,
      );
      return;
    }
    const revision = snapshot
      ? { planId: snapshot.planId, expectedVersion: snapshot.version }
      : null;
    const payload = JSON.stringify({ ...parsed.data, ...revision });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    const input = { ...parsed.data, idempotencyKey: attempt.current.key };
    lock.current = true;
    setPending(true);
    const id = toast.loading("Saving proposal…");
    try {
      const result = revision
        ? await api.reviseFinanceBudget({ ...input, ...revision })
        : await api.createFinanceBudget(input);
      if (!current()) return void toast.dismiss(id);
      if (result.outcome !== "completed" || !result.data) {
        // The server answered without saving a version. Only a failure frees the request.
        if (result.outcome === "failed") attempt.current = null;
        const message = result.communication.headline || "The plan was not saved.";
        if (result.outcome === "failed") toast.error(message, { id });
        else toast.info(message, { id });
        return;
      }
      attempt.current = null;
      const saved = result.data;
      await client.invalidateQueries({ queryKey: ["finances", owner] });
      if (!current()) return void toast.dismiss(id);
      if (saved.status === "proposed") {
        toast.success(
          `Version ${saved.version} saved as a proposal. Approve it to make it active.`,
          {
            id,
          },
        );
        router.replace({
          pathname: "/finance-chat-reference",
          params: { kind: "budget_plan", id: saved.planId, versionId: saved.id },
        });
      } else {
        toast.success(`Version ${saved.version} saved.`, { id });
        router.back();
      }
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      const failure = writeFailure(error);
      if (failure !== "unknown" && failure !== "in_progress") attempt.current = null;
      if (failure === "conflict") {
        setStale(true);
        void client.invalidateQueries({ queryKey: ["finances", owner, "budget"] });
      }
      toast.error(
        failure === "conflict"
          ? "This plan changed elsewhere. Your draft is still here; reload the latest version to revise it."
          : failure === "failed_before"
            ? "That save failed and nothing was saved. Your draft is still here; save again to retry."
            : failure === "in_progress"
              ? "This save is still in progress. Wait a moment, then save again."
              : failure === "rejected"
                ? "Couldn’t save this proposal. Your draft is still here."
                : "Couldn’t confirm the save. Your draft is still here; saving again won’t create a second version.",
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
        <FinanceScreen title={snapshot ? "Revise plan" : "Create plan"}>
          <Copy secondary>
            {snapshot
              ? `Revising version ${snapshot.version} · ${versionStatus[snapshot.status]}. `
              : ""}
            Saving creates a proposal. It takes effect only after you approve it.
          </Copy>
          {stale && (
            // The toast reports the conflict; only its recovery control stays on the page.
            <Actions inset={false}>
              <Action label="Reload latest version" disabled={pending} onPress={reload} />
            </Actions>
          )}
          <Card rows>
            <PaddedSurfaceRows>
              <TextRow
                label="Effective month"
                value={month}
                onChangeText={(value) => {
                  setMonth(value);
                  setEdited(true);
                }}
                editable={!pending}
                placeholder="YYYY-MM"
                maxLength={7}
                correction={
                  month && !budgetMonth(month) ? "Enter a month such as 2026-12." : undefined
                }
              />
            </PaddedSurfaceRows>
          </Card>
          <Section title="Resources">
            {resources.map((row, index) => {
              const name = `Resource ${index + 1}`;
              return (
                <Card rows key={row.rowId}>
                  <PaddedSurfaceRows>
                    <TextRow
                      label={`${name} name`}
                      value={row.key}
                      onChangeText={(key) => changeResource(row.rowId, { key })}
                      editable={!pending}
                      maxLength={120}
                      placeholder="Required"
                    />
                    <EnumChoice
                      label={`${name} kind`}
                      icon="categoryLayers"
                      value={row.kind}
                      disabled={pending}
                      options={resourceKinds}
                      onChange={(kind) =>
                        changeResource(row.rowId, { kind: kind as ResourceDraft["kind"] })
                      }
                    />
                    <TextRow
                      label={`${name} amount`}
                      value={row.amount}
                      onChangeText={(amount) => changeResource(row.rowId, { amount })}
                      editable={!pending}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      correction={
                        row.amount && amountCents(row.amount) === null
                          ? "Enter an amount such as 3000.00."
                          : undefined
                      }
                    />
                    <EnumChoice
                      label={`${name} source`}
                      icon="wallet"
                      value={row.sourceId}
                      disabled={pending}
                      options={linkOptions(accounts, row.sourceId, "No linked source")}
                      onChange={(sourceId) => changeResource(row.rowId, { sourceId })}
                    />
                    <TextRow
                      label={`${name} description`}
                      value={row.description}
                      onChangeText={(description) => changeResource(row.rowId, { description })}
                      editable={!pending}
                      maxLength={500}
                      placeholder="Optional"
                    />
                  </PaddedSurfaceRows>
                  <Actions>
                    <Action
                      label={`Remove resource ${index + 1}`}
                      destructive
                      disabled={pending || resources.length === 1}
                      onPress={() => {
                        setResources((list) => list.filter((item) => item.rowId !== row.rowId));
                        setEdited(true);
                      }}
                    />
                  </Actions>
                </Card>
              );
            })}
            <Actions inset={false}>
              <Action
                label="Add resource"
                disabled={pending || resources.length >= 100}
                onPress={() => {
                  setResources((list) => [...list, resourceDraft()]);
                  setEdited(true);
                }}
              />
            </Actions>
          </Section>
          <Section title="Allocations">
            {allocations.map((row, index) => {
              const name = `Allocation ${index + 1}`;
              return (
                <Card rows key={row.rowId}>
                  <PaddedSurfaceRows>
                    <TextRow
                      label={`${name} name`}
                      value={row.key}
                      onChangeText={(key) => changeAllocation(row.rowId, { key })}
                      editable={!pending}
                      maxLength={120}
                      placeholder="Required"
                    />
                    <EnumChoice
                      label={`${name} kind`}
                      icon="categoryLayers"
                      value={row.kind}
                      disabled={pending}
                      options={allocationKinds}
                      onChange={(kind) =>
                        changeAllocation(row.rowId, { kind: kind as AllocationKind })
                      }
                    />
                    <TextRow
                      label={`${name} amount`}
                      value={row.amount}
                      onChangeText={(amount) => changeAllocation(row.rowId, { amount })}
                      editable={!pending}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      correction={
                        row.amount && amountCents(row.amount) === null
                          ? "Enter an amount such as 600.00."
                          : undefined
                      }
                    />
                    {row.kind === "spending" && (
                      <>
                        <EnumChoice
                          label={`${name} category`}
                          icon="categoryTags"
                          value={row.categoryId}
                          disabled={pending}
                          options={linkOptions(categories, row.categoryId, "No category linked")}
                          onChange={(categoryId) => changeAllocation(row.rowId, { categoryId })}
                        />
                        <TextRow
                          label={`${name} category label`}
                          value={row.legacyCategory}
                          onChangeText={(legacyCategory) =>
                            changeAllocation(row.rowId, { legacyCategory })
                          }
                          editable={!pending}
                          maxLength={240}
                          placeholder="Optional"
                        />
                      </>
                    )}
                    {row.kind === "debt" && (
                      <EnumChoice
                        label={`${name} account`}
                        icon="finances"
                        value={row.accountId}
                        disabled={pending}
                        options={linkOptions(accounts, row.accountId, "Choose an account")}
                        onChange={(accountId) => changeAllocation(row.rowId, { accountId })}
                      />
                    )}
                    {(row.kind === "goal" || row.kind === "savings") && (
                      <EnumChoice
                        label={`${name} goal`}
                        icon="target"
                        value={row.goalId}
                        disabled={pending}
                        options={linkOptions(
                          goals,
                          row.goalId,
                          row.kind === "goal" ? "Choose a goal" : "No goal linked",
                        )}
                        onChange={(goalId) => changeAllocation(row.rowId, { goalId })}
                      />
                    )}
                    <TextRow
                      label={`${name} description`}
                      value={row.description}
                      onChangeText={(description) => changeAllocation(row.rowId, { description })}
                      editable={!pending}
                      maxLength={500}
                      placeholder="Optional"
                    />
                  </PaddedSurfaceRows>
                  <Actions>
                    <Action
                      label={`Remove allocation ${index + 1}`}
                      destructive
                      disabled={pending || allocations.length === 1}
                      onPress={() => {
                        setAllocations((list) => list.filter((item) => item.rowId !== row.rowId));
                        setEdited(true);
                      }}
                    />
                  </Actions>
                </Card>
              );
            })}
            <Actions inset={false}>
              <Action
                label="Add allocation"
                disabled={pending || allocations.length >= 500}
                onPress={() => {
                  setAllocations((list) => [...list, allocationDraft()]);
                  setEdited(true);
                }}
              />
            </Actions>
          </Section>
          <Card>
            <Copy>{balance}</Copy>
            {amountsValid && (
              <Copy secondary>
                {`Resources ${formatMoney(total(resourceCents) / 100, "USD")} · Allocations ${formatMoney(total(allocationCents) / 100, "USD")}`}
              </Copy>
            )}
          </Card>
          <Section title="Reasoning">
            <Card rows>
              <PaddedSurfaceRows>
                <TextRow
                  label="Rationale"
                  value={rationale}
                  onChangeText={(value) => {
                    setRationale(value);
                    setEdited(true);
                  }}
                  editable={!pending}
                  multiline
                  maxLength={4000}
                  placeholder="Required"
                />
                {assumptions.map((row, index) => (
                  <View key={row.rowId}>
                    <TextRow
                      label={`Assumption ${index + 1}`}
                      value={row.value}
                      onChangeText={(value) => {
                        setAssumptions((list) =>
                          list.map((item) =>
                            item.rowId === row.rowId ? { ...item, value } : item,
                          ),
                        );
                        setEdited(true);
                      }}
                      editable={!pending}
                      multiline
                      maxLength={1000}
                      placeholder="Required"
                    />
                    <Actions>
                      <Action
                        label={`Remove assumption ${index + 1}`}
                        destructive
                        disabled={pending}
                        onPress={() => {
                          setAssumptions((list) => list.filter((item) => item.rowId !== row.rowId));
                          setEdited(true);
                        }}
                      />
                    </Actions>
                  </View>
                ))}
              </PaddedSurfaceRows>
            </Card>
            <Actions inset={false}>
              <Action
                label="Add assumption"
                disabled={pending || assumptions.length >= 100}
                onPress={() => {
                  setAssumptions((list) => [...list, { rowId: nextRow(), value: "" }]);
                  setEdited(true);
                }}
              />
            </Actions>
          </Section>
          {edited && problem && <Copy secondary>{problem}</Copy>}
          <View style={{ height: 80 }} />
        </FinanceScreen>
        <FormSave
          workspace="finances"
          label="Save proposal"
          keyboardOffset={keyboardOffset}
          disabled={!edited || pending || stale || !balanced || !!problem}
          onPress={() => void save()}
        />
      </SettingsAccentProvider>
    </View>
  );
}

/** Revises the current plan, or creates the first one, as a proposal that still needs approval. */
export function BudgetPlanEditor() {
  const query = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const categories = useFinanceRead(["categories"], (api) => api.getFinanceCategories());
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const goals = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  // Each reload starts a new form on the latest version; a refresh alone never does.
  const [generation, setGeneration] = useState(0);
  const current = useCurrentSession();
  async function reload() {
    const id = toast.loading("Loading the latest plan…");
    const result = await query.refetch();
    if (!current()) return void toast.dismiss(id);
    if (result.isError) {
      toast.error("Couldn’t load the latest plan. Your draft is still here.", { id });
      return;
    }
    toast.success("Latest plan loaded", { id });
    setGeneration((value) => value + 1);
  }
  return (
    <ReadState query={query}>
      {query.data ? (
        <PlanForm
          key={generation}
          record={query.data.data}
          categories={categories.data ?? []}
          accounts={accounts.data?.accounts ?? []}
          goals={(goals.data?.data ?? []).filter((goal) => goal.status !== "removed")}
          onReload={() => void reload()}
        />
      ) : null}
    </ReadState>
  );
}
