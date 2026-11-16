import type { FinanceCategory, FinanceScenarioResult } from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, Actions, PaddedSurfaceRows, ToggleRow } from "../../components/forms/form-rows";
import { FormSave, useFormKeyboardOffset } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import {
  cashflowDate,
  newScenarioDraft,
  type ScenarioDraft,
  scenarioAmount,
  scenarioInput,
  scenarioMoneyFields,
} from "./cashflow-rules";
import { useFinance, useFinanceRead } from "./data";
import { localToday } from "./mutations";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

/** Scenario amounts carry no currency of their own, so none is shown beside them. */
const plainAmount = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ScenarioFields({
  draft,
  index,
  categories,
  disabled,
  onChange,
  onRemove,
}: {
  draft: ScenarioDraft;
  index: number;
  categories: readonly FinanceCategory[];
  disabled: boolean;
  onChange: (draft: ScenarioDraft) => void;
  onRemove: () => void;
}) {
  const name = index === 0 ? "Baseline" : `Alternative ${index}`;
  const row = (id: string, change: Partial<ScenarioDraft["allocations"][number]>) =>
    onChange({
      ...draft,
      allocations: draft.allocations.map((item) =>
        item.id === id ? { ...item, ...change } : item,
      ),
    });
  return (
    <Section title={name}>
      <Card rows>
        <PaddedSurfaceRows>
          <TextRow
            label={`${name} name`}
            value={draft.label}
            onChangeText={(label) => onChange({ ...draft, label })}
            editable={!disabled}
            maxLength={160}
            placeholder="Required"
          />
          {scenarioMoneyFields.map((field) => {
            const text = draft.money[field.key];
            return (
              <TextRow
                key={field.key}
                label={`${name} ${field.label.toLowerCase()}`}
                value={text}
                onChangeText={(value) =>
                  onChange({ ...draft, money: { ...draft.money, [field.key]: value } })
                }
                editable={!disabled}
                correction={
                  text.trim() && scenarioAmount(text, field.key === "startingCash") === undefined
                    ? "Enter an amount such as 1500.00."
                    : undefined
                }
                keyboardType="numbers-and-punctuation"
                placeholder={field.required ? "Required" : "Optional"}
              />
            );
          })}
        </PaddedSurfaceRows>
      </Card>
      <Card rows>
        <PaddedSurfaceRows>
          {draft.allocations.map((item, position) => (
            <View key={item.id}>
              <EnumChoice
                label={`${name} spending ${position + 1}`}
                icon="categoryLayers"
                value={item.categoryId || null}
                valueLabel={item.categoryId ? undefined : "Choose a category"}
                disabled={disabled}
                options={categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
                onChange={(categoryId) => row(item.id, { categoryId })}
              />
              <TextRow
                label={`${name} spending ${position + 1} amount`}
                value={item.limit}
                onChangeText={(limit) => row(item.id, { limit })}
                editable={!disabled}
                correction={
                  item.limit.trim() && !scenarioAmount(item.limit)
                    ? "Enter an amount above 0, such as 400.00."
                    : undefined
                }
                keyboardType="decimal-pad"
                placeholder="Required"
              />
              <Actions>
                <Action
                  label="Remove"
                  accessibilityLabel={`Remove ${name.toLowerCase()} spending ${position + 1}`}
                  destructive
                  disabled={disabled}
                  onPress={() =>
                    onChange({
                      ...draft,
                      allocations: draft.allocations.filter((entry) => entry.id !== item.id),
                    })
                  }
                />
              </Actions>
            </View>
          ))}
          {draft.allocations.length === 0 && (
            <ToggleRow
              label={`${name} has no other monthly spending`}
              value={draft.noOtherSpending}
              disabled={disabled}
              onChange={(noOtherSpending) => onChange({ ...draft, noOtherSpending })}
            />
          )}
          <TextRow
            label={`${name} assumptions`}
            value={draft.assumptions}
            onChangeText={(assumptions) => onChange({ ...draft, assumptions })}
            editable={!disabled}
            multiline
            placeholder="Optional, one per line"
          />
        </PaddedSurfaceRows>
      </Card>
      <Actions inset={false}>
        {index > 0 && (
          <Action
            label="Remove"
            accessibilityLabel={`Remove alternative ${index}`}
            destructive
            disabled={disabled}
            onPress={onRemove}
          />
        )}
        <Action
          label="Add spending"
          accessibilityLabel={`Add ${name.toLowerCase()} spending`}
          disabled={disabled || categories.length === 0 || draft.allocations.length >= 100}
          onPress={() =>
            onChange({
              ...draft,
              noOtherSpending: false,
              allocations: [...draft.allocations, { id: randomUUID(), categoryId: "", limit: "" }],
            })
          }
        />
      </Actions>
    </Section>
  );
}

function ScenarioResult({
  result,
  horizon,
  changed,
}: {
  result: FinanceScenarioResult;
  horizon: number;
  changed: boolean;
}) {
  const notes = [
    { title: "Missing inputs", items: result.missingInputs },
    { title: "Sensitivity warnings", items: result.sensitivityWarnings },
    { title: "Goal conflicts", items: result.goalConflicts },
    { title: "Assumptions used", items: result.assumptions },
  ];
  const projections = [result.baseline, ...result.alternatives];
  return (
    <Section title="Comparison">
      <Copy secondary>
        Hypothetical and read only: as of {cashflowDate(result.asOf)} over {horizon} months. Your
        plan is unchanged.
        {changed
          ? " These results are for your previous entries; compare again to include your edits."
          : ""}
      </Copy>
      {projections.map((projection) => (
        <Card rows key={projection.label}>
          <FinanceRow centered title={projection.label} icon="views" />
          <FinanceRow
            centered
            title="Monthly cash flow"
            value={plainAmount(projection.monthlyCashFlow)}
            icon="wallet"
          />
          <FinanceRow
            centered
            title="Lowest cash balance"
            value={plainAmount(projection.projectedLowestBalance)}
            icon="finances"
          />
          <FinanceRow
            centered
            title="Reserve runway"
            value={
              projection.reserveRunwayMonths === null
                ? "Unavailable"
                : `${Math.round(projection.reserveRunwayMonths * 10) / 10} months`
            }
            icon="clock"
          />
          <FinanceRow
            centered
            title="Debt payoff"
            value={
              projection.debtPayoffMonths === null
                ? "Unavailable"
                : `${projection.debtPayoffMonths} months`
            }
            icon="target"
          />
          {projection.goalDateEffects.map((effect) => (
            <Copy key={effect} secondary>
              {effect}
            </Copy>
          ))}
        </Card>
      ))}
      {notes
        .filter((group) => group.items.length)
        .map((group) => (
          <Card key={group.title}>
            <Copy>{group.title}</Copy>
            {group.items.map((item) => (
              <Copy key={item} secondary>
                {item}
              </Copy>
            ))}
          </Card>
        ))}
    </Section>
  );
}

/** Compares fixed monthly assumptions side by side. Nothing here changes the live plan. */
export function FinanceScenarios() {
  const { api, owner, timezone } = useFinance();
  const keyboardOffset = useFormKeyboardOffset();
  const categories = useFinanceRead(["categories"], (client) => client.getFinanceCategories());
  const [drafts, setDrafts] = useState(() => [
    newScenarioDraft(randomUUID(), "Current assumptions"),
    newScenarioDraft(randomUUID(), "Alternative"),
  ]);
  const [asOf, setAsOf] = useState<string | null>(timezone ? localToday(timezone) : null);
  const [horizon, setHorizon] = useState("12");
  const [pending, setPending] = useState(false);
  const [compared, setCompared] = useState<{
    signature: string;
    horizon: number;
    result: FinanceScenarioResult;
  } | null>(null);
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
  const prepared = scenarioInput(drafts, asOf, horizon);
  const signature = JSON.stringify({ drafts, asOf, horizon });
  async function compare() {
    if (lock.current || !("input" in prepared)) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading("Comparing scenarios…");
    const sent = signature;
    try {
      const result = await api.compareFinanceScenarios(prepared.input);
      if (!active.current || currentOwner.current !== owner) return void toast.dismiss(id);
      setCompared({ signature: sent, horizon: prepared.input.horizonMonths, result });
      toast.success("Comparison ready", { id });
    } catch {
      if (!active.current || currentOwner.current !== owner) return void toast.dismiss(id);
      toast.error("Couldn’t compare these scenarios. Your entries are still here.", { id });
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "scenarios" }} />
      <FinanceScreen title="Scenarios">
        <Copy secondary>
          Compare fixed monthly assumptions before changing your plan. Enter every required amount,
          including 0 when a cost does not apply. Amounts are in your plan’s currency.
        </Copy>
        <Card rows>
          <PaddedSurfaceRows>
            <SettingsAccentProvider workspace="finances">
              <DateField
                label="As of"
                dateOnly
                value={asOf}
                onChange={(value) => {
                  if (!lock.current) setAsOf(value ? value.slice(0, 10) : null);
                }}
              />
            </SettingsAccentProvider>
            <TextRow
              label="Horizon in months"
              value={horizon}
              onChangeText={setHorizon}
              editable={!pending}
              keyboardType="number-pad"
              maxLength={3}
              placeholder="Required"
            />
          </PaddedSurfaceRows>
        </Card>
        {categories.isError && <ReadState query={categories}>{null}</ReadState>}
        <SettingsAccentProvider workspace="finances">
          {drafts.map((draft, index) => (
            <ScenarioFields
              key={draft.id}
              draft={draft}
              index={index}
              categories={categories.data ?? []}
              disabled={pending}
              onChange={(next) =>
                setDrafts((current) => current.map((item) => (item.id === draft.id ? next : item)))
              }
              onRemove={() =>
                setDrafts((current) => current.filter((item) => item.id !== draft.id))
              }
            />
          ))}
          <Actions inset={false}>
            <Action
              label="Add alternative"
              disabled={pending || drafts.length >= 6}
              onPress={() =>
                setDrafts((current) => [
                  ...current,
                  newScenarioDraft(randomUUID(), `Alternative ${current.length}`),
                ])
              }
            />
          </Actions>
        </SettingsAccentProvider>
        {"problem" in prepared && <Copy>{prepared.problem}</Copy>}
        {compared && (
          <ScenarioResult
            result={compared.result}
            horizon={compared.horizon}
            changed={compared.signature !== signature}
          />
        )}
        <View style={{ height: 80 }} />
      </FinanceScreen>
      <FormSave
        workspace="finances"
        keyboardOffset={keyboardOffset}
        label="Compare"
        icon="views"
        disabled={pending || !("input" in prepared)}
        onPress={() => void compare()}
      />
    </View>
  );
}
