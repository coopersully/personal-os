import { type FinanceProfileVersion, financeSetupPlanningSchema } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { SettingsSection } from "../settings/settings-layout.js";
import { financeCurrencyNumber, financeStatementSource } from "./configuration-values.js";
import { requireFinanceResult } from "./position-material.js";
import { useFinanceProfileField } from "./use-finance-configuration.js";

type Kind =
  | "debts"
  | "uncertainIncome"
  | "exceptionalResources"
  | "obligations"
  | "contributions"
  | "priorities";
type Row = {
  id: string;
  name: string;
  amount: string;
  balance: string;
  day: string;
  relatedId: string;
  protected: boolean;
  original?: Record<string, unknown>;
};
const groups: Array<[Kind, string]> = [
  ["debts", "Debts"],
  ["obligations", "Bills and minimum payments"],
  ["uncertainIncome", "Other possible income"],
  ["exceptionalResources", "One-time resources"],
  ["contributions", "Goal contributions"],
  ["priorities", "Spending priorities"],
];
const number = (value: string) => (value.trim() ? Number(value) : null);
function cents(value: string) {
  const amount = financeCurrencyNumber(value);
  return amount === null ? null : Math.round(amount * 100);
}
function rowsFor(profile: FinanceProfileVersion | null, kind: Kind): Row[] | null {
  if (kind === "debts")
    return profile && (profile.provenance.debts || profile.debts.length > 0)
      ? profile.debts.map((debt, index) => ({
          id: `debt-${index}`,
          name: debt.name,
          amount: String(debt.minimumMonthlyPayment),
          balance: String(debt.balance),
          day: "",
          relatedId: debt.accountId ?? "",
          protected: false,
          original: debt,
        }))
      : null;
  return (
    profile?.planning?.[kind]?.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amountCents === null ? "" : String(item.amountCents / 100),
      balance: "",
      day: "expectedDate" in item ? (item.expectedDate ?? "") : (item.dueDay?.toString() ?? ""),
      relatedId:
        "goalId" in item ? item.goalId : "debtAccountId" in item ? (item.debtAccountId ?? "") : "",
      protected: "protected" in item ? item.protected : false,
      original: item,
    })) ?? null
  );
}
export function FinanceConfigurationCollections({
  profile,
}: {
  profile: FinanceProfileVersion | null;
}) {
  return (
    <>
      {groups.map(([kind, title]) => (
        <Collection key={kind} kind={kind} title={title} profile={profile} />
      ))}
    </>
  );
}
function Collection({
  kind,
  title,
  profile,
}: {
  kind: Kind;
  title: string;
  profile: FinanceProfileVersion | null;
}) {
  const dated = kind === "uncertainIncome" || kind === "exceptionalResources";
  const field = useFinanceProfileField<Row[] | null>(
    kind,
    rowsFor(profile, kind),
    (rows, current) => {
      if (kind === "debts")
        return {
          debts: (rows ?? []).map((row) => {
            if (!row.name.trim() || !row.balance.trim() || !row.amount.trim())
              throw new Error("Complete the debt name, balance and minimum payment.");
            return {
              ...row.original,
              name: row.name.trim(),
              balance: Number(financeCurrencyNumber(row.balance)),
              minimumMonthlyPayment: Number(financeCurrencyNumber(row.amount)),
              accountId: row.relatedId || null,
              interestRate:
                typeof row.original?.interestRate === "number" ? row.original.interestRate : null,
            };
          }),
        };
      const items =
        rows?.map((row) => {
          if (!row.name.trim()) throw new Error("Enter a name before saving this row.");
          return {
            ...row.original,
            id: row.id,
            name: row.name.trim(),
            amountCents: cents(row.amount),
            provenance: financeStatementSource,
            ...(dated ? { expectedDate: row.day || null } : { dueDay: number(row.day) }),
            ...(kind === "obligations" ? { debtAccountId: row.relatedId || null } : {}),
            ...(kind === "contributions" ? { goalId: row.relatedId } : {}),
            ...(kind === "priorities"
              ? { categoryId: row.original?.categoryId ?? null, protected: row.protected }
              : {}),
          };
        }) ?? null;
      return {
        planning: financeSetupPlanningSchema.parse({
          ...financeSetupPlanningSchema.parse(current?.planning ?? {}),
          [kind]: items,
        }),
      };
    },
  );
  const goals = useQuery({
    queryKey: ["finance-goals"],
    queryFn: async () => requireFinanceResult(await api.listFinanceGoals()),
    enabled: kind === "contributions",
  });
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
    enabled: kind === "debts" || kind === "obligations",
  });
  function update(id: string, change: Partial<Row>, commit = false) {
    const next = (field.value ?? []).map((row) => (row.id === id ? { ...row, ...change } : row));
    field.setValue(next);
    if (commit) commitRows(next);
  }
  function commitRows(next = field.value) {
    if (
      next?.some(
        (row) =>
          !row.name.trim() ||
          (kind === "debts" && (!row.amount.trim() || !row.balance.trim())) ||
          (kind === "contributions" && !row.relatedId),
      )
    )
      return;
    field.commit(next);
  }
  const rows = field.value ?? [];
  return (
    <SettingsSection
      title={title}
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Add ${title.toLowerCase()}`}
          onClick={() =>
            field.setValue([
              ...rows,
              {
                id: crypto.randomUUID(),
                name: "",
                amount: "",
                balance: "",
                day: "",
                relatedId: "",
                protected: false,
              },
            ])
          }
        >
          <PlusIcon />
        </Button>
      }
    >
      <ItemGroup>
        {rows.map((row) => (
          <Item key={row.id} variant="secondary">
            <ItemContent>
              <fieldset
                aria-label={`${kind} entry`}
                className="grid gap-3 sm:grid-cols-2"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    commitRows();
                }}
              >
                <Field>
                  <FieldLabel htmlFor={`${kind}-${row.id}-name`}>Name</FieldLabel>
                  <Input
                    id={`${kind}-${row.id}-name`}
                    value={row.name}
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${kind}-${row.id}-amount`}>
                    {kind === "debts"
                      ? "Monthly minimum"
                      : dated
                        ? "Expected amount"
                        : "Monthly amount"}
                  </FieldLabel>
                  <CurrencyInput
                    id={`${kind}-${row.id}-amount`}
                    value={row.amount}
                    onValueChange={(amount) => update(row.id, { amount })}
                  />
                </Field>
                {kind === "debts" ? (
                  <Field>
                    <FieldLabel htmlFor={`${kind}-${row.id}-balance`}>Balance</FieldLabel>
                    <CurrencyInput
                      id={`${kind}-${row.id}-balance`}
                      value={row.balance}
                      onValueChange={(balance) => update(row.id, { balance })}
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor={`${kind}-${row.id}-day`}>
                      {dated ? "Expected date" : "Due day of month"}
                    </FieldLabel>
                    {dated ? (
                      <DateInput
                        id={`${kind}-${row.id}-day`}
                        value={row.day}
                        onValueChange={(day) => update(row.id, { day })}
                        onValueCommit={(day) => update(row.id, { day }, true)}
                      />
                    ) : (
                      <Input
                        id={`${kind}-${row.id}-day`}
                        type="number"
                        min={1}
                        max={31}
                        value={row.day}
                        onChange={(event) => update(row.id, { day: event.target.value })}
                      />
                    )}
                  </Field>
                )}
                {kind === "contributions" || kind === "obligations" || kind === "debts" ? (
                  <Field>
                    <FieldLabel htmlFor={`${kind}-${row.id}-related`}>
                      {kind === "contributions" ? "Goal" : "Debt account"}
                    </FieldLabel>
                    <NativeSelect
                      id={`${kind}-${row.id}-related`}
                      value={row.relatedId}
                      onChange={(event) => update(row.id, { relatedId: event.target.value })}
                    >
                      <NativeSelectOption value="">
                        {kind === "contributions" ? "Choose a goal" : "Not linked"}
                      </NativeSelectOption>
                      {kind === "contributions"
                        ? goals.data?.data.map((goal) => (
                            <NativeSelectOption value={goal.id} key={goal.id}>
                              {goal.name}
                            </NativeSelectOption>
                          ))
                        : accounts.data?.accounts.map((account) => (
                            <NativeSelectOption value={account.id} key={account.id}>
                              {account.name}
                            </NativeSelectOption>
                          ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                {kind === "priorities" ? (
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${kind}-${row.id}-protected`}
                      checked={row.protected}
                      onCheckedChange={(checked) => update(row.id, { protected: checked === true })}
                    />
                    <FieldLabel htmlFor={`${kind}-${row.id}-protected`}>
                      Protect this priority
                    </FieldLabel>
                  </Field>
                ) : null}
              </fieldset>
              <Button
                className="self-end"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${row.name || "item"}`}
                onClick={() => {
                  const next = rows.filter((item) => item.id !== row.id);
                  field.setValue(next);
                  field.commit(next);
                }}
              >
                <TrashIcon />
              </Button>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      {!rows.length ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{field.value === null ? "Not recorded" : "None"}</span>
          {field.value === null ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                field.setValue([]);
                field.commit([]);
              }}
            >
              None
            </Button>
          ) : null}
        </div>
      ) : null}
      {goals.isError || accounts.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Linked records could not load.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (goals.isError) void goals.refetch();
              if (accounts.isError) void accounts.refetch();
            }}
          >
            Retry
          </Button>
        </p>
      ) : null}
      {field.save.isError ? (
        <div role="alert" className="text-sm text-destructive">
          Couldn’t save {title.toLowerCase()}. Check the values; your edits are preserved.{" "}
          <Button variant="ghost" size="sm" onClick={() => commitRows()}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void field.reload()}>
            Reload saved information
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}
