import {
  type FinanceProfile,
  type FinanceProfileVersion,
  type FinanceProvenance,
  type FinanceSetupPlanning,
  type FinanceToolResult,
  financeSetupPlanningSchema,
  financialProfileChangesSchema,
  localDateAt,
  localDateToIso,
  type UpdateFinancialProfileInput,
  updateFinanceProfileInputSchema,
  updateFinancialProfileInputSchema,
  type WorkspaceSettings,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { PlanningPicker } from "../../components/forms/planning-picker";
import { SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useAuth } from "../auth/context";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { useWorkspacePreferenceQueue } from "./preferences-hook";

const human = (value: string) => value.replaceAll("_", " ");
const statement: FinanceProvenance = {
  actorId: null,
  actorType: "user",
  confidence: null,
  evidence: {},
  maintenanceRunId: null,
  observedAt: "1970-01-01T00:00:00.000Z",
  requestId: null,
  sourceId: null,
};
const emptyPreferences = {
  bufferTarget: null,
  debtPriority: null,
  emergencyReserveMonths: null,
  notes: [],
};
export function financeNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Enter a valid number.");
  return number;
}
export function financeAmount(value: string) {
  if (!value.trim()) return null;
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim()))
    throw new Error("Enter a nonnegative amount with up to two decimal places.");
  return Number(value);
}
export function requireCompletedFinanceResult<T>(result: FinanceToolResult<T>) {
  if (result.outcome !== "completed") throw new Error(result.communication.headline);
  return result.data;
}
const signatureFor = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "number" && !Number.isFinite(item) ? String(item) : item,
  );
type Draft = Pick<
  FinanceProfileVersion,
  | "jurisdiction"
  | "householdSize"
  | "dependents"
  | "expectedMonthlyTakeHome"
  | "incomeStability"
  | "liquidReserves"
  | "debts"
  | "insurance"
  | "preferences"
  | "planning"
>;
function draftFor(profile: FinanceProfileVersion | null): Draft {
  return {
    jurisdiction: profile?.jurisdiction ?? null,
    householdSize: profile?.householdSize ?? null,
    dependents: profile?.dependents ?? null,
    expectedMonthlyTakeHome: profile?.expectedMonthlyTakeHome ?? null,
    incomeStability: profile?.incomeStability ?? "unknown",
    liquidReserves: profile?.liquidReserves ?? null,
    debts: profile?.debts ?? [],
    insurance: profile?.insurance ?? [],
    preferences: profile?.preferences ?? emptyPreferences,
    planning: profile?.planning ?? null,
  };
}
export function financialProfileInput(
  initial: FinanceProfileVersion | null,
  draft: Draft,
  idempotencyKey: string,
): UpdateFinancialProfileInput {
  const previous = draftFor(initial);
  const changes = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => signatureFor(value) !== signatureFor(previous[key as keyof Draft]),
    ),
  );
  return updateFinancialProfileInputSchema.parse({
    expectedVersion: initial?.version ?? 0,
    idempotencyKey,
    changes: financialProfileChangesSchema.parse(changes),
  });
}
function NullableNumber({
  label,
  value,
  onChange,
  disabled,
  currency = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled: boolean;
  currency?: boolean;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  useEffect(() => {
    if (!Number.isNaN(value))
      setText((current) =>
        current.trim() && Number(current) === value ? current : (value?.toString() ?? ""),
      );
  }, [value]);
  // Draft text stays visible until Save validates the complete profile.
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(next) => {
        setText(next);
        onChange(next.trim() ? Number(next) : null);
      }}
      editable={!disabled}
      keyboardType={currency ? "decimal-pad" : "number-pad"}
      placeholder="Not provided"
    />
  );
}
export function FinanceConfigurationSettings() {
  const configuration = useSettingsResource("finance-configuration", (api) =>
    api.getFinanceConfiguration(),
  );
  if (!configuration.data)
    return (
      <State
        loading={configuration.isPending}
        retry={configuration.isError ? () => void configuration.refetch() : undefined}
      />
    );
  const config = configuration.data;
  return (
    <>
      <Section title="Financial configuration">
        <Action
          label="Household, planning and financial profile"
          onPress={() => router.push("/settings/finances/profile")}
        />
        <Action label="Payroll details" onPress={() => router.push("/settings/finances/payroll")} />
        {Object.entries(config.capabilities).map(([key, value]) => (
          <SectionNote key={key}>
            {human(key)}: {human(value.state)}
            {value.reason ? ` · ${value.reason}` : ""}
          </SectionNote>
        ))}
      </Section>
      {config.preferences.state === "loaded" && config.accounts.state === "loaded" ? (
        <FinanceAccountSets
          key="account-selections"
          initial={config.preferences.value}
          accounts={config.accounts.value.accounts.map((account) => ({
            id: account.id,
            label: `${account.institution} · ${account.name}`,
          }))}
        />
      ) : (
        <Action
          label="Retry loading account preferences"
          onPress={() => void configuration.refetch()}
        />
      )}
    </>
  );
}
function FinanceAccountSets({
  initial,
  accounts,
}: {
  initial: WorkspaceSettings<"finances">;
  accounts: { id: string; label: string }[];
}) {
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [preferences, setPreferences] = useState(initial.preferences);
  const queue = useWorkspacePreferenceQueue(initial);
  const [blocked, setBlocked] = useState(queue.blocked);
  const save = (
    key: "spendAccountIds" | "cashAccountIds" | "investmentAccountIds",
    value: string[] | null,
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    void action.run(async () => {
      try {
        await queue.save({ [key]: value });
        await cache.invalidateQueries({ queryKey: ["finances"] });
      } catch (error) {
        setBlocked(true);
        throw error;
      }
    });
  };
  return (
    <Section title="Accounts included in shared views">
      {(["spendAccountIds", "cashAccountIds", "investmentAccountIds"] as const).map((key) => (
        <Section
          key={key}
          title={
            key === "spendAccountIds"
              ? "Spending"
              : key === "cashAccountIds"
                ? "Cash"
                : "Investments"
          }
        >
          <ToggleRow
            label="Follow all eligible accounts"
            value={preferences[key] === null}
            disabled={action.pending || queue.pending || blocked || queue.blocked}
            onChange={(enabled) => save(key, enabled ? null : [])}
          />
          {preferences[key] !== null &&
            accounts.map((account) => (
              <ToggleRow
                key={account.id}
                label={account.label}
                value={preferences[key]?.includes(account.id) ?? false}
                disabled={action.pending || queue.pending || blocked || queue.blocked}
                onChange={(enabled) =>
                  save(
                    key,
                    enabled
                      ? [...(preferences[key] ?? []), account.id]
                      : (preferences[key] ?? []).filter((id) => id !== account.id),
                  )
                }
              />
            ))}
          {(preferences[key] ?? [])
            .filter((id) => !accounts.some((account) => account.id === id))
            .map((id) => (
              <Action
                key={id}
                label="Remove unavailable selected account"
                disabled={action.pending || queue.pending || blocked || queue.blocked}
                onPress={() =>
                  confirm(
                    "Remove unavailable account?",
                    "This account is saved in your selection but is no longer available. Remove it from this view?",
                    () =>
                      save(
                        key,
                        (preferences[key] ?? []).filter((value) => value !== id),
                      ),
                  )
                }
              />
            ))}
        </Section>
      ))}
      {(blocked || queue.blocked) && (
        <Action
          label="Reload and review account selections"
          disabled={action.pending || queue.pending}
          onPress={() =>
            confirm(
              "Reload selections?",
              "Replace your unsaved selection with current server choices, then review before changing them.",
              () =>
                void action.run(async (api) => {
                  const next = await api.getWorkspaceSettings("finances");
                  queue.recover(next);
                  setPreferences(next.preferences);
                  setBlocked(false);
                }),
            )
          }
        />
      )}
    </Section>
  );
}
export function FinancialProfileSettingsScreen() {
  const { state, session } = useAuth();
  return <FinancialProfileLoader key={`${state.user?.id}-${session.epoch()}`} />;
}
function FinancialProfileLoader() {
  const profile = useSettingsResource("financial-profile", async (api) =>
    requireCompletedFinanceResult(await api.getFinancialProfile()),
  );
  if (profile.data === undefined)
    return (
      <State
        loading={profile.isPending}
        retry={profile.isError ? () => void profile.refetch() : undefined}
      />
    );
  return <FinancialProfileEditor initial={profile.data} />;
}
function FinancialProfileEditor({ initial }: { initial: FinanceProfileVersion | null }) {
  const { state } = useAuth();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(() => draftFor(initial));
  const [blocked, setBlocked] = useState(false);
  const attempt = useRef<{ signature: string; input: UpdateFinancialProfileInput } | null>(null);
  const dirty = signatureFor(draft) !== signatureFor(draftFor(baseline));
  const allowDismiss = useDirtyDismiss(dirty, action.pending);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const planning = draft.planning ?? financeSetupPlanningSchema.parse({});
  const updatePlanning = (value: FinanceSetupPlanning) => update("planning", value);
  const save = () =>
    confirm(
      "Save financial profile?",
      "Save the reviewed household and planning information. This records stated facts; it does not approve a budget or move money.",
      () =>
        void action.run(async (api) => {
          const signature = signatureFor(draft);
          if (attempt.current && attempt.current.signature !== signature)
            throw new Error(
              "Reload and review the saved profile before changing an uncertain submission.",
            );
          attempt.current ??= {
            signature,
            input: financialProfileInput(baseline, draft, randomUUID()),
          };
          try {
            const next = requireCompletedFinanceResult(
              await api.updateFinancialProfile(attempt.current.input),
            );
            setBaseline(next);
            setDraft(draftFor(next));
            attempt.current = null;
            setBlocked(false);
            await cache.invalidateQueries({ queryKey: ["settings"] });
            await cache.invalidateQueries({ queryKey: ["finances"] });
            return next;
          } catch (error) {
            setBlocked(true);
            throw error;
          }
        }, "Financial profile saved"),
    );
  return (
    <View style={{ flex: 1 }}>
      <FormBody>
        <Stack.Screen
          options={{
            title: "Financial profile",
            gestureEnabled: !dirty,
            ...editorDismissOptions({
              label: dirty ? "Cancel" : "Back",
              disabled: action.pending,
              onPress: () =>
                dirty
                  ? confirm(
                      "Discard financial changes?",
                      "Unsaved changes will be lost.",
                      () => {
                        allowDismiss();
                        router.back();
                      },
                      true,
                    )
                  : router.back(),
            }),
          }}
        />
        <Section title="Household">
          <Field
            label="Country and state or region"
            value={draft.jurisdiction ?? ""}
            editable={!action.pending && !blocked}
            onChangeText={(value) => update("jurisdiction", value.trim() ? value : null)}
            placeholder="United States, New York"
          />
          <NullableNumber
            label="Household size"
            value={draft.householdSize}
            disabled={action.pending || blocked}
            onChange={(value) => update("householdSize", value)}
          />
          <NullableNumber
            label="Dependents"
            value={draft.dependents}
            disabled={action.pending || blocked}
            onChange={(value) => update("dependents", value)}
          />
        </Section>
        <Section title="Income">
          <NullableNumber
            label="Expected monthly take-home"
            value={draft.expectedMonthlyTakeHome}
            currency
            disabled={action.pending || blocked}
            onChange={(value) => update("expectedMonthlyTakeHome", value)}
          />
          <Choice
            label="Income stability"
            value={draft.incomeStability}
            disabled={action.pending || blocked}
            options={["unknown", "stable", "variable", "seasonal"].map((value) => ({
              value,
              label: human(value),
            }))}
            onChange={(value) => update("incomeStability", value as Draft["incomeStability"])}
          />
          <NullableNumber
            label="Reliable monthly income"
            value={
              planning.recurringIncome?.amountCents == null
                ? null
                : planning.recurringIncome.amountCents / 100
            }
            currency
            disabled={action.pending || blocked}
            onChange={(value) =>
              updatePlanning({
                ...planning,
                recurringIncome: {
                  ...planning.recurringIncome,
                  provenance: statement,
                  amountCents: value === null ? null : Math.round(value * 100),
                  nextDate: planning.recurringIncome?.nextDate ?? null,
                },
              })
            }
          />
          <PlanningPicker
            label="Next reliable payment"
            value={planning.recurringIncome?.nextDate ?? ""}
            mode="date"
            optional
            timeZone={state.user?.planningTimezone ?? "UTC"}
            onChange={(value) =>
              !action.pending &&
              !blocked &&
              updatePlanning({
                ...planning,
                recurringIncome: {
                  ...planning.recurringIncome,
                  provenance: statement,
                  amountCents: planning.recurringIncome?.amountCents ?? null,
                  nextDate: value || null,
                },
              })
            }
          />
        </Section>
        <Section title="Reserves and preferences">
          <NullableNumber
            label="Liquid reserves"
            value={draft.liquidReserves}
            currency
            disabled={action.pending || blocked}
            onChange={(value) => update("liquidReserves", value)}
          />
          <NullableNumber
            label="Monthly buffer"
            value={draft.preferences.bufferTarget}
            currency
            disabled={action.pending || blocked}
            onChange={(value) =>
              update("preferences", { ...draft.preferences, bufferTarget: value })
            }
          />
          <NullableNumber
            label="Reserve target (months)"
            value={draft.preferences.emergencyReserveMonths}
            disabled={action.pending || blocked}
            onChange={(value) =>
              update("preferences", { ...draft.preferences, emergencyReserveMonths: value })
            }
          />
          <Choice
            label="Debt priority"
            value={draft.preferences.debtPriority ?? ""}
            options={["", "avalanche", "snowball", "minimums", "custom"].map((value) => ({
              value,
              label: value ? human(value) : "Not chosen",
            }))}
            disabled={action.pending || blocked}
            onChange={(value) =>
              update("preferences", {
                ...draft.preferences,
                debtPriority: (value || null) as Draft["preferences"]["debtPriority"],
              })
            }
          />
          <Field
            label="Planning notes (one per line)"
            multiline
            value={draft.preferences.notes.join("\n")}
            editable={!action.pending && !blocked}
            onChangeText={(value) =>
              update("preferences", { ...draft.preferences, notes: value.split("\n") })
            }
          />
        </Section>
        <FinancialCollections draft={draft} update={update} disabled={action.pending || blocked} />

        <Action
          label="Reload saved profile"
          disabled={action.pending}
          onPress={() =>
            confirm(
              "Reload financial profile?",
              "Replace your draft with the current server profile. An earlier uncertain request may already have been saved; review before submitting again.",
              () =>
                void action.run(async (api) => {
                  const next = requireCompletedFinanceResult(await api.getFinancialProfile());
                  setBaseline(next);
                  setDraft(draftFor(next));
                  attempt.current = null;
                  setBlocked(false);
                }),
            )
          }
        />
        <SectionNote>
          Profile version {baseline?.version ?? 0}. Reliable income, stated planning needs and
          qualified account balances are separate.
        </SectionNote>
      </FormBody>
      <FormSave
        workspace="finances"
        onPress={save}
        disabled={!dirty || action.pending || blocked}
      />
    </View>
  );
}
type PlanningKind =
  | "uncertainIncome"
  | "exceptionalResources"
  | "obligations"
  | "contributions"
  | "priorities";
function FinancialCollections({
  draft,
  update,
  disabled,
}: {
  draft: Draft;
  update: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  disabled: boolean;
}) {
  const { state } = useAuth();
  const debtKeys = useRef(draft.debts.map(() => randomUUID()));
  const insuranceKeys = useRef(draft.insurance.map(() => randomUUID()));
  while (debtKeys.current.length < draft.debts.length) debtKeys.current.push(randomUUID());
  while (insuranceKeys.current.length < draft.insurance.length)
    insuranceKeys.current.push(randomUUID());
  const accounts = useSettingsResource("finance-accounts", (api) => api.listFinanceAccounts());
  const goals = useSettingsResource("finance-goals", async (api) =>
    requireCompletedFinanceResult(await api.listFinanceGoals()),
  );
  const planning = draft.planning ?? financeSetupPlanningSchema.parse({});
  const accountOptions = [
    { value: "", label: "Not linked" },
    ...(accounts.data?.accounts ?? []).map((account) => ({
      value: account.id,
      label: `${account.institution} · ${account.name}`,
    })),
  ];
  const choiceOptions = (value: string, options: { value: string; label: string }[]) =>
    value && !options.some((option) => option.value === value)
      ? [{ value, label: "Current selection unavailable" }, ...options]
      : options;
  const setDebt = (index: number, patch: Partial<Draft["debts"][number]>) =>
    update(
      "debts",
      draft.debts.map((debt, i) => (i === index ? { ...debt, ...patch } : debt)),
    );
  const setInsurance = (index: number, patch: Partial<Draft["insurance"][number]>) =>
    update(
      "insurance",
      draft.insurance.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  const setItems = (
    kind: PlanningKind,
    items: Array<NonNullable<FinanceSetupPlanning[PlanningKind]>[number]> | null,
  ) => update("planning", { ...planning, [kind]: items } as FinanceSetupPlanning);
  return (
    <>
      <Section title="Debts">
        {draft.debts.map((debt, index) => (
          <Section key={debtKeys.current[index]} title={debt.name || `Debt ${index + 1}`}>
            <Field
              label="Debt name"
              value={debt.name}
              editable={!disabled}
              onChangeText={(name) => setDebt(index, { name })}
            />
            <NullableNumber
              label="Balance"
              value={debt.balance}
              currency
              disabled={disabled}
              onChange={(value) => setDebt(index, { balance: value ?? Number.NaN })}
            />
            <NullableNumber
              label="Monthly minimum"
              value={debt.minimumMonthlyPayment}
              currency
              disabled={disabled}
              onChange={(value) => setDebt(index, { minimumMonthlyPayment: value ?? Number.NaN })}
            />
            <NullableNumber
              label="Interest rate (%)"
              value={debt.interestRate}
              disabled={disabled}
              onChange={(interestRate) => setDebt(index, { interestRate })}
            />
            <Choice
              label="Debt account"
              value={debt.accountId ?? ""}
              options={choiceOptions(debt.accountId ?? "", accountOptions)}
              disabled={disabled || !accounts.data}
              onChange={(value) => setDebt(index, { accountId: value || null })}
            />
            <Action
              label={`Remove debt ${index + 1}`}
              disabled={disabled}
              destructive
              onPress={() =>
                confirm(
                  `Remove ${debt.name || "debt"}?`,
                  "Remove this stated debt from the draft financial profile. The account and transactions will not be deleted.",
                  () => {
                    debtKeys.current.splice(index, 1);
                    update(
                      "debts",
                      draft.debts.filter((_, i) => i !== index),
                    );
                  },
                  true,
                )
              }
            />
          </Section>
        ))}
        <Action
          label="Add debt"
          disabled={disabled}
          onPress={() =>
            update("debts", [
              ...draft.debts,
              {
                name: "",
                accountId: null,
                balance: 0,
                interestRate: null,
                minimumMonthlyPayment: 0,
              },
            ])
          }
        />
      </Section>
      <Section title="Insurance">
        {draft.insurance.map((entry, index) => (
          <Section key={insuranceKeys.current[index]} title={entry.name || `Policy ${index + 1}`}>
            <Field
              label="Policy name"
              value={entry.name}
              editable={!disabled}
              onChangeText={(name) => setInsurance(index, { name })}
            />
            <Choice
              label="Kind"
              value={entry.kind}
              options={["health", "life", "disability", "property", "liability", "other"].map(
                (value) => ({ value, label: human(value) }),
              )}
              disabled={disabled}
              onChange={(value) => setInsurance(index, { kind: value as typeof entry.kind })}
            />
            <Choice
              label="Status"
              value={entry.status}
              options={["active", "lapsed", "cancelled", "unknown"].map((value) => ({
                value,
                label: human(value),
              }))}
              disabled={disabled}
              onChange={(value) => setInsurance(index, { status: value as typeof entry.status })}
            />
            <NullableNumber
              label="Annual premium"
              value={entry.annualPremium}
              currency
              disabled={disabled}
              onChange={(annualPremium) => setInsurance(index, { annualPremium })}
            />
            <NullableNumber
              label="Coverage amount"
              value={entry.coverageAmount}
              currency
              disabled={disabled}
              onChange={(coverageAmount) => setInsurance(index, { coverageAmount })}
            />
            <Action
              label={`Remove insurance ${index + 1}`}
              disabled={disabled}
              destructive
              onPress={() =>
                confirm(
                  `Remove ${entry.name || "insurance"}?`,
                  "This removes the stated policy from your financial profile when you save. It does not cancel the policy.",
                  () => {
                    insuranceKeys.current.splice(index, 1);
                    update(
                      "insurance",
                      draft.insurance.filter((_, i) => i !== index),
                    );
                  },
                  true,
                )
              }
            />
          </Section>
        ))}
        <Action
          label="Add insurance"
          disabled={disabled}
          onPress={() =>
            update("insurance", [
              ...draft.insurance,
              {
                name: "",
                kind: "other",
                status: "unknown",
                annualPremium: null,
                coverageAmount: null,
              },
            ])
          }
        />
      </Section>
      {(
        [
          ["obligations", "Bills and minimum payments"],
          ["uncertainIncome", "Other possible income"],
          ["exceptionalResources", "One-time resources"],
          ["contributions", "Goal contributions"],
          ["priorities", "Spending priorities"],
        ] as [PlanningKind, string][]
      ).map(([kind, title]) => {
        const dated = kind === "uncertainIncome" || kind === "exceptionalResources";
        const items = planning[kind];
        return (
          <Section key={kind} title={title}>
            {items === null && <State empty="Not provided yet." />}
            {items?.map((item, index) => {
              const patch = (change: Record<string, unknown>) =>
                setItems(
                  kind,
                  items.map((current, i) =>
                    i === index ? { ...current, ...change, provenance: statement } : current,
                  ),
                );
              const related =
                "goalId" in item
                  ? item.goalId
                  : "debtAccountId" in item
                    ? (item.debtAccountId ?? "")
                    : "";
              const options =
                kind === "contributions"
                  ? [
                      { value: "", label: "Choose a goal" },
                      ...(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.name })),
                    ]
                  : accountOptions;
              return (
                <Section key={item.id} title={item.name || `Item ${index + 1}`}>
                  <Field
                    label="Name"
                    value={item.name}
                    editable={!disabled}
                    onChangeText={(name) => patch({ name })}
                  />
                  <NullableNumber
                    label={dated ? "Expected amount" : "Monthly amount"}
                    value={item.amountCents === null ? null : item.amountCents / 100}
                    currency
                    disabled={disabled}
                    onChange={(value) =>
                      patch({ amountCents: value === null ? null : Math.round(value * 100) })
                    }
                  />
                  {"expectedDate" in item ? (
                    <PlanningPicker
                      mode="date"
                      optional
                      timeZone={state.user?.planningTimezone ?? "UTC"}
                      label="Expected date"
                      value={item.expectedDate ?? ""}
                      onChange={(expectedDate) => {
                        if (!disabled) patch({ expectedDate: expectedDate || null });
                      }}
                    />
                  ) : (
                    <NullableNumber
                      label="Due day of month"
                      value={item.dueDay}
                      disabled={disabled}
                      onChange={(dueDay) => patch({ dueDay })}
                    />
                  )}
                  {(kind === "contributions" || kind === "obligations") && (
                    <Choice
                      label={kind === "contributions" ? "Goal" : "Debt account"}
                      value={related}
                      options={choiceOptions(related, options)}
                      disabled={
                        disabled || (kind === "contributions" ? !goals.data : !accounts.data)
                      }
                      onChange={(value) =>
                        patch(
                          kind === "contributions"
                            ? { goalId: value }
                            : { debtAccountId: value || null },
                        )
                      }
                    />
                  )}
                  {"protected" in item && (
                    <ToggleRow
                      label="Protect this priority"
                      value={item.protected}
                      disabled={disabled}
                      onChange={(value) => patch({ protected: value })}
                    />
                  )}
                  <Action
                    label={`Remove ${title.toLowerCase()} item ${index + 1}`}
                    disabled={disabled}
                    destructive
                    onPress={() =>
                      confirm(
                        `Remove ${item.name || "item"}?`,
                        "Remove this stated item from your draft. Save the financial profile to commit the change.",
                        () =>
                          setItems(
                            kind,
                            items.filter((_, i) => i !== index),
                          ),
                        true,
                      )
                    }
                  />
                </Section>
              );
            })}
            <Action
              label={`Add ${title.toLowerCase()}`}
              disabled={disabled}
              onPress={() => {
                const entry = {
                  id: randomUUID(),
                  name: "",
                  amountCents: null,
                  provenance: statement,
                  ...(dated ? { expectedDate: null } : { dueDay: null }),
                  ...(kind === "obligations" ? { debtAccountId: null } : {}),
                  ...(kind === "contributions" ? { goalId: "" } : {}),
                  ...(kind === "priorities" ? { categoryId: null, protected: false } : {}),
                };
                setItems(kind, [...(items ?? []), entry] as NonNullable<
                  FinanceSetupPlanning[PlanningKind]
                >);
              }}
            />
            {items === null && (
              <Action
                label={`Confirm no ${title.toLowerCase()}`}
                disabled={disabled}
                onPress={() => setItems(kind, [])}
              />
            )}
          </Section>
        );
      })}
      {accounts.isError && (
        <Action label="Retry loading related accounts" onPress={() => void accounts.refetch()} />
      )}
      {goals.isError && (
        <Action label="Retry loading financial goals" onPress={() => void goals.refetch()} />
      )}
    </>
  );
}
export function PayrollSettingsScreen() {
  const { state, session } = useAuth();
  return <PayrollLoader key={`${state.user?.id}-${session.epoch()}`} />;
}
function PayrollLoader() {
  const configuration = useSettingsResource("finance-configuration", (api) =>
    api.getFinanceConfiguration(),
  );
  if (configuration.data?.income.state !== "loaded")
    return <State loading={configuration.isPending} retry={() => void configuration.refetch()} />;
  return (
    <PayrollEditor
      initial={configuration.data.income.value}
      accounts={
        configuration.data.accounts.state === "loaded"
          ? configuration.data.accounts.value.accounts.map((account) => ({
              value: account.id,
              label: `${account.institution} · ${account.name}`,
            }))
          : null
      }
    />
  );
}
export function payrollInput(
  initial: FinanceProfile | null,
  draft: Record<string, string>,
  planningTimezone: string,
) {
  return updateFinanceProfileInputSchema.parse({
    ...initial,
    expectedUpdatedAt: initial?.updatedAt ?? null,
    effectiveDate:
      initial?.effectiveDate ?? localDateToIso(localDateAt(new Date(), planningTimezone)),
    ...Object.fromEntries(
      Object.entries(draft).map(([key, value]) => [
        key,
        value.trim()
          ? key === "grossAnnualIncome" || key === "expectedNetPay"
            ? financeAmount(value)
            : value.trim()
          : null,
      ]),
    ),
  });
}
const payrollFields = [
  "employer",
  "role",
  "employmentType",
  "grossAnnualIncome",
  "expectedNetPay",
  "payFrequency",
  "nextPayday",
  "payAccountId",
] as const;
function PayrollEditor({
  initial,
  accounts,
}: {
  initial: FinanceProfile | null;
  accounts: { value: string; label: string }[] | null;
}) {
  const { state } = useAuth();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const forProfile = (profile: FinanceProfile | null) =>
    Object.fromEntries(payrollFields.map((key) => [key, profile?.[key]?.toString() ?? ""]));
  const [draft, setDraft] = useState(() => forProfile(initial));
  const [blocked, setBlocked] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(forProfile(baseline));
  const allowDismiss = useDirtyDismiss(dirty, action.pending);
  const options: Record<string, { value: string; label: string }[]> = {
    employmentType: ["full_time", "part_time", "contract", "self_employed", "unemployed"].map(
      (value) => ({ value, label: human(value) }),
    ),
    payFrequency: ["weekly", "biweekly", "semimonthly", "monthly", "irregular"].map((value) => ({
      value,
      label: human(value),
    })),
    payAccountId: accounts ?? [],
  };
  const labels: Record<(typeof payrollFields)[number], string> = {
    employer: "Employer",
    role: "Role",
    employmentType: "Employment type",
    grossAnnualIncome: "Gross annual income",
    expectedNetPay: "Expected net paycheck",
    payFrequency: "Pay frequency",
    nextPayday: "Next payday",
    payAccountId: "Pay account",
  };
  return (
    <View style={{ flex: 1 }}>
      <FormBody>
        <Stack.Screen
          options={{
            title: "Payroll details",
            gestureEnabled: !dirty,
            ...editorDismissOptions({
              label: dirty ? "Cancel" : "Back",
              disabled: action.pending,
              onPress: () =>
                dirty
                  ? confirm(
                      "Discard payroll changes?",
                      "Unsaved changes will be lost.",
                      () => {
                        allowDismiss();
                        router.back();
                      },
                      true,
                    )
                  : router.back(),
            }),
          }}
        />
        <Section title="Payroll details">
          {payrollFields.map((key) =>
            key === "nextPayday" ? (
              <PlanningPicker
                key={key}
                label="Next payday"
                mode="date"
                optional
                timeZone={state.user?.planningTimezone ?? "UTC"}
                value={draft[key] ?? ""}
                onChange={(value) => {
                  if (!action.pending && !blocked)
                    setDraft((current) => ({ ...current, [key]: value }));
                }}
              />
            ) : options[key] ? (
              <Choice
                key={key}
                label={labels[key]}
                value={draft[key] ?? ""}
                disabled={action.pending || blocked || (key === "payAccountId" && !accounts)}
                options={[
                  { value: "", label: "Not provided" },
                  ...(draft[key] && !options[key].some((option) => option.value === draft[key])
                    ? [{ value: draft[key] ?? "", label: "Current value unavailable" }]
                    : []),
                  ...options[key],
                ]}
                onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
              />
            ) : (
              <Field
                key={key}
                label={labels[key]}
                value={draft[key] ?? ""}
                editable={!action.pending && !blocked}
                keyboardType={
                  key === "grossAnnualIncome" || key === "expectedNetPay"
                    ? "decimal-pad"
                    : "default"
                }
                onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
              />
            ),
          )}
        </Section>

        <Action
          label="Reload payroll details"
          disabled={action.pending}
          onPress={() =>
            confirm(
              "Reload payroll details?",
              "Replace your draft with current saved payroll details. Review any pending change before submitting again.",
              () =>
                void action.run(async (api) => {
                  const config = await api.getFinanceConfiguration();
                  if (config.income.state !== "loaded")
                    throw new Error("Payroll details are unavailable.");
                  setBaseline(config.income.value);
                  setDraft(forProfile(config.income.value));
                  setBlocked(false);
                }),
            )
          }
        />
      </FormBody>
      <FormSave
        workspace="finances"
        disabled={!dirty || action.pending || blocked}
        onPress={() =>
          void action.run(async (api) => {
            try {
              const result = await api.updateFinanceProfile(
                payrollInput(baseline, draft, state.user?.planningTimezone ?? "UTC"),
              );
              if ("status" in result) {
                if (result.status !== "applied")
                  throw new Error(
                    result.status === "pending_review"
                      ? "This payroll change is pending review. Your draft is retained; reload to check the saved state before changing it again."
                      : "More information is required before this payroll change can apply.",
                  );
                setBaseline(result.result);
                setDraft(forProfile(result.result));
              } else {
                setBaseline(result);
                setDraft(forProfile(result));
              }
              await cache.invalidateQueries({ queryKey: ["settings"] });
              await cache.invalidateQueries({ queryKey: ["finances"] });
            } catch (error) {
              setBlocked(true);
              throw error;
            }
          }, "Payroll details saved")
        }
      />
    </View>
  );
}
