import { type FinanceGroupIcon, financeGroupIcon } from "@personal-os/domain";
import type { IconName } from "../../components/icons";

const categoryIcons: Record<FinanceGroupIcon, IconName> = {
  category: "categoryTags",
  bucket: "categoryLayers",
  uncategorized: "categoryCircleHelp",
  home: "home",
  groceries: "categoryGroceryCart",
  dining: "categoryDining",
  transport: "categoryTransport",
  travel: "categoryTravel",
  subscriptions: "receipt",
  health: "categoryHealth",
  shopping: "categoryMerchant",
  income: "categoryDollar",
  savings: "finances",
  debt: "wallet",
  education: "categoryEducation",
  gifts: "categoryGift",
  entertainment: "categoryEntertainment",
  lifestyle: "categorySparkles",
};
export function categoryIcon(
  label: string,
  supplied?: FinanceGroupIcon,
  fallback: "category" | "bucket" | "uncategorized" = "category",
): IconName {
  return categoryIcons[supplied ?? financeGroupIcon(label, fallback)];
}

/** End-of-local-day allowance avoids flagging ordinary spending throughout the first day. */
export function budgetPace(
  spent: number,
  limit: number,
  timezone: string | null | undefined,
  now = new Date(),
) {
  if (!Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) return "unknown";
  if (spent > limit) return "over";
  if (!timezone) return "unknown";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const days = new Date(Date.UTC(part("year"), part("month"), 0)).getUTCDate();
  return spent / limit > part("day") / days ? "high" : "normal";
}

const providerCategoryLabels: Record<string, string> = {
  FOOD_AND_DRINK: "Food & Drink",
  GENERAL_MERCHANDISE: "Shopping",
  TRANSFER_IN: "Transfers",
  TRANSFER_OUT: "Transfers",
};
/** The provider's category codes. Only these are reworded; `HSA` stays a name a person chose. */
const providerCategoryCodes = new Set([
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "INCOME",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "OTHER",
  "PERSONAL_CARE",
  "RENT_AND_UTILITIES",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "TRANSPORTATION",
  "TRAVEL",
]);
/**
 * A category stored under a provider's raw code (`RENT_AND_UTILITIES`) reads as words, using the
 * same wording as web. Names a person typed are left exactly as written; the stored name is
 * still what a write sends.
 */
export function categoryLabel(name: string | null | undefined): string {
  if (!name) return "Uncategorized";
  if (providerCategoryLabels[name]) return providerCategoryLabels[name];
  if (!providerCategoryCodes.has(name)) return name;
  return name
    .toLowerCase()
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
