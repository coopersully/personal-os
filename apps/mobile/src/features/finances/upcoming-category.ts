import type { FinanceRecurringObligation, FinanceRecurringOccurrence } from "@personal-os/domain";
import type { IconName } from "../../components/icons";
import { useFinanceRead } from "./data";

/** Recurring types are authoritative; they are not guessed transaction categories. */
export function upcomingCategory(
  item: FinanceRecurringOccurrence,
  obligations: readonly FinanceRecurringObligation[] | undefined,
): { label: string; icon: IconName } {
  if (item.source.kind === "income") return { label: "Income", icon: "categoryDollar" };
  const kind = obligations?.find((source) => source.id === item.source.id)?.kind;
  switch (kind) {
    case "subscription":
      return { label: "Subscription", icon: "receipt" };
    case "savings":
      return { label: "Savings", icon: "finances" };
    case "bill":
      return { label: "Bill", icon: "wallet" };
    default:
      return { label: "Recurring payment", icon: "calendar" };
  }
}
export function useUpcomingCategories(enabled: boolean) {
  return useFinanceRead(
    ["recurring-obligations"],
    (api) => api.listFinanceRecurringObligations(),
    enabled,
  );
}
