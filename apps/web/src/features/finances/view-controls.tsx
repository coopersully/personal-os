import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function FinanceChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
  showLabel = true,
  displayValue,
  icon,
  optionIcons,
  subtle = false,
}: {
  subtle?: boolean;
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
  displayValue?: string;
  icon?: ReactNode;
  optionIcons?: Record<string, ReactNode>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={icon ? "icon-sm" : "sm"}
          disabled={disabled}
          aria-label={`${label}: ${displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Selected categories"}`}
        >
          {icon ?? (
            <>
              {showLabel ? <span className="text-muted-foreground">{label}</span> : null}
              <span
                className={
                  subtle
                    ? "truncate text-xs font-normal text-muted-foreground sm:text-sm"
                    : undefined
                }
              >
                {displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Custom selection"}
              </span>
              <ChevronDownIcon />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange} aria-label={label}>
          {options.map(([id, name]) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {optionIcons?.[id]}
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
