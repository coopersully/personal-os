import type { QueryClient } from "@tanstack/react-query";

const materialQueryKeys = [
  "activity",
  "agenda",
  "calendars",
  "daily-brief",
  "events",
  "reminders",
  "tasks",
] as const;

export async function invalidateMaterial(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    materialQueryKeys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
