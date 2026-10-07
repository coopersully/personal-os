import { useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

/** New names are created atomically by the transaction save, never as orphaned records. */
export function FinanceEntitySelector({
  id,
  label,
  value,
  options,
  onValueChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onValueChange: (value: string) => void;
  required?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLElement>(null);
  const names = Array.from(new Set(options));
  const items = names
    .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
    .map((name) => ({ name, label: name }));
  const trimmed = query.trim();
  if (trimmed && !names.some((name) => name.toLowerCase() === trimmed.toLowerCase()))
    items.push({ name: trimmed, label: `Add “${trimmed}”` });
  return (
    <div
      className="min-w-0"
      ref={(node) => {
        container.current =
          node?.closest<HTMLElement>(
            '[data-slot="dialog-content"], [data-slot="drawer-content"]',
          ) ?? document.body;
      }}
    >
      <Combobox
        open={open}
        onOpenChange={setOpen}
        items={items}
        filteredItems={items}
        value={value ? { name: value, label: value } : null}
        inputValue={query}
        onInputValueChange={(next) => {
          setQuery(next);
          onValueChange(next.trim());
        }}
        onValueChange={(item) => {
          const next = item?.name ?? "";
          setQuery(next);
          onValueChange(next);
          setOpen(false);
        }}
        itemToStringLabel={(item) => item.name}
        itemToStringValue={(item) => item.name}
      >
        <ComboboxInput
          onFocus={() => setOpen(true)}
          onChange={() => setOpen(true)}
          id={id}
          name={id.replace("finance-", "")}
          aria-label={label}
          required={required}
          placeholder="Search or add a name"
          className="w-full"
        />
        <ComboboxContent portalContainer={container} initialFocus={false} finalFocus={false}>
          <ComboboxList>
            {(item: { name: string; label: string }) => (
              <ComboboxItem key={item.name} value={item}>
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
