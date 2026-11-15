import { addLocalDays, localDateAt, localDateTimeToUtc } from "@personal-os/domain";

/** The same due-date shortcuts, and the same bounds, as the web task filters. */
export const dateShortcuts = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next-seven", label: "Next 7 days" },
] as const;
export type DateShortcut = (typeof dateShortcuts)[number]["value"];
export type DateBounds = { after?: string; before?: string };

/** Whole calendar days in the account timezone, including across DST. */
export function shortcutBounds(
  shortcut: DateShortcut,
  timeZone: string,
  now = new Date(),
): DateBounds {
  if (shortcut === "any") return {};
  const today = localDateAt(now, timeZone);
  const start = shortcut === "tomorrow" ? 1 : 0;
  const end = shortcut === "next-seven" ? 7 : start + 1;
  return {
    after: localDateTimeToUtc(addLocalDays(today, start), 0, timeZone).toISOString(),
    // The API's before bound is inclusive: exclude midnight of the following day.
    before: new Date(
      localDateTimeToUtc(addLocalDays(today, end), 0, timeZone).getTime() - 1,
    ).toISOString(),
  };
}

/** The shortcut these bounds came from, or "custom" for a range set with the date pickers. */
export function identifyShortcut(
  bounds: DateBounds,
  timeZone: string,
  now = new Date(),
): DateShortcut | "custom" {
  return (
    dateShortcuts.find(({ value }) => {
      const expected = shortcutBounds(value, timeZone, now);
      return (
        (expected.after ?? "") === (bounds.after ?? "") &&
        (expected.before ?? "") === (bounds.before ?? "")
      );
    })?.value ?? "custom"
  );
}
