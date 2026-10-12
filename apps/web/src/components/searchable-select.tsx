import { useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

export type SearchableSelectOption = { value: string; label: string };

/** Entity-agnostic, existing-value selection. Tab commits the highlighted match without trapping focus. */
export function SearchableSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "Choose an option",
}: {
  id?: string;
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const highlighted = useRef<SearchableSelectOption | undefined>(undefined);
  const container = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      ref={(node) => {
        container.current =
          node?.closest<HTMLElement>(
            '[data-slot="dialog-content"], [data-slot="drawer-content"], [data-slot="sheet-content"]',
          ) ?? document.body;
      }}
      className="min-w-0"
    >
      <Combobox
        items={options}
        value={options.find((option) => option.value === value) ?? null}
        itemToStringLabel={(option) => option.label}
        itemToStringValue={(option) => option.value}
        onValueChange={(option) => {
          if (option) onValueChange(option.value);
        }}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            highlighted.current = undefined;
          }
        }}
        onItemHighlighted={(option) => {
          highlighted.current = option;
        }}
        autoHighlight
        disabled={disabled}
      >
        <ComboboxInput
          ref={input}
          id={id}
          aria-label={label}
          placeholder={placeholder}
          className="w-full"
          showTrigger={false}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              if (!event.shiftKey && open && highlighted.current)
                onValueChange(highlighted.current.value);
              setOpen(false);
            }
          }}
        />
        <ComboboxContent portalContainer={container} initialFocus={false} finalFocus={false}>
          <ComboboxEmpty>No matches found.</ComboboxEmpty>
          <ComboboxList>
            {(option: SearchableSelectOption) => (
              <ComboboxItem key={option.value} value={option}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
