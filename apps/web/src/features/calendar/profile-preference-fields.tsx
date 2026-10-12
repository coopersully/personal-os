import type { CalendarProfilePreferences, DomainProfile } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function CalendarProfilePreferenceFields({
  preferences,
  onChange,
  disabled,
  sourceIds,
  draft,
}: {
  preferences: DomainProfile["preferences"];
  onChange: (preferences: DomainProfile["preferences"]) => void;
  disabled: boolean;
  sourceIds: string[];
  draft: boolean;
}) {
  const calendars = useQuery({ queryKey: ["calendars"], queryFn: api.listCalendars });
  const writable =
    calendars.data?.filter((calendar) => calendar.isWritable && sourceIds.includes(calendar.id)) ??
    [];
  const currentId = String(preferences.defaultCalendarId ?? "");
  const change = (patch: Record<string, string | number>) => onChange({ ...preferences, ...patch });
  return (
    <FieldGroup>
      <QueryFeedback query={calendars} title="Couldn’t load calendars." />
      <Field>
        <FieldLabel htmlFor="calendar-default-destination">Default calendar</FieldLabel>
        <NativeSelect
          id="calendar-default-destination"
          name="preferences.defaultCalendarId"
          value={currentId}
          required={!draft}
          disabled={disabled || calendars.isPending || calendars.isError}
          onChange={(event) => change({ defaultCalendarId: event.target.value })}
        >
          {!writable.some((calendar) => calendar.id === currentId) ? (
            <NativeSelectOption value={currentId} disabled>
              {currentId ? "Current calendar unavailable" : "Choose a calendar"}
            </NativeSelectOption>
          ) : null}
          {writable.map((calendar) => (
            <NativeSelectOption key={calendar.id} value={calendar.id}>
              {calendar.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          Only calendars configured in this profile are available.{" "}
          <a href="/settings?section=calendar#calendar-setup" className="underline">
            Open Calendar setup to add a source.
          </a>
        </FieldDescription>
      </Field>
      {(["beforeBufferMinutes", "afterBufferMinutes"] as const).map((key) => (
        <Field key={key}>
          <FieldLabel htmlFor={`calendar-${key}`}>
            {key === "beforeBufferMinutes"
              ? "Buffer before events (minutes)"
              : "Buffer after events (minutes)"}
          </FieldLabel>
          <Input
            id={`calendar-${key}`}
            name={`preferences.${key}`}
            type="number"
            required={!draft}
            min={0}
            max={1440}
            step={1}
            disabled={disabled}
            value={typeof preferences[key] === "number" ? preferences[key] : ""}
            onChange={(event) => {
              const next = { ...preferences };
              if (draft && event.target.value === "") delete next[key];
              else next[key] = event.target.value === "" ? "" : Number(event.target.value);
              onChange(next);
            }}
          />
        </Field>
      ))}
      <Field>
        <FieldLabel htmlFor="calendar-busy-block-privacy">Busy block privacy</FieldLabel>
        <NativeSelect
          id="calendar-busy-block-privacy"
          name="preferences.busyBlockPrivacy"
          required={!draft}
          disabled={disabled}
          value={String(preferences.busyBlockPrivacy ?? "")}
          onChange={(event) =>
            change({
              busyBlockPrivacy: event.target
                .value as CalendarProfilePreferences["busyBlockPrivacy"],
            })
          }
        >
          <NativeSelectOption value="" disabled>
            Choose privacy
          </NativeSelectOption>
          <NativeSelectOption value="busy">Show busy only</NativeSelectOption>
          <NativeSelectOption value="details">Include event details</NativeSelectOption>
        </NativeSelect>
      </Field>
    </FieldGroup>
  );
}
