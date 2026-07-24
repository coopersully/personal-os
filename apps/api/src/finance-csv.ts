import type { FinanceProvider, TransactionDirection } from "@personal-os/domain";

export type ImportedFinanceRecord = {
  amount: number;
  date: string;
  direction: TransactionDirection;
  externalId: string;
  merchant: string;
  notes: string | null;
};

function headerKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "");
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let quoted = false;
  let row: string[] = [];
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] as string;
    const next = csv[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  return rows;
}

function value(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = record[headerKey(key)];
    if (candidate) return candidate;
  }
  return "";
}

function amount(valueToParse: string) {
  const normalized = valueToParse.replaceAll(/[,$]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed === 0)
    throw new Error(`Invalid transaction amount: ${valueToParse}`);
  return parsed;
}

function date(valueToParse: string) {
  const iso = valueToParse.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const match = valueToParse.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) throw new Error(`Invalid transaction date: ${valueToParse}`);
  const [, month, day, rawYear] = match;
  const year = Number(rawYear) < 100 ? 2000 + Number(rawYear) : Number(rawYear);
  const parsed = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== Number(month) - 1)
    throw new Error(`Invalid transaction date: ${valueToParse}`);
  return parsed.toISOString().slice(0, 10);
}

function direction(provider: FinanceProvider, rawAmount: number, record: Record<string, string>) {
  const type = value(record, "Type", "Transaction Type", "Status").toLowerCase();
  if (/refund|payment received|credit|deposit|received/.test(type)) return "income" as const;
  if (provider === "zelle" && /sent|payment/.test(type)) return "expense" as const;
  return rawAmount < 0 ? ("income" as const) : ("expense" as const);
}

export function parseFinanceCsv(provider: "paypal" | "venmo" | "zelle", csv: string) {
  const [header, ...body] = parseRows(csv);
  if (!header || body.length === 0)
    throw new Error("The CSV must include a header and at least one transaction.");
  const headers = header.map(headerKey);
  return body.map((row, index): ImportedFinanceRecord => {
    const record = Object.fromEntries(headers.map((key, position) => [key, row[position] ?? ""]));
    const rawAmount = amount(value(record, "Amount", "Amount (total)", "Net Amount"));
    const merchant =
      value(record, "Name", "From", "To", "Merchant", "Description") || "Imported transaction";
    const importedDate = date(value(record, "Date", "Datetime", "Date & Time", "Initiated Date"));
    const externalId =
      value(record, "Transaction ID", "ID", "Funding Source ID") ||
      `${importedDate}:${merchant}:${rawAmount}:${index}`;
    return {
      amount: Math.abs(rawAmount),
      date: importedDate,
      direction: direction(provider, rawAmount, record),
      externalId,
      merchant,
      notes: value(record, "Note", "Memo", "Subject") || null,
    };
  });
}
