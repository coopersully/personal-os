export type CsvProvider = "paypal" | "venmo" | "zelle";
export const csvProviders: Record<CsvProvider, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
};
export const isCsvProvider = (value: string): value is CsvProvider => value in csvProviders;

/** The server accepts at most this many characters of CSV in one import. */
export const csvLimit = 1_000_000;

export interface CsvPreviewRow {
  date: string;
  merchant: string;
  amount: number;
  direction: "income" | "expense";
  notes: string | null;
}
export type CsvPreview =
  | { rows: CsvPreviewRow[]; from: string; to: string; identified: boolean }
  | { problem: string };

const headerKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "");

function parseRows(csv: string): string[][] | null {
  const rows: string[][] = [];
  let field = "";
  let quoted = false;
  let row: string[] = [];
  const end = () => {
    row.push(field.trim());
    if (row.some(Boolean)) rows.push(row);
    row = [];
    field = "";
  };
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] as string;
    const next = csv[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      end();
    } else field += character;
  }
  end();
  return quoted ? null : rows;
}

function parseDate(text: string): string | null {
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const parsed = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2])));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === Number(match[1]) - 1
    ? parsed.toISOString().slice(0, 10)
    : null;
}

/**
 * Reads a PayPal, Venmo or Zelle export the way the import does, so a person sees what will be
 * imported before anything is written. The server reads the file again when importing and is
 * the authority: this is a preview, kept in step with `apps/api/src/finance-csv.ts`. Like the
 * server, one unreadable row makes the whole file unreadable; nothing is imported in part.
 */
export function previewCsv(provider: CsvProvider, csv: string): CsvPreview {
  if (!csv.trim()) return { problem: "This file is empty." };
  if (csv.length > csvLimit)
    return { problem: "This file is too large to import. Split it into smaller exports." };
  const parsed = parseRows(csv);
  if (!parsed) return { problem: "This file has a quoted value that is never closed." };
  const [header, ...body] = parsed;
  if (!header || body.length === 0)
    return { problem: "This file needs a header row and at least one transaction." };
  const headers = header.map(headerKey);
  const rows: CsvPreviewRow[] = [];
  let identified = true;
  for (const [index, cells] of body.entries()) {
    const record = Object.fromEntries(headers.map((key, position) => [key, cells[position] ?? ""]));
    const value = (...keys: string[]) => {
      for (const key of keys) {
        const candidate = record[headerKey(key)];
        if (candidate) return candidate;
      }
      return "";
    };
    const line = index + 2;
    const rawText = value("Amount", "Amount (total)", "Net Amount");
    const raw = Number(rawText.replaceAll(/[,$]/g, "").replace(/^\((.*)\)$/, "-$1"));
    if (!Number.isFinite(raw) || raw === 0)
      return {
        problem: rawText
          ? `Line ${line} has an amount that cannot be read: ${rawText}`
          : `Line ${line} has no amount. The file needs an Amount column.`,
      };
    const dateText = value("Date", "Datetime", "Date & Time", "Initiated Date");
    const date = parseDate(dateText);
    if (!date)
      return {
        problem: dateText
          ? `Line ${line} has a date that cannot be read: ${dateText}`
          : `Line ${line} has no date. The file needs a Date column.`,
      };
    const type = value("Type", "Transaction Type", "Status").toLowerCase();
    const direction = /refund|payment received|credit|deposit|received/.test(type)
      ? "income"
      : provider === "zelle" && /sent|payment/.test(type)
        ? "expense"
        : raw < 0
          ? "income"
          : "expense";
    if (!value("Transaction ID", "ID", "Funding Source ID")) identified = false;
    rows.push({
      date,
      merchant: value("Name", "From", "To", "Merchant", "Description") || "Imported transaction",
      amount: Math.abs(raw),
      direction,
      notes: value("Note", "Memo", "Subject") || null,
    });
  }
  const dates = rows.map((row) => row.date).sort();
  return { rows, from: dates[0] as string, to: dates.at(-1) as string, identified };
}
