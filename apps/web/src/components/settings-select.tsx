import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Option = { value: string; label: string; disabled: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child),
    )
    .join("");
}
function optionsFrom(children: ReactNode, inheritedDisabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: unknown;
        children?: ReactNode;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return [];
    const { value, children: nested, disabled, label } = child.props;
    if (value !== undefined || child.type === "option") {
      return [
        {
          value: String(value ?? text(nested)),
          label: label ?? text(nested),
          disabled: inheritedDisabled || !!disabled,
        },
      ];
    }
    return optionsFrom(nested, inheritedDisabled || !!disabled);
  });
}

/** Keep the existing select change/form contract while presenting shadcn autocomplete. */
export function SettingsSelect({
  children,
  className,
  value,
  defaultValue,
  id,
  onChange,
  ref: forwardedRef,
  ...props
}: ComponentProps<"select">) {
  const fallbackId = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const portalContainer = useRef<HTMLElement | null>(null);
  const options = optionsFrom(children);
  const [draft, setDraft] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const [query, setQuery] = useState<string | null>(null);
  const initialValue = String(defaultValue ?? options[0]?.value ?? "");
  useEffect(() => {
    const form = selectRef.current?.form;
    const reset = () => {
      if (value === undefined) {
        setDraft(initialValue);
        setQuery(null);
      }
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [value, initialValue]);
  const selected = String(value ?? draft);
  const compact = options.length <= 6;
  const choose = (next: string | null) => {
    if (next === null || options.find((item) => item.value === next)?.disabled) return;
    setDraft(next);
    setQuery(null);
    const select = selectRef.current;
    if (select && next !== selected) {
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const label = (option: string) => options.find((item) => item.value === option)?.label ?? option;
  const search = query === null || query === label(selected) ? "" : query.toLocaleLowerCase();
  const matches = options.filter(
    (option) => !search || option.label.toLocaleLowerCase().includes(search),
  );
  const visible = (
    search
      ? matches
      : [
          ...matches.filter((item) => item.value === selected),
          ...matches.filter((item) => item.value !== selected),
        ]
  ).slice(0, 6);
  return (
    <div className={className} data-slot="settings-select">
      <select
        {...props}
        id={undefined}
        name={compact ? props.name : undefined}
        required={false}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        value={selected}
        onChange={onChange}
        ref={(node) => {
          selectRef.current = node;
          portalContainer.current =
            node?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
      >
        {children}
      </select>
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={id ?? fallbackId}
              type="button"
              variant="ghost"
              disabled={props.disabled}
              aria-label={props["aria-label"]}
              aria-labelledby={props["aria-labelledby"]}
              aria-describedby={props["aria-describedby"]}
              className="settings-select__trigger ml-auto flex h-auto min-h-8 max-w-full justify-end whitespace-normal text-right font-normal text-muted-foreground"
            >
              {label(selected)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={selected} onValueChange={choose}>
              {options.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Combobox
          items={visible.map((item) => item.value)}
          filter={null}
          autoHighlight
          name={props.name}
          required={props.required}
          disabled={props.disabled}
          value={selected}
          inputValue={query ?? label(selected)}
          itemToStringLabel={label}
          onOpenChange={(open) => {
            if (!open) setQuery(null);
          }}
          onInputValueChange={(next, details) => {
            if (details.reason !== "item-press") setQuery(next);
          }}
          onValueChange={choose}
        >
          <ComboboxInput
            id={id ?? fallbackId}
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            className="settings-value-input"
            showClear={false}
            showTrigger={false}
            onFocus={(event) => event.currentTarget.select()}
          />
          <ComboboxContent portalContainer={portalContainer} align="end" className="min-w-52">
            <ComboboxEmpty>No matching options.</ComboboxEmpty>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem
                  key={item}
                  value={item}
                  disabled={options.find((option) => option.value === item)?.disabled}
                >
                  {label(item)}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </div>
  );
}
