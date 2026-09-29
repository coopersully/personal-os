import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { planAmountCents } from "./plan-helpers.js";
import { requireFinanceResult } from "./position-material.js";

type Row = {
  id: string;
  name: string;
  amount: string;
  balance: string;
  day: string;
  relatedId: string;
  protected: boolean;
};

export function SetupAnswerFields({
  questionId,
  pending,
  onSubmit,
}: {
  questionId: string;
  pending: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [income, setIncome] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dated =
    questionId === "planning:uncertainIncome" || questionId === "planning:exceptionalResources";
  const recurring = questionId === "planning:recurringIncome";
  const debts = questionId === "profile:debts";
  const goals = questionId === "planning:contributions";
  const obligations = questionId === "planning:obligations";
  const priorities = questionId === "planning:priorities";
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
    enabled: debts || obligations,
  });
  const goalQuery = useQuery({
    queryKey: ["finance-goals"],
    queryFn: async () => requireFinanceResult(await api.listFinanceGoals()),
    enabled: goals,
  });
  function amount(value: string) {
    if (!value.trim()) return null;
    const cents = planAmountCents(value);
    if (cents === null)
      throw new Error("Use a non-negative amount with at most two decimal places.");
    return cents;
  }
  function submit() {
    try {
      const answer = recurring
        ? { amountCents: amount(income), nextDate: nextDate || null }
        : rows.map((row) => {
            if (!row.name.trim()) throw new Error("Give each item a name.");
            if (debts) {
              const balance = amount(row.balance);
              const minimum = amount(row.amount);
              if (balance === null || minimum === null)
                throw new Error("Enter the debt balance and minimum, or skip until you know them.");
              return {
                name: row.name,
                accountId: row.relatedId || null,
                balance: balance / 100,
                minimumMonthlyPayment: minimum / 100,
                interestRate: null,
              };
            }
            const dueDay = !dated && row.day ? Number(row.day) : null;
            if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31))
              throw new Error("Choose a due day from 1 to 31, or leave it unknown.");
            if (goals && !row.relatedId)
              throw new Error("Choose the goal this planned contribution belongs to.");
            return {
              id: row.id,
              name: row.name,
              amountCents: amount(row.amount),
              ...(dated ? { expectedDate: row.day || null } : { dueDay }),
              ...(obligations ? { debtAccountId: row.relatedId || null } : {}),
              ...(goals ? { goalId: row.relatedId } : {}),
              ...(priorities ? { categoryId: null, protected: row.protected } : {}),
            };
          });
      setError(null);
      onSubmit(JSON.stringify(answer));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Check these fields.");
    }
  }
  function update(id: string, change: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {accounts.error || goalQuery.error ? (
          <Alert variant="destructive">
            <AlertDescription>
              Linked records could not load. Retry or skip this question.
            </AlertDescription>
          </Alert>
        ) : null}
        {recurring ? (
          <>
            <Field>
              <FieldLabel htmlFor="setup-floor">Reliable monthly take-home (USD)</FieldLabel>
              <Input
                id="setup-floor"
                inputMode="decimal"
                disabled={pending}
                value={income}
                onChange={(event) => setIncome(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="setup-income-date">Next payment date, if known</FieldLabel>
              <Input
                id="setup-income-date"
                type="date"
                disabled={pending}
                value={nextDate}
                onChange={(event) => setNextDate(event.target.value)}
              />
            </Field>
          </>
        ) : (
          rows.map((row, index) => (
            <FieldSet key={row.id} disabled={pending}>
              <FieldLegend>Item {index + 1}</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${row.id}-name`}>Name</FieldLabel>
                  <Input
                    id={`${row.id}-name`}
                    value={row.name}
                    maxLength={240}
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                </Field>
                {debts ? (
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-balance`}>Balance (USD)</FieldLabel>
                    <Input
                      id={`${row.id}-balance`}
                      inputMode="decimal"
                      value={row.balance}
                      onChange={(event) => update(row.id, { balance: event.target.value })}
                    />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor={`${row.id}-amount`}>
                    {debts
                      ? "Monthly minimum (USD)"
                      : dated
                        ? "Expected amount (USD), if known"
                        : "Monthly amount (USD), if known"}
                  </FieldLabel>
                  <Input
                    id={`${row.id}-amount`}
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(event) => update(row.id, { amount: event.target.value })}
                  />
                </Field>
                {!debts ? (
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-day`}>
                      {dated ? "Expected date, if known" : "Day of month, if known"}
                    </FieldLabel>
                    <Input
                      id={`${row.id}-day`}
                      type={dated ? "date" : "number"}
                      min={dated ? undefined : 1}
                      max={dated ? undefined : 31}
                      value={row.day}
                      onChange={(event) => update(row.id, { day: event.target.value })}
                    />
                  </Field>
                ) : null}
                {goals || debts || obligations ? (
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-related`}>
                      {goals ? "Goal" : "Debt account, if applicable"}
                    </FieldLabel>
                    <NativeSelect
                      id={`${row.id}-related`}
                      value={row.relatedId}
                      onChange={(event) => update(row.id, { relatedId: event.target.value })}
                    >
                      <NativeSelectOption value="">
                        {goals ? "Choose a goal" : "No linked debt account"}
                      </NativeSelectOption>
                      {goals
                        ? goalQuery.data?.data.map((goal) => (
                            <NativeSelectOption key={goal.id} value={goal.id}>
                              {goal.name}
                            </NativeSelectOption>
                          ))
                        : accounts.data?.accounts
                            .filter((account) => account.kind === "debt")
                            .map((account) => (
                              <NativeSelectOption key={account.id} value={account.id}>
                                {account.institution}
                              </NativeSelectOption>
                            ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                {priorities ? (
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-protected`}>Protect this priority</FieldLabel>
                    <NativeSelect
                      id={`${row.id}-protected`}
                      value={String(row.protected)}
                      onChange={(event) =>
                        update(row.id, { protected: event.target.value === "true" })
                      }
                    >
                      <NativeSelectOption value="false">No</NativeSelectOption>
                      <NativeSelectOption value="true">Yes</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  Remove item {index + 1}
                </Button>
              </FieldGroup>
            </FieldSet>
          ))
        )}
        {!recurring ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || rows.length >= 100}
            onClick={() =>
              setRows((current) => [
                ...current,
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
            Add item
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving answer…"
            : !recurring && rows.length === 0
              ? "Confirm none"
              : "Save answer"}
        </Button>
      </FieldGroup>
    </form>
  );
}
