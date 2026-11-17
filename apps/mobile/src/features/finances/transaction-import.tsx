import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { until, useFinanceWrite, useSettled } from "./cashflow-data";
import { CashflowForm } from "./cashflow-form";
import { cashflowDate } from "./cashflow-rules";
import {
  type CsvProvider,
  csvProviders,
  csvTooLarge,
  isCsvProvider,
  previewCsv,
} from "./csv-import";
import { useFinance, useFinanceRead } from "./data";
import { pickCsv } from "./finance-files";
import { formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

/** Rows shown before the rest are summarized as a count. */
const shown = 50;
const counted = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

function ImportForm(props: {
  account: { id: string; name: string; currencyCode: string | null };
  provider: CsvProvider;
}) {
  const { api } = useFinance();
  const write = useFinanceWrite();
  const [{ account, provider }] = useState(props);
  const [file, setFile] = useState<{ name: string; text: string | null } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const picking = useRef(false);
  const preview = !file
    ? null
    : file.text === null
      ? { problem: csvTooLarge }
      : previewCsv(provider, file.text);
  const ready = preview && "rows" in preview ? preview : null;
  const amount = (value: number) =>
    account.currencyCode
      ? formatMoney(value, account.currencyCode)
      : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function choose() {
    if (picking.current || write.locked.current) return;
    picking.current = true;
    setChoosing(true);
    try {
      const picked = await pickCsv();
      if (picked) setFile(picked);
    } catch {
      toast.error("Couldn’t read that file. Choose it again.");
    } finally {
      picking.current = false;
      setChoosing(false);
    }
  }
  async function save() {
    if (!file?.text || !ready) return;
    const input = { accountId: account.id, provider, csv: file.text };
    const saved = await write.run<{ imported: number; skipped: number }>(
      input,
      (idempotencyKey) =>
        api.importFinanceTransactions({ ...input, idempotencyKey }) as Promise<{
          outcome: string;
          data?: { imported: number; skipped: number };
          communication: { headline: string };
        }>,
      {
        loading: "Importing transactions…",
        done: (data) =>
          !data || !Number.isInteger(data.imported) || !Number.isInteger(data.skipped)
            ? "Import complete"
            : data.imported === 0
              ? `Nothing new to import: all ${counted(data.skipped)} were already in this account.`
              : data.skipped === 0
                ? `Imported ${counted(data.imported)}`
                : `Imported ${counted(data.imported)}; ${data.skipped} already in this account ${data.skipped === 1 ? "was" : "were"} skipped.`,
        conflict:
          "An earlier import of this file is still being processed, or it failed. Check the account’s transactions, then import again if they are missing; rows already there are skipped.",
        // The server reads the whole file before writing and says what it could not read.
        rejected: (error) =>
          `Couldn’t import this file. Nothing was imported.${error.message ? ` ${error.message}` : ""}`,
        unknown:
          "Couldn’t confirm the import. Check the account’s transactions. Importing this same file again is safe: rows already in the account are skipped.",
      },
    );
    if (saved) router.back();
  }
  return (
    <CashflowForm
      title="Import transactions"
      edited={!!file}
      pending={write.pending}
      invalid={!ready}
      saveLabel="Import"
      saveIcon="check"
      discard="Nothing has been imported."
      onSave={() => void save()}
    >
      <Copy secondary>
        Import a CSV exported from {csvProviders[provider]} into {account.name}. Nothing is imported
        until you choose Import, and rows already in this account are skipped.
      </Copy>
      <Card rows>
        <FinanceRow centered title="Account" value={account.name} icon="finances" />
        <FinanceRow centered title="Export from" value={csvProviders[provider]} icon="receipt" />
        <FinanceRow centered title="File" value={file?.name ?? "None chosen"} icon="archive" />
      </Card>
      <SettingsAccentProvider workspace="finances">
        <Actions inset={false}>
          <Action
            label={file ? "Choose another file" : "Choose file"}
            accessibilityLabel={file ? "Choose another CSV file" : "Choose a CSV file"}
            disabled={choosing || write.pending}
            onPress={() => void choose()}
          />
        </Actions>
      </SettingsAccentProvider>
      {preview && "problem" in preview && (
        <Card>
          <Copy>This file cannot be imported</Copy>
          <Copy secondary>
            {preview.problem} Nothing from a file is imported unless every row can be read.
          </Copy>
        </Card>
      )}
      {ready && (
        <Section title="What will be imported">
          <Copy secondary>
            {counted(ready.rows.length)}
            {ready.from === ready.to
              ? ` on ${cashflowDate(ready.from)}`
              : `, ${cashflowDate(ready.from)} to ${cashflowDate(ready.to)}`}
            . This is how nohmi reads the file; it is read again when you import.
            {ready.identified
              ? ""
              : " This file has no transaction ID column, so a row is recognized as already imported only if the file keeps the same rows in the same order."}
          </Copy>
          <Card rows>
            {ready.rows.slice(0, shown).map((row, index) => (
              <FinanceRow
                // biome-ignore lint/suspicious/noArrayIndexKey: rows of one immutable file have no identity; identical rows must all be shown.
                key={index}
                title={row.merchant}
                subtitle={`${cashflowDate(row.date)}${row.notes ? ` · ${row.notes}` : ""}`}
                value={`${row.direction === "income" ? "+" : "−"}${amount(row.amount)}`}
                icon={row.direction === "income" ? "categoryDollar" : "receipt"}
              />
            ))}
          </Card>
          {ready.rows.length > shown && (
            <Copy secondary>
              And {ready.rows.length - shown} more. Every row in the file is imported.
            </Copy>
          )}
        </Section>
      )}
    </CashflowForm>
  );
}

/** Imports a PayPal, Venmo or Zelle CSV export into the account named by `accountId`. */
export function FinanceTransactionImport() {
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const settled = useSettled(query);
  const account = query.data?.accounts.find((item) => item.id === accountId);
  // The form keeps the account it opened with: a re-read must not discard a chosen file.
  const opened = useRef<Parameters<typeof ImportForm>[0] | null>(null);
  if (!opened.current && settled && account && isCsvProvider(account.provider))
    opened.current = { account, provider: account.provider };
  return (
    <ReadState query={until(query, settled)}>
      <Stack.Screen options={{ title: "import" }} />
      {opened.current ? (
        <ImportForm {...opened.current} />
      ) : (
        <FinanceScreen title="Import">
          <Copy secondary>
            {account
              ? "Only a PayPal, Venmo or Zelle account can take a CSV import."
              : "This account is unavailable."}
          </Copy>
        </FinanceScreen>
      )}
    </ReadState>
  );
}
