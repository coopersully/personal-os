import type { ReactNode } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type ChoiceCardOption<Value extends string> = {
  icon?: ReactNode;
  label: string;
  preview?: ReactNode;
  value: Value;
};

type ChoiceCardGroupProps<Value extends string> = {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<ChoiceCardOption<Value>>;
  value: Value;
};

/**
 * A radio group whose entire option is the hit target. Use it when the visible
 * choice benefits from a compact preview rather than a separate form control.
 */
export function ChoiceCardGroup<Value extends string>({
  className,
  disabled = false,
  onValueChange,
  options,
  value,
  ...props
}: ChoiceCardGroupProps<Value>) {
  return (
    <RadioGroup
      {...props}
      className={cn("choice-card-group", className)}
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue as Value)}
      value={value}
    >
      {options.map((option) => (
        <RadioGroupItem
          aria-label={option.label}
          className="choice-card"
          key={option.value}
          value={option.value}
        >
          <span className="choice-card__content">
            <span aria-hidden="true" className="choice-card__selection" />
            <span className="choice-card__label">
              {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
              {option.label}
            </span>
            {option.preview ? <span className="choice-card__preview">{option.preview}</span> : null}
          </span>
        </RadioGroupItem>
      ))}
    </RadioGroup>
  );
}
