import type { FinanceTransaction } from "@personal-os/domain";
import { categoryLabel } from "./category-presentation";

/** An export stops here and says so, instead of reading a ledger without end. */
export const exportLimit = 5000;

type Row = Pick<
  FinanceTransaction,
  "date" | "merchant" | "amount" | "direction" | "currencyCode" | "category" | "notes" | "pending"
>;

/**
 * A spreadsheet runs a cell that starts with `=`, `+`, `-` or `@` as a formula, so such text
 * is prefixed with an apostrophe. A plain number, such as a negative amount, is left alone.
 */
const cell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

/** Income is positive and an expense negative; a transfer keeps its recorded amount. */
const signed = (row: Row) => (row.direction === "expense" ? -row.amount : row.amount).toFixed(2);

/**
 * The transactions as CSV: every cell quoted, CRLF lines and a byte-order mark so a
 * spreadsheet reads it as UTF-8. Amounts are plain numbers so they can be summed.
 */
export function transactionsCsv(rows: readonly Row[]): string {
  const lines = [
    ["Date", "Merchant", "Amount", "Currency", "Type", "Status", "Category", "Notes"],
    ...rows.map((row) => [
      row.date,
      row.merchant,
      signed(row),
      row.currencyCode ?? "",
      row.direction === "income" ? "Income" : row.direction === "expense" ? "Expense" : "Transfer",
      row.pending ? "Pending" : "Posted",
      row.category ? categoryLabel(row.category) : "",
      row.notes ?? "",
    ]),
  ];
  return `${byteOrderMark}${lines.map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Tells a spreadsheet the file is UTF-8. Written as a code point so it is visible in source. */
const byteOrderMark = String.fromCharCode(0xfeff);

/** Reads every page of a transaction view, up to the export limit. */
export async function collectTransactions<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string | null }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    rows.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor && rows.length < exportLimit);
  return { rows: rows.slice(0, exportLimit), truncated: !!cursor || rows.length > exportLimit };
}
