import { type ComponentProps, useEffect, useRef, useState } from "react";
import { ClockIcon } from "@/components/icons";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "./ui/combobox";
import { InputGroupAddon } from "./ui/input-group";

function label(value: string) {
  if (!value) return "";
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
const options = Array.from(
  { length: 96 },
  (_, index) =>
    `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
);
function parse(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59 || (match[3] && (hour < 1 || hour > 12))) return null;
  if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Native input remains the form/event authority; the shadcn control owns presentation. */
export function SettingsTimeInput({ ref: forwardedRef, ...props }: ComponentProps<"input">) {
  const input = useRef<HTMLInputElement | null>(null);
  const portalContainer = useRef<HTMLElement | null>(null);
  const [local, setLocal] = useState(String(props.defaultValue ?? ""));
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => {
      if (props.value === undefined) {
        setLocal(String(props.defaultValue ?? ""));
        setSearch(null);
      }
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [props.value, props.defaultValue]);
  const value = String(props.value ?? local);
  const query = search === null || search === label(value) ? "" : search;
  const typed = parse(query);
  const choices = Array.from(
    new Set([
      ...(!query && !props.required ? [""] : []),
      ...(typed ? [typed] : []),
      ...(!query && value ? [value] : []),
      ...options.filter(
        (item) =>
          !query ||
          label(item)
            .toLowerCase()
            .replaceAll(" ", "")
            .includes(query.toLowerCase().replaceAll(" ", "")),
      ),
    ]),
  )
    .filter(
      (item) =>
        (item === "" && !props.required) ||
        ((!props.min || item >= String(props.min)) && (!props.max || item <= String(props.max))),
    )
    .slice(0, 6);
  return (
    <span data-slot="settings-time" className="settings-time">
      <input
        {...props}
        id={undefined}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        ref={(node) => {
          input.current = node;
          portalContainer.current =
            node?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
      />
      <Combobox
        items={choices}
        filter={null}
        autoHighlight
        value={value}
        inputValue={search ?? label(value)}
        itemToStringLabel={(item) => (item ? label(item) : "No time")}
        disabled={props.disabled || props.readOnly}
        onOpenChange={(open) => {
          if (!open) setSearch(null);
        }}
        onInputValueChange={(next, details) => {
          if (details.reason !== "item-press") setSearch(next);
        }}
        onValueChange={(next) => {
          if (next === null || (!next && props.required)) return;
          setSearch(null);
          setLocal(next);
          const control = input.current;
          if (control && next !== value) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
              control,
              next,
            );
            control.dispatchEvent(new Event("input", { bubbles: true }));
            // Let the owning onChange render its new draft before committing on blur.
            queueMicrotask(() =>
              control.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
            );
          }
        }}
      >
        <ComboboxInput
          id={props.id}
          aria-label={props["aria-label"]}
          aria-describedby={props["aria-describedby"]}
          className="settings-value-input"
          showClear={false}
          showTrigger={false}
          onFocus={(event) => event.currentTarget.select()}
          placeholder="Choose time"
        >
          <InputGroupAddon align="inline-start">
            <ClockIcon aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent portalContainer={portalContainer} align="end" className="min-w-44">
          <ComboboxEmpty>No matching times.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item ? label(item) : "No time"}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </span>
  );
}
