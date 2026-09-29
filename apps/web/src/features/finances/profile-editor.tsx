import { type FinanceProfileVersion, updateFinancialProfileInputSchema } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import {
  FinanceSourceState,
  financeAmount,
  financeObservedAt,
  refreshFinancePosition,
  requireFinanceResult,
} from "./position-material.js";

const profileQueryKey = ["finance-profile-current"];
const numericFields = [
  { key: "householdSize", label: "Household size", min: 1, max: 100, step: 1 },
  { key: "dependents", label: "Dependents", min: 0, max: 100, step: 1 },
  {
    key: "expectedMonthlyTakeHome",
    label: "Expected monthly take-home (USD)",
    min: 0,
    max: 100_000_000,
    step: 0.01,
  },
  { key: "liquidReserves", label: "Liquid reserves (USD)", min: 0, max: 100_000_000, step: 0.01 },
] as const;
const incomeLabels = {
  stable: "Stable",
  variable: "Variable",
  seasonal: "Seasonal",
  unknown: "Not recorded",
};
const debtPriorityLabels = {
  avalanche: "Highest interest first",
  snowball: "Smallest balance first",
  minimums: "Required minimums",
  custom: "Custom priority",
};
const defaultPreferences: FinanceProfileVersion["preferences"] = {
  bufferTarget: null,
  debtPriority: null,
  emergencyReserveMonths: null,
  notes: [],
};

type ProfileForm = Record<(typeof numericFields)[number]["key"], string> & {
  jurisdiction: string;
  incomeStability: FinanceProfileVersion["incomeStability"];
  bufferTarget: string;
  debtPriority: NonNullable<FinanceProfileVersion["preferences"]["debtPriority"]> | "";
  emergencyReserveMonths: string;
  notes: string;
};

function profileForm(profile: FinanceProfileVersion | null): ProfileForm {
  return {
    householdSize: profile?.householdSize?.toString() ?? "",
    dependents: profile?.dependents?.toString() ?? "",
    expectedMonthlyTakeHome: profile?.expectedMonthlyTakeHome?.toString() ?? "",
    liquidReserves: profile?.liquidReserves?.toString() ?? "",
    jurisdiction: profile?.jurisdiction ?? "",
    incomeStability: profile?.incomeStability ?? "unknown",
    bufferTarget: profile?.preferences.bufferTarget?.toString() ?? "",
    debtPriority: profile?.preferences.debtPriority ?? "",
    emergencyReserveMonths: profile?.preferences.emergencyReserveMonths?.toString() ?? "",
    notes: profile?.preferences.notes.join("\n") ?? "",
  };
}

function nullableNumber(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function changedProfileFields(form: ProfileForm, profile: FinanceProfileVersion | null) {
  const changes: Record<string, unknown> = {};
  for (const field of numericFields) {
    const value = nullableNumber(form[field.key]);
    if (value !== (profile?.[field.key] ?? null)) changes[field.key] = value;
  }
  const jurisdiction = form.jurisdiction.trim() || null;
  if (jurisdiction !== (profile?.jurisdiction ?? null)) changes.jurisdiction = jurisdiction;
  if (form.incomeStability !== (profile?.incomeStability ?? "unknown"))
    changes.incomeStability = form.incomeStability;
  const previousPreferences = profile?.preferences ?? defaultPreferences;
  const preferences = {
    ...previousPreferences,
    bufferTarget: nullableNumber(form.bufferTarget),
    emergencyReserveMonths: nullableNumber(form.emergencyReserveMonths),
    debtPriority: form.debtPriority || null,
    notes:
      form.notes === previousPreferences.notes.join("\n")
        ? previousPreferences.notes
        : form.notes
            .split("\n")
            .map((note) => note.trim())
            .filter(Boolean),
  };
  if (JSON.stringify(preferences) !== JSON.stringify(previousPreferences))
    changes.preferences = preferences;
  return changes;
}

export function FinanceProfileEditor() {
  const profile = useQuery({
    queryKey: profileQueryKey,
    queryFn: async () => requireFinanceResult(await api.getFinancialProfile()),
  });
  const [editing, setEditing] = useState<{ profile: FinanceProfileVersion | null } | null>(null);
  const current = profile.data?.data;
  return (
    <section aria-label="Financial profile" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">Financial profile</h2>
        {profile.isSuccess ? (
          <Button
            onClick={() => setEditing({ profile: current ?? null })}
            size="sm"
            variant="outline"
          >
            {current ? "Edit financial profile" : "Create financial profile"}
          </Button>
        ) : null}
      </div>
      <FinanceSourceState label="Financial profile" query={profile} />
      {current ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Version {current.version}</Badge>
            <span className="text-muted-foreground text-xs">
              Recorded {financeObservedAt(current.createdAt)}
            </span>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Jurisdiction", value: current.jurisdiction ?? "Not recorded" },
              {
                label: "Household",
                value: `${current.householdSize ?? "Unknown size"} · ${current.dependents === null ? "Dependents not recorded" : `${current.dependents} dependents`}`,
              },
              { label: "Monthly take-home", value: financeAmount(current.expectedMonthlyTakeHome) },
              { label: "Income stability", value: incomeLabels[current.incomeStability] },
              { label: "Liquid reserves", value: financeAmount(current.liquidReserves) },
              {
                label: "Reserve target",
                value:
                  current.preferences.emergencyReserveMonths === null
                    ? "Not recorded"
                    : `${current.preferences.emergencyReserveMonths} months`,
              },
            ].map((fact) => (
              <div key={fact.label}>
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">
                Recorded debts, insurance, and preferences
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 pt-3">
              <p className="text-muted-foreground text-sm">
                These are financial-profile records. Inspect current account balances in{" "}
                <Link className="underline underline-offset-4" to="/finances/accounts">
                  Accounts
                </Link>
                .
              </p>
              <ItemGroup>
                {current.debts.map((debt, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Read-only entries in an immutable profile version have no record identifiers.
                  <Item key={`${debt.name}-${index}`}>
                    <ItemContent>
                      <ItemTitle>{debt.name}</ItemTitle>
                      <ItemDescription>
                        {financeAmount(debt.balance)} balance ·{" "}
                        {financeAmount(debt.minimumMonthlyPayment)} monthly minimum ·{" "}
                        {debt.interestRate === null
                          ? "Interest rate not recorded"
                          : `${debt.interestRate}% interest`}
                      </ItemDescription>
                      {debt.accountId ? (
                        <Link
                          className="text-sm underline underline-offset-4"
                          to={`/finances/accounts#account-${debt.accountId}`}
                        >
                          Inspect linked account
                        </Link>
                      ) : null}
                    </ItemContent>
                  </Item>
                ))}
                {current.insurance.map((policy, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Read-only entries in an immutable profile version have no record identifiers.
                  <Item key={`${policy.name}-${index}`}>
                    <ItemContent>
                      <ItemTitle>{policy.name}</ItemTitle>
                      <ItemDescription>
                        {policy.kind} · {policy.status} · {financeAmount(policy.annualPremium)}{" "}
                        annual premium · {financeAmount(policy.coverageAmount)} coverage
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
                <Item>
                  <ItemContent>
                    <ItemTitle>Planning preferences</ItemTitle>
                    <ItemDescription>
                      {financeAmount(current.preferences.bufferTarget)} buffer ·{" "}
                      {current.preferences.debtPriority === null
                        ? "Debt priority not recorded"
                        : debtPriorityLabels[current.preferences.debtPriority]}
                    </ItemDescription>
                    {current.preferences.notes.length ? (
                      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
                        {current.preferences.notes.map((note, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: Notes may repeat and are read-only within an immutable profile version.
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                  </ItemContent>
                </Item>
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : profile.isSuccess ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Financial context not recorded</EmptyTitle>
            <EmptyDescription>
              Add household, income, and reserve context to guide your plan.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {editing ? (
        <ProfileDialog profile={editing.profile} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function ProfileDialog({
  profile,
  onClose,
}: {
  profile: FinanceProfileVersion | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState(() => profileForm(profile));
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
  const changes = changedProfileFields(form, profile);
  const save = useMutation({
    mutationFn: async () => {
      const payload = JSON.stringify(changes);
      if (lastAttempt.current?.payload !== payload)
        lastAttempt.current = { payload, key: crypto.randomUUID() };
      const parsed = updateFinancialProfileInputSchema.safeParse({
        changes,
        expectedVersion: profile?.version ?? 0,
        idempotencyKey: lastAttempt.current.key,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? "Check the financial profile fields.");
      return requireFinanceMutationResult(await api.updateFinancialProfile(parsed.data));
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) lastAttempt.current = null;
      void refreshFinancePosition(client);
    },
    onSuccess: async (result) => {
      client.setQueryData(profileQueryKey, result);
      await refreshFinancePosition(client);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {profile ? "Edit financial profile" : "Create financial profile"}
          </DialogTitle>
          <DialogDescription>
            Leave unknown values blank.{" "}
            {profile
              ? `Changes apply to version ${profile.version}.`
              : "Start with the facts you know."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (Object.keys(changes).length) save.mutate();
          }}
        >
          <FieldSet disabled={save.isPending}>
            <FieldLegend>Household and income</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="profile-jurisdiction">Jurisdiction</FieldLabel>
                <Input
                  id="profile-jurisdiction"
                  maxLength={120}
                  value={form.jurisdiction}
                  onChange={(event) => setForm({ ...form, jurisdiction: event.target.value })}
                />
                <FieldDescription>Country and state or region.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-income-stability">Income stability</FieldLabel>
                <NativeSelect
                  id="profile-income-stability"
                  value={form.incomeStability}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      incomeStability: event.target.value as ProfileForm["incomeStability"],
                    })
                  }
                >
                  {Object.entries(incomeLabels).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {numericFields.map((field) => (
                <Field key={field.key}>
                  <FieldLabel htmlFor={`profile-${field.key}`}>{field.label}</FieldLabel>
                  <Input
                    id={`profile-${field.key}`}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={form[field.key]}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  />
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <FieldSet disabled={save.isPending}>
            <FieldLegend>Planning preferences</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="profile-reserve-months">Reserve target (months)</FieldLabel>
                <Input
                  id="profile-reserve-months"
                  type="number"
                  min="0"
                  max="60"
                  step="0.1"
                  value={form.emergencyReserveMonths}
                  onChange={(event) =>
                    setForm({ ...form, emergencyReserveMonths: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-buffer">Buffer target (USD)</FieldLabel>
                <Input
                  id="profile-buffer"
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.01"
                  value={form.bufferTarget}
                  onChange={(event) => setForm({ ...form, bufferTarget: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-debt-priority">Debt priority</FieldLabel>
                <NativeSelect
                  id="profile-debt-priority"
                  value={form.debtPriority}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      debtPriority: event.target.value as ProfileForm["debtPriority"],
                    })
                  }
                >
                  <NativeSelectOption value="">Not recorded</NativeSelectOption>
                  {Object.entries(debtPriorityLabels).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="profile-notes">Planning notes</FieldLabel>
                <Textarea
                  id="profile-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
                <FieldDescription>One preference per line.</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          {save.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Financial profile was not saved</AlertTitle>
              <AlertDescription>
                {errorMessage(save.error)} Close and reopen the editor to load the latest version.
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={save.isPending} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={save.isPending || Object.keys(changes).length === 0} type="submit">
              {save.isPending ? "Saving financial profile…" : "Save financial profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
