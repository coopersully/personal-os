import { ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function FinanceChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
  showLabel = true,
  displayValue,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
  displayValue?: string;
}) {
  if (label === "View")
    return (
      <ToggleGroup
        type="single"
        aria-label={label}
        value={value}
        onValueChange={(next) => next && onChange(next)}
        disabled={disabled}
        size="sm"
        spacing={0}
      >
        {options.map(([id, name]) => (
          <ToggleGroupItem key={id} value={id}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`${label}: ${displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Selected categories"}`}
        >
          {showLabel ? <span className="text-muted-foreground">{label}</span> : null}
          {displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Selected categories"}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange} aria-label={label}>
          {options.map(([id, name]) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
