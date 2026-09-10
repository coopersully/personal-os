import { type ReactNode, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type CheckboxCardOption<Value extends string> = {
  description: string;
  icon?: ReactNode;
  label: string;
  value: Value;
};

type CheckboxCardGroupProps<Value extends string> = {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  onValuesChange: (values: Value[]) => void;
  options: ReadonlyArray<CheckboxCardOption<Value>>;
  values: Value[];
};

/**
 * A semantic checkbox fieldset whose full cards are the interaction targets.
 * Use this for a short group of independent, descriptive choices.
 */
export function CheckboxCardGroup<Value extends string>({
  className,
  disabled = false,
  onValuesChange,
  options,
  values,
  ...props
}: CheckboxCardGroupProps<Value>) {
  const id = useId();
  const selected = new Set(values);
  const toggle = (value: Value, checked: boolean) => {
    const nextSelected = new Set(values);
    if (checked) nextSelected.add(value);
    else nextSelected.delete(value);
    onValuesChange(
      options.filter((option) => nextSelected.has(option.value)).map(({ value }) => value),
    );
  };

  return (
    <FieldSet {...props}>
      <FieldLegend className="sr-only">{props["aria-label"]}</FieldLegend>
      <FieldGroup className={cn("checkbox-card-group", className)}>
        {options.map((option) => {
          const checked = selected.has(option.value);
          const optionId = `${id}-${option.value}`;
          return (
            <FieldLabel
              className="checkbox-card"
              data-checked={checked}
              data-disabled={disabled}
              htmlFor={optionId}
              key={option.value}
            >
              <Field orientation="horizontal">
                <Checkbox
                  aria-label={option.label}
                  checked={checked}
                  disabled={disabled}
                  id={optionId}
                  onCheckedChange={(nextChecked) => toggle(option.value, nextChecked === true)}
                />
                <FieldContent>
                  <FieldTitle className="checkbox-card__title">
                    {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
                    {option.label}
                  </FieldTitle>
                  <FieldDescription>{option.description}</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          );
        })}
      </FieldGroup>
    </FieldSet>
  );
}
