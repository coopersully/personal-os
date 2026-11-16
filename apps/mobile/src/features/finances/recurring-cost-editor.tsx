import type { FinanceRecurringObligation } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { EnumChoice } from "../../components/forms/enum-choice";
import { PaddedSurfaceRows, ToggleRow } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { DateField } from "../tasks/date-field";
import { TextRow } from "./account-editor";
import { until, useFinanceWrite, useRecurringItem, useSettled } from "./cashflow-data";
import { CashflowForm } from "./cashflow-form";
import {
  cadenceLabel,
  costStatement,
  exactCents,
  isObligation,
  recurringAmount,
} from "./cashflow-rules";
import { useFinance } from "./data";
import { isCalendarDate } from "./goal-progress";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

const kinds = [
  { value: "fixed", label: "Fixed" },
  { value: "variable", label: "Variable" },
];

function CostForm(props: {
  item: FinanceRecurringObligation & { revision: number };
  account: { name: string; currencyCode: string | null } | undefined;
  today: string | null;
}) {
  const { api } = useFinance();
  const write = useFinanceWrite();
  // The statement is made about the version that was open; a refresh never moves it.
  const [{ item, account }] = useState(props);
  const { today } = props;
  const earlier = costStatement(item);
  const [fixedness, setFixedness] = useState<string>(earlier?.fixedness ?? "");
  const [currency, setCurrency] = useState(account?.currencyCode ?? earlier?.currencyCode ?? "");
  const [asOf, setAsOf] = useState<string | null>(today);
  const [stated, setStated] = useState(false);
  const [edited, setEdited] = useState(false);
  const edit = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      if (write.locked.current) return;
      set(value);
      setEdited(true);
    };
  };
  const cents = exactCents(item.expectedAmount);
  const invalidCurrency = !!currency && !/^[A-Z]{3}$/.test(currency);
  const wrongCurrency =
    !invalidCurrency && !!currency && !!account?.currencyCode && account.currencyCode !== currency;
  const invalidDate = !!asOf && !isCalendarDate(asOf);
  const futureDate = !!asOf && !invalidDate && !!today && asOf > today;
  const invalid =
    cents === undefined ||
    (fixedness !== "fixed" && fixedness !== "variable") ||
    !/^[A-Z]{3}$/.test(currency) ||
    wrongCurrency ||
    !asOf ||
    invalidDate ||
    !today ||
    futureDate ||
    !stated;
  async function save() {
    if (invalid || cents === undefined || !asOf) return;
    const input = {
      operation: "confirm_cost" as const,
      itemType: "obligation" as const,
      itemId: item.id,
      expectedRevision: item.revision,
      expectedAmountCents: cents,
      cadence: item.cadence,
      accountId: item.accountId,
      currencyCode: currency,
      fixedness: fixedness as "fixed" | "variable",
      asOf,
    };
    const saved = await write.run(
      input,
      (idempotencyKey) => api.manageFinanceRecurringItem({ ...input, idempotencyKey }),
      {
        loading: "Saving cost statement…",
        done: "Cost statement saved",
        conflict:
          "This item changed elsewhere. Close and reopen it to state the cost of the latest version.",
        rejected:
          "Couldn’t save this cost statement. Check the currency and date; your entries are still here.",
        unknown:
          "Couldn’t confirm the cost statement was saved. Your entries are still here. Check the item before retrying.",
      },
    );
    if (saved) router.back();
  }
  return (
    <CashflowForm
      title="Confirm cost"
      edited={edited}
      pending={write.pending}
      invalid={invalid}
      discard="Your cost statement has not been saved."
      onSave={() => void save()}
    >
      <Copy secondary>{item.displayName}</Copy>
      <Card rows>
        <PaddedSurfaceRows>
          <FinanceRow
            centered
            title="Expected amount"
            value={recurringAmount(item, account ? [{ ...account, id: item.accountId ?? "" }] : [])}
            icon="receipt"
          />
          <FinanceRow centered title="Repeats" value={cadenceLabel(item.cadence)} icon="refresh" />
          <FinanceRow
            centered
            title="Account"
            value={account?.name ?? (item.accountId ? "Unavailable" : "None established")}
            icon="finances"
          />
          <EnumChoice
            label="Cost type"
            icon="wallet"
            value={fixedness || null}
            valueLabel={fixedness ? undefined : "Required"}
            disabled={write.pending}
            options={kinds}
            onChange={edit(setFixedness)}
          />
          <TextRow
            label="Currency"
            value={currency}
            onChangeText={(value) => edit(setCurrency)(value.toUpperCase())}
            editable={!write.pending}
            correction={
              invalidCurrency
                ? "Use a three-letter code such as USD."
                : wrongCurrency
                  ? `This account is held in ${account?.currencyCode}.`
                  : undefined
            }
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
              onChange={(value) => edit(setAsOf)(value ? value.slice(0, 10) : null)}
            />
            <ToggleRow
              label="This is my statement"
              detail="The amount, schedule and account above describe this cost on that date."
              value={stated}
              disabled={write.pending}
              onChange={edit(setStated)}
            />
          </SettingsAccentProvider>
        </PaddedSurfaceRows>
      </Card>
      {cents === undefined && (
        <Copy>
          This item’s expected amount is not exact to the cent, so its cost cannot be stated.
        </Copy>
      )}
      {invalidDate && <Copy>Enter the date as a calendar date such as 2026-02-01.</Copy>}
      {futureDate && <Copy>The statement date cannot be in the future.</Copy>}
      {!today && <Copy>Set your account timezone in Settings to choose the date.</Copy>}
      <Copy secondary>
        Cost type, Currency and As of are required. State whether this expected payment is fixed or
        variable. This saves your statement and does not change the payment with its provider.
        Saving starts a new version of this item, so its schedule will need confirming again.
      </Copy>
    </CashflowForm>
  );
}

/** Records whether the bill or subscription named by `id` has a fixed or a variable cost. */
export function FinanceRecurringCost() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { query, accounts, item, account, today } = useRecurringItem("obligation", id);
  const settled = useSettled(query, accounts);
  const open =
    item &&
    isObligation(item) &&
    item.kind !== "savings" &&
    (item.status === "active" || item.status === "needs_review");
  return (
    <ReadState query={until(query, settled)}>
      <Stack.Screen options={{ title: "cost" }} />
      <ReadState query={accounts}>
        {item && isObligation(item) && open && item.revision ? (
          <CostForm
            key={item.id}
            item={{ ...item, revision: item.revision }}
            account={account}
            today={today}
          />
        ) : (
          <FinanceScreen title="Cost">
            <Copy secondary>This recurring item is unavailable.</Copy>
          </FinanceScreen>
        )}
      </ReadState>
    </ReadState>
  );
}
