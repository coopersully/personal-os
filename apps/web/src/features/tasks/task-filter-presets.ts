import { addLocalDays, localDateAt, localDateTimeToUtc } from "@personal-os/domain";

export const datePresets = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next-seven", label: "Next 7 days" },
  { value: "custom", label: "Custom range" },
] as const;
export type DatePreset = (typeof datePresets)[number]["value"];
export type DateBounds = { after: string; before: string };

export function presetBounds(
  preset: Exclude<DatePreset, "custom">,
  timeZone: string,
  now = new Date(),
): DateBounds {
  if (preset === "any") return { after: "", before: "" };
  const today = localDateAt(now, timeZone);
  const start = preset === "tomorrow" ? 1 : 0;
  const end = preset === "next-seven" ? 7 : start + 1;
  return {
    after: localDateTimeToUtc(addLocalDays(today, start), 0, timeZone).toISOString(),
    // The API's before bound is inclusive: exclude midnight of the following day.
    before: new Date(
      localDateTimeToUtc(addLocalDays(today, end), 0, timeZone).getTime() - 1,
    ).toISOString(),
  };
}

export function identifyPreset(bounds: DateBounds, timeZone: string, now = new Date()): DatePreset {
  return (
    datePresets.find(({ value }) => {
      if (value === "custom") return false;
      const expected = presetBounds(value, timeZone, now);
      return expected.after === bounds.after && expected.before === bounds.before;
    })?.value ?? "custom"
  );
}
