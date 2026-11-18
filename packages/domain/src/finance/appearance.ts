import { z } from "zod";

export const financeGroupIconSchema = z.enum([
  "category",
  "bucket",
  "uncategorized",
  "home",
  "groceries",
  "dining",
  "transport",
  "travel",
  "subscriptions",
  "health",
  "shopping",
  "income",
  "savings",
  "debt",
  "education",
  "gifts",
  "entertainment",
  "lifestyle",
]);
export type FinanceGroupIcon = z.infer<typeof financeGroupIconSchema>;
/** Presentation is inferred consistently for existing records and every creation path, including MCP. */
export function financeGroupIcon(
  label: string,
  fallback: "category" | "bucket" | "uncategorized" = "category",
): FinanceGroupIcon {
  const rules: Array<[RegExp, FinanceGroupIcon]> = [
    [/uncategorized|unknown|other spending/i, "uncategorized"],
    [/rent|mortgage|housing|home|utilities|essential/i, "home"],
    [/dining|restaurant|coffee|cafe|takeout/i, "dining"],
    [/grocer|food|market/i, "groceries"],
    [/travel|flight|holiday|vacation/i, "travel"],
    [/transport|car|fuel|gas|rail|transit|parking/i, "transport"],
    [/subscription|internet|phone|software/i, "subscriptions"],
    [/health|medical|care|fitness/i, "health"],
    [/shopping|clothing|personal/i, "shopping"],
    [/income|salary|payroll/i, "income"],
    [/saving|emergency|invest/i, "savings"],
    [/debt|credit|loan/i, "debt"],
    [/educat|school|book/i, "education"],
    [/gift|donat|charit/i, "gifts"],
    [/entertain|cinema|music|fun/i, "entertainment"],
    [/lifestyle|discretionary/i, "lifestyle"],
  ];
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? fallback;
}
