import type { AccountSetupWorkspace } from "@personal-os/domain";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { WorkspaceIcon } from "@/components/workspace-identity";

export type WorkspaceSetupOption<Value extends string> = {
  description: string;
  label: string;
  value: Value;
};

type WorkspaceSetupGridProps<Value extends AccountSetupWorkspace> = {
  disabled?: boolean;
  onValuesChange: (values: Value[]) => void;
  options: ReadonlyArray<WorkspaceSetupOption<Value>>;
  values: Value[];
};

export function WorkspaceSetupGrid<Value extends AccountSetupWorkspace>({
  disabled = false,
  onValuesChange,
  options,
  values,
}: WorkspaceSetupGridProps<Value>) {
  const id = useId();
  const selected = new Set(values);
  const toggle = (value: Value, checked: boolean) => {
    const next = new Set(values);
    if (checked) next.add(value);
    else next.delete(value);
    onValuesChange(options.filter((option) => next.has(option.value)).map(({ value }) => value));
  };

  return (
    <FieldSet aria-label="Workspaces to set up">
      <FieldLegend className="sr-only">Workspaces to set up</FieldLegend>
      <div className="workspace-setup-grid">
        {options.map((option) => {
          const checked = selected.has(option.value);
          const optionId = `${id}-${option.value}`;
          return (
            <FieldLabel
              className="workspace-setup-card"
              data-checked={checked}
              data-disabled={disabled}
              data-workspace={option.value}
              htmlFor={optionId}
              key={option.value}
            >
              <Checkbox
                aria-label={option.label}
                checked={checked}
                className="sr-only"
                disabled={disabled}
                id={optionId}
                onCheckedChange={(nextChecked) => toggle(option.value, nextChecked === true)}
              />
              <WorkspaceIcon size="lg" workspace={option.value} />
              <span className="workspace-setup-card__copy">
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </FieldLabel>
          );
        })}
      </div>
    </FieldSet>
  );
}
