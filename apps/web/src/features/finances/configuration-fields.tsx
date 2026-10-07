import type { FinanceProfileVersion, UpdateFinancialProfileInput } from "@personal-os/domain";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { financeCurrencyNumber } from "./configuration-values.js";
import { useFinanceProfileField } from "./use-finance-configuration.js";

export function FinanceConfigurationField({
  id,
  label,
  value,
  kind = "text",
  options,
  description,
  changes,
}: {
  id: string;
  label: string;
  value: string;
  kind?: "text" | "number" | "currency" | "date";
  options?: Array<[string, string]>;
  description?: string;
  changes: (
    value: string,
    profile: FinanceProfileVersion | null,
  ) => UpdateFinancialProfileInput["changes"];
}) {
  const field = useFinanceProfileField(id, value, (submitted, current) => {
    if (kind === "currency") financeCurrencyNumber(submitted);
    return changes(submitted, current);
  });
  const common = {
    id: `finance-config-${id}`,
    value: field.value,
    onBlur: () => field.commit(),
    "aria-invalid": field.save.isError || undefined,
  };
  return (
    <Field id={id}>
      <FieldLabel htmlFor={common.id}>{label}</FieldLabel>
      {options ? (
        <NativeSelect
          {...common}
          onChange={(event) => {
            field.setValue(event.target.value);
            field.commit(event.target.value);
          }}
        >
          {options.map(([key, text]) => (
            <NativeSelectOption key={key} value={key}>
              {text}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : kind === "currency" ? (
        <CurrencyInput {...common} onValueChange={field.setValue} />
      ) : kind === "date" ? (
        <DateInput {...common} onValueChange={field.setValue} onValueCommit={field.commit} />
      ) : (
        <Input {...common} type={kind} onChange={(event) => field.setValue(event.target.value)} />
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {field.save.isError ? (
        <div role="alert" className="text-sm text-destructive">
          Couldn’t save {label.toLowerCase()}. Your edit is preserved. Check the value or reload the
          latest saved information before retrying.
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => field.commit()}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void field.reload()}>
              Reload saved information
            </Button>
          </div>
        </div>
      ) : null}
    </Field>
  );
}
