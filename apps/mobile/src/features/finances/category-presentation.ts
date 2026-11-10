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

export function categoryLabel(value: string) {
  const words = value.replaceAll("_", " ");
  return words === words.toUpperCase() || words === words.toLowerCase()
    ? words.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
    : words;
}
