import { useState } from "react";
import { toast } from "sonner";
import { ClockIcon } from "@/components/icons";
import { Field, FieldContent, FieldError, FieldLabel } from "@/components/settings-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

export const timeLabel = (value: string) => {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};
const times = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);
const zones = [...Intl.supportedValuesOf("timeZone"), "UTC"];
const normalize = (value: string) => value.toLowerCase().replace(/[\s_]/g, "");
function typedTime(query: string): string | undefined {
  const match = query.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || hour > 23 || (match[3] && (hour < 1 || hour > 12))) return;
  if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function ProfileChoice({
  id,
  label,
  value,
  kind,
  save,
  validate,
}: {
  id: string;
  label: string;
  value: string;
  kind: "time" | "zone";
  save: (value: string) => Promise<unknown>;
  validate?: (value: string) => string | undefined;
}) {
  const format = (item: string) => (kind === "time" ? timeLabel(item) : item.replaceAll("_", " "));
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [validationError, setValidationError] = useState<string>();
  const errorId = `${id}-error`;
  const update = useFeedbackMutation({
    feedback: { action: `save your ${label.toLowerCase()}`, form: true },
    mutationFn: save,
    onSuccess: () => setQuery(null),
  });
  const all = kind === "time" ? times : zones;
  const search = query === null || query === format(value) ? "" : normalize(query);
  const parsed = kind === "time" && search ? typedTime(query ?? "") : undefined;
  const matches = search
    ? all.filter(
        (item) => normalize(format(item)).includes(search) || normalize(item).includes(search),
      )
    : kind === "time"
      ? [...all.filter((item) => item >= value), ...all.filter((item) => item < value)]
      : all;
  const items = Array.from(
    new Set([...(parsed ? [parsed] : []), ...(!search ? [value] : []), ...matches]),
  ).slice(0, 6);
  return (
    <Field orientation="horizontal" className="profile-setting-row justify-between">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {validationError ? <FieldError id={errorId}>{validationError}</FieldError> : null}
      </FieldContent>
      <Combobox
        autoHighlight
        items={items}
        filter={null}
        value={value}
        inputValue={query ?? format(value)}
        itemToStringLabel={format}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && !update.isError && !validationError) setQuery(null);
        }}
        onInputValueChange={(next, details) => {
          // Closing the popup synchronizes its input to the saved selection. Keep
          // a rejected draft until the user actually edits it.
          if (validationError && details.reason === "none") {
            details.cancel();
            return;
          }
          if (details.reason !== "item-press") {
            setQuery(next);
            setValidationError(undefined);
          }
        }}
        onValueChange={(next, details) => {
          if (!next) return;
          if (next === value) {
            setValidationError(undefined);
            setOpen(false);
            setQuery(null);
            return;
          }
          const error = validate?.(next);
          if (error) {
            details.cancel();
            setQuery(format(next));
            setValidationError(error);
            toast.error("Check the highlighted settings fields.");
            return;
          }
          setValidationError(undefined);
          setQuery(format(next));
          setOpen(false);
          update.mutate(next);
        }}
      >
        <ComboboxInput
          id={id}
          aria-label={label}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? errorId : undefined}
          disabled={update.isPending}
          className="settings-value-input"
          showTrigger={false}
          showClear={false}
          onFocus={(event) => event.currentTarget.select()}
          placeholder={kind === "time" ? "9:00 AM" : "Search time zones"}
        >
          {kind === "time" ? (
            <InputGroupAddon align="inline-start">
              <ClockIcon aria-hidden="true" />
            </InputGroupAddon>
          ) : null}
        </ComboboxInput>
        <ComboboxContent align="end" className="min-w-52">
          <ComboboxEmpty>No matching options.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {format(item)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}
