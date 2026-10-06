import {
  type FinanceConfiguration,
  type FinanceProfile,
  updateFinanceProfileInputSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { SettingsSection } from "../settings/settings-layout.js";
import { financeCurrencyNumber } from "./configuration-values.js";
import { financeConfigurationKey, useFinanceConfiguration } from "./use-finance-configuration.js";

type IncomeKey =
  | "employer"
  | "role"
  | "employmentType"
  | "grossAnnualIncome"
  | "expectedNetPay"
  | "payFrequency"
  | "nextPayday"
  | "payAccountId";
const fields: Array<{
  key: IncomeKey;
  label: string;
  kind?: "currency" | "date";
  options?: Array<[string, string]>;
}> = [
  { key: "employer", label: "Employer" },
  { key: "role", label: "Role" },
  {
    key: "employmentType",
    label: "Employment type",
    options: [
      ["full_time", "Full time"],
      ["part_time", "Part time"],
      ["contract", "Contract"],
      ["self_employed", "Self-employed"],
      ["unemployed", "Not employed"],
    ],
  },
  { key: "grossAnnualIncome", label: "Gross annual income", kind: "currency" },
  { key: "expectedNetPay", label: "Expected net paycheck", kind: "currency" },
  {
    key: "payFrequency",
    label: "Pay frequency",
    options: [
      ["weekly", "Weekly"],
      ["biweekly", "Every two weeks"],
      ["semimonthly", "Twice monthly"],
      ["monthly", "Monthly"],
      ["irregular", "Irregular"],
    ],
  },
  { key: "nextPayday", label: "Next payday", kind: "date" },
];
export function FinanceIncomeEditor() {
  const query = useFinanceConfiguration();
  if (query.data?.income.state !== "loaded")
    return (
      <SettingsSection title="Payroll details">
        <p role="alert">
          Payroll details could not load.{" "}
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </p>
      </SettingsSection>
    );
  const profile = query.data.income.value;
  const accounts = query.data.accounts;
  return (
    <SettingsSection
      title="Payroll details"
      description="Paycheck amounts and timing. Monthly estimates and reliable budget income are separate."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <IncomeField key={field.key} field={field} profile={profile} />
        ))}
        {accounts.state === "loaded" ? (
          <IncomeField
            field={{
              key: "payAccountId",
              label: "Pay account",
              options: accounts.value.accounts.map((a) => [a.id, `${a.institution} · ${a.name}`]),
            }}
            profile={profile}
          />
        ) : (
          <p role="alert">
            Pay accounts could not load.{" "}
            <Button variant="ghost" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
function IncomeField({
  field,
  profile,
}: {
  field: (typeof fields)[number];
  profile: FinanceProfile | null;
}) {
  const client = useQueryClient();
  const draftKey = ["finance-configuration-draft", `payroll-${field.key}`];
  const draft = useQuery<{ value: string } | null>({
    queryKey: draftKey,
    queryFn: () => null,
    enabled: false,
    gcTime: Infinity,
  });
  const saved = profile?.[field.key]?.toString() ?? "";
  const value = draft.data?.value ?? saved;
  const mutationKey = ["finance-configuration-save", `payroll-${field.key}`];
  const save = useFeedbackMutation({
    mutationKey,
    scope: { id: "finance-profile-configuration" },
    feedback: { action: "save payroll details", safeToRetry: false, form: true },
    mutationFn: async (submitted: string) => {
      const config = client.getQueryData<FinanceConfiguration>(financeConfigurationKey);
      if (config?.income.state !== "loaded") throw new Error("Reload your payroll details first.");
      const current = config.income.value;
      const input = updateFinanceProfileInputSchema.parse({
        ...current,
        effectiveDate: current?.effectiveDate ?? new Date().toISOString().slice(0, 10),
        expectedUpdatedAt: current?.updatedAt ?? null,
        [field.key]: submitted.trim()
          ? field.kind === "currency"
            ? financeCurrencyNumber(submitted)
            : submitted.trim()
          : null,
      });
      const response = await api.updateFinanceProfile(input);
      if ("status" in response) throw new Error("This payroll change requires review.");
      return response;
    },
    onSuccess: async (response, submitted) => {
      await client.cancelQueries({ queryKey: financeConfigurationKey });
      client.setQueryData<FinanceConfiguration>(financeConfigurationKey, (current) =>
        current ? { ...current, income: { state: "loaded", value: response } } : current,
      );
      client.setQueryData(draftKey, (current: { value: string } | null | undefined) =>
        current?.value === submitted ? null : current,
      );
      // The existing payroll bridge can create a canonical profile version. Refresh that revision
      // before the next queued canonical field is written, without discarding local drafts.
      await client.refetchQueries({ queryKey: financeConfigurationKey });
      void client.invalidateQueries({ queryKey: ["finance-profile"] });
    },
  });
  const change = (next: string) => client.setQueryData(draftKey, { value: next });
  const commit = (next = value) => {
    const latest = client.getMutationCache().findAll({ mutationKey, status: "pending" }).at(-1);
    if ((latest && latest.state.variables === next) || (!latest && next === saved)) return;
    save.mutate(next);
  };
  const common = {
    id: `finance-${field.key}`,
    value,
    onBlur: () => commit(),
    "aria-invalid": save.isError || undefined,
  };
  return (
    <Field id={`payroll-${field.key}`}>
      <FieldLabel htmlFor={common.id}>{field.label}</FieldLabel>
      {field.options ? (
        <NativeSelect
          {...common}
          onChange={(e) => {
            change(e.target.value);
            commit(e.target.value);
          }}
        >
          <NativeSelectOption value="">Not set</NativeSelectOption>
          {field.options.map(([id, label]) => (
            <NativeSelectOption key={id} value={id}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : field.kind === "currency" ? (
        <CurrencyInput {...common} onValueChange={change} />
      ) : field.kind === "date" ? (
        <DateInput {...common} onValueChange={change} onValueCommit={commit} />
      ) : (
        <Input {...common} onChange={(e) => change(e.target.value)} />
      )}
      {save.isError ? (
        <div role="alert" className="text-sm text-destructive">
          Couldn’t save {field.label.toLowerCase()}. Your edit is preserved.
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => commit()}>
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void client
                  .refetchQueries({ queryKey: financeConfigurationKey })
                  .then(() => save.reset())
              }
            >
              Reload saved information
            </Button>
          </div>
        </div>
      ) : null}
    </Field>
  );
}
