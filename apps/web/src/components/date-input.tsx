import { format, isValid, parseISO } from "date-fns";
import { type ComponentProps, useState } from "react";
import { CalendarIcon } from "@/components/icons";
import { Calendar } from "@/components/ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** Date-only ISO values; no UTC conversion or accidental day shift on selection. */
export function DateInput({
  value,
  onValueChange,
  disabled,
  readOnly,
  min,
  max,
  className,
  ...props
}: DateInputProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseISO(value);
  const selected = isValid(parsed) ? parsed : undefined;
  return (
    <InputGroup data-disabled={disabled}>
      <InputGroupInput
        {...props}
        className={cn("date-input__control", className)}
        type="date"
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton
              aria-label="Choose date"
              disabled={disabled || readOnly}
              size="icon-xs"
              variant="ghost"
            >
              <CalendarIcon />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="end">
            <Calendar
              mode="single"
              selected={selected}
              {...(selected ? { defaultMonth: selected } : {})}
              startMonth={typeof min === "string" ? parseISO(min) : new Date(1900, 0)}
              endMonth={
                typeof max === "string"
                  ? parseISO(max)
                  : new Date(
                      Math.max(new Date().getFullYear() + 100, selected?.getFullYear() ?? 0),
                      11,
                    )
              }
              captionLayout="dropdown"
              autoFocus
              disabled={(day) =>
                (typeof min === "string" && day < parseISO(min)) ||
                (typeof max === "string" && day > parseISO(max))
              }
              onSelect={(date) => {
                if (date) {
                  onValueChange(format(date, "yyyy-MM-dd"));
                  setOpen(false);
                }
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}
