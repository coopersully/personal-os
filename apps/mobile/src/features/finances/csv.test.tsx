// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { previewCsv } from "./csv-import";
import { pickCsv, shareCsv } from "./finance-files";
import { Transactions } from "./spending";
import { collectTransactions, exportLimit, transactionsCsv } from "./transaction-csv";
import { ExportTransactions } from "./transaction-export";
import { FinanceTransactionImport } from "./transaction-import";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  platform: "ios",
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  share: vi.fn(),
  files: {
    picked: null as null | { name: string; text: string; size?: number },
    read: 0,
    /** A write settles when this does; reject it to fail the write. */
    writing: Promise.resolve() as Promise<void>,
    pickError: false,
    written: [] as { uri: string; content: string }[],
    deleted: [] as string[],
    existing: new Set<string>(),
  },
  api: {
    listFinanceAccounts: vi.fn(),
    listFinanceTransactions: vi.fn(),
    listFinanceSpendingTransactions: vi.fn(),
    getFinanceCategories: vi.fn(),
    importFinanceTransactions: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({ children, testID }: PropsWithChildren<{ testID?: string }>) => (
    <div data-testid={testID}>{children}</div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Share: { share: h.share, sharedAction: "sharedAction", dismissedAction: "dismissedAction" },
    Platform: {
      get OS() {
        return h.platform;
      },
    },
    useColorScheme: () => "light",
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityHint,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityHint?: string;
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-description={accessibilityHint}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
      disabled,
    }: {
      accessibilityLabel?: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        disabled={!editable}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ),
  };
});
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/glass-surface", () => ({
  GlassSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.owner },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-router", () => ({
  router: h,
  useLocalSearchParams: () => h.params,
  useFocusEffect: () => undefined,
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => {
      h.screen(options);
      return (
        <>
          {options.headerLeft?.() ?? null}
          {options.headerRight?.() ?? null}
        </>
      );
    },
  },
}));

vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    name: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.name = String(parts.at(-1));
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get exists() {
      return h.files.existing.has(this.uri);
    }
    create() {
      h.files.existing.add(this.uri);
    }
    async write(content: string) {
      await h.files.writing;
      h.files.written.push({ uri: this.uri, content });
    }
    delete() {
      h.files.existing.delete(this.uri);
      h.files.deleted.push(this.uri);
    }
    get size() {
      return h.files.picked?.size ?? h.files.picked?.text.length ?? 0;
    }
    async text() {
      h.files.read += 1;
      return h.files.picked?.text ?? "";
    }
    static async pickFileAsync() {
      if (h.files.pickError) throw new Error("picker failed");
      if (!h.files.picked) return { canceled: true, result: null };
      const file = new File("file:///tmp/picked", h.files.picked.name);
      h.files.existing.add(file.uri);
      return { canceled: false, result: file };
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get exists() {
      return h.files.existing.has(this.uri);
    }
    create() {
      h.files.existing.add(this.uri);
    }
    /** Removes the directory and everything under it. */
    delete() {
      for (const uri of [...h.files.existing])
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) h.files.existing.delete(uri);
      h.files.deleted.push(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: { uri: "file:///cache" } } };
});

const venmo = { id: "acct-v", name: "Venmo", provider: "venmo", currencyCode: "USD" };
const checking = { id: "acct-c", name: "Checking", provider: "manual", currencyCode: "USD" };
const valid = [
  "ID,Datetime,Type,Note,From,To,Amount (total)",
  '101,2026-11-03T10:00:00,Payment,"Dinner, split",Ada,Me,$42.50',
  '102,11/05/2026,Payment,Rent,Me,Landlord,"-$1,200.00"',
  "103,2026-11-06,Standard Transfer,,,,($15.00)",
].join("\r\n");
const completed = <T,>(data: T) => ({
  outcome: "completed",
  data,
  communication: { headline: "" },
});
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}
async function openImport(csv: string | null, name = "venmo.csv") {
  h.params = { accountId: "acct-v" };
  h.files.picked = csv === null ? null : { name, text: csv };
  const view = mount(<FinanceTransactionImport />);
  await screen.findByText("Import transactions");
  return view;
}
async function choose(label = "Choose a CSV file") {
  await act(async () => {
    press(label);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = {};
  h.platform = "ios";
  h.files.picked = null;
  h.files.pickError = false;
  h.files.read = 0;
  h.files.writing = Promise.resolve();
  h.files.written = [];
  h.files.deleted = [];
  h.files.existing = new Set();
  h.share.mockReset();
  h.share.mockResolvedValue({ action: "sharedAction" });
  h.api.listFinanceAccounts.mockResolvedValue({ accounts: [venmo, checking] });
});
afterEach(cleanup);

// ── Reading a file before import ─────────────────────────────────────────────

it("reads an export the way the import does", () => {
  const preview = previewCsv("venmo", valid);
  expect(preview).toEqual({
    from: "2026-11-03",
    to: "2026-11-06",
    identified: true,
    rows: [
      {
        date: "2026-11-03",
        merchant: "Ada",
        amount: 42.5,
        direction: "expense",
        notes: "Dinner, split",
      },
      { date: "2026-11-05", merchant: "Me", amount: 1200, direction: "income", notes: "Rent" },
      {
        date: "2026-11-06",
        merchant: "Imported transaction",
        amount: 15,
        direction: "income",
        notes: null,
      },
    ],
  });
  const zelle = previewCsv(
    "zelle",
    "Date,Description,Amount,Type\n1/2/26,Sam,50,Payment Sent\n01/03/2026,Kim,20,Deposit\n",
  );
  expect(zelle).toMatchObject({
    identified: false,
    rows: [
      { date: "2026-01-02", direction: "expense", merchant: "Sam" },
      { date: "2026-01-03", direction: "income", merchant: "Kim" },
    ],
  });
  expect(previewCsv("paypal", 'Date,Name,Amount\n2026-01-01,"Say ""hi""",5')).toMatchObject({
    rows: [{ merchant: 'Say "hi"' }],
  });
});

it("names what is wrong with a file it cannot read", () => {
  const problem = (csv: string) => (previewCsv("venmo", csv) as { problem?: string }).problem;
  expect(problem("  \n ")).toBe("This file is empty.");
  expect(problem("Date,Amount")).toBe("This file needs a header row and at least one transaction.");
  expect(problem('Date,Amount\n2026-01-01,"5')).toBe(
    "This file has a quoted value that is never closed.",
  );
  expect(problem("Date,Amount\n2026-01-01,abc")).toBe(
    "Line 2 has an amount that cannot be read: abc",
  );
  expect(problem("Date,Amount\n2026-01-01,5\n2026-01-02,0")).toBe(
    "Line 3 has an amount that cannot be read: 0",
  );
  expect(problem("Date,Total\n2026-01-01,5")).toBe(
    "Line 2 has no amount. The file needs an Amount column.",
  );
  expect(problem("Date,Amount\nyesterday,5")).toBe(
    "Line 2 has a date that cannot be read: yesterday",
  );
  expect(problem("Date,Amount\n13/45/2026,5")).toBe(
    "Line 2 has a date that cannot be read: 13/45/2026",
  );
  expect(problem("When,Amount\n2026-01-01,5")).toBe(
    "Line 2 has no date. The file needs a Date column.",
  );
  expect(problem(`Date,Amount\n${"2026-01-01,5\n".repeat(90_000)}`)).toMatch(/too large/);
});

// ── Import ───────────────────────────────────────────────────────────────────

it("shows what a valid file holds, then imports it and reports the exact counts", async () => {
  h.api.importFinanceTransactions.mockResolvedValue(completed({ imported: 3, skipped: 0 }));
  await openImport(valid);
  expect(h.screen.mock.lastCall?.[0]).toMatchObject({ title: "", headerBackVisible: false });
  expect(button("Import")).toHaveProperty("disabled", true);
  // The confirm control is the check other forms use, named for what it does.
  expect(button("Import").querySelector('[data-icon="check"]')).toBeTruthy();
  expect(screen.getByText("None chosen")).toBeTruthy();
  await choose();
  expect(await screen.findByText("venmo.csv")).toBeTruthy();
  expect(screen.getByText(/3 transactions, Nov 3, 2026 to Nov 6, 2026\./)).toBeTruthy();
  expect(screen.getByText("−$42.50")).toBeTruthy();
  expect(screen.getByText("+$1,200.00")).toBeTruthy();
  expect(screen.getByText("Nov 3, 2026 · Dinner, split")).toBeTruthy();
  expect(screen.queryByText(/no transaction ID column/)).toBeNull();
  // The picker's temporary copy is gone as soon as it has been read.
  expect(h.files.deleted).toEqual(["file:///tmp/picked/venmo.csv"]);
  expect(h.api.importFinanceTransactions).not.toHaveBeenCalled();
  fireEvent.click(button("Import"));
  expect(h.loading).toHaveBeenCalledWith("Importing transactions…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Imported 3 transactions", { id: "feedback" }),
  );
  expect(h.api.importFinanceTransactions).toHaveBeenCalledWith({
    accountId: "acct-v",
    provider: "venmo",
    csv: valid,
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("refuses a malformed file before anything is sent", async () => {
  await openImport("Date,Amount\n2026-11-01,12.00\nsoon,4.00\n", "broken.csv");
  await choose();
  expect(await screen.findByText("This file cannot be imported")).toBeTruthy();
  expect(
    screen.getByText(/Line 3 has a date that cannot be read: soon Nothing from a file is imported/),
  ).toBeTruthy();
  expect(screen.queryByText("What will be imported")).toBeNull();
  expect(button("Import")).toHaveProperty("disabled", true);
  fireEvent.click(button("Import"));
  expect(h.api.importFinanceTransactions).not.toHaveBeenCalled();
  // Choosing a readable file afterwards replaces it.
  h.files.picked = { name: "fixed.csv", text: "Date,Amount\n2026-11-01,12.00\n" };
  await choose("Choose another CSV file");
  expect(await screen.findByText(/1 transaction on Nov 1, 2026\./)).toBeTruthy();
  expect(screen.getByText(/no transaction ID column/)).toBeTruthy();
  expect(button("Import")).toHaveProperty("disabled", false);
});

it("reports a partial import: what was added and what was already there", async () => {
  await openImport(valid);
  await choose();
  await screen.findByText("venmo.csv");
  h.api.importFinanceTransactions.mockResolvedValueOnce(completed({ imported: 2, skipped: 1 }));
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Imported 2 transactions; 1 already in this account was skipped.",
      { id: "feedback" },
    ),
  );
  expectNoInlineResult();
});

it("words the other confirmed results exactly", async () => {
  const results: [{ imported: number; skipped: number } | undefined, string][] = [
    [
      { imported: 0, skipped: 3 },
      "Nothing new to import: all 3 transactions were already in this account.",
    ],
    [
      { imported: 1, skipped: 2 },
      "Imported 1 transaction; 2 already in this account were skipped.",
    ],
    [undefined, "Import complete"],
    [{ imported: "3" } as never, "Import complete"],
  ];
  for (const [data, message] of results) {
    const view = await openImport(valid);
    await choose();
    await screen.findByText("venmo.csv");
    h.api.importFinanceTransactions.mockResolvedValueOnce(completed(data));
    fireEvent.click(button("Import"));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(message, { id: "feedback" }));
    view.unmount();
  }
});

it("never reads an unconfirmed or refused import as done", async () => {
  await openImport(valid);
  await choose();
  await screen.findByText("venmo.csv");
  h.api.importFinanceTransactions.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm the import"), {
      id: "feedback",
    }),
  );
  // The same file is sent again under the same key, so the server answers it once.
  h.api.importFinanceTransactions.mockRejectedValueOnce(rejection(409));
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("still being processed"), {
      id: "feedback",
    }),
  );
  h.api.importFinanceTransactions.mockRejectedValueOnce(rejection(400));
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t import this file. Nothing was imported. rejected",
      { id: "feedback" },
    ),
  );
  h.api.importFinanceTransactions.mockResolvedValueOnce({
    outcome: "failed",
    communication: { headline: "Import did not finish." },
  });
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Import did not finish.", { id: "feedback" }),
  );
  const keys = h.api.importFinanceTransactions.mock.calls.map((call) => call[0].idempotencyKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByText("venmo.csv")).toBeTruthy();
  expectNoInlineResult();
});

it("keeps the screen as it was when the picker is cancelled or fails", async () => {
  await openImport(null);
  await choose();
  expect(screen.getByText("None chosen")).toBeTruthy();
  expect(h.error).not.toHaveBeenCalled();
  h.files.pickError = true;
  await choose();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t read that file. Choose it again."),
  );
  expect(button("Choose a CSV file")).toHaveProperty("disabled", false);
  press("Close");
  expect(h.back).toHaveBeenCalledTimes(1);
});

it("asks before discarding a chosen file", async () => {
  await openImport(valid);
  await choose();
  await screen.findByText("venmo.csv");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith(
    "Discard changes?",
    "Nothing has been imported.",
    expect.any(Array),
  );
  expect(h.back).not.toHaveBeenCalled();
});

it("offers import only for an account that can take one", async () => {
  h.params = { accountId: "acct-c" };
  const view = mount(<FinanceTransactionImport />);
  expect(
    await screen.findByText("Only a PayPal, Venmo or Zelle account can take a CSV import."),
  ).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "import" });
  view.unmount();
  h.params = { accountId: "gone" };
  mount(<FinanceTransactionImport />);
  expect(await screen.findByText("This account is unavailable.")).toBeTruthy();
});

it("shows the first rows of a long file and says every row is imported", async () => {
  const long = `Date,Amount,Name\n${Array.from({ length: 60 }, (_, index) => `2026-11-01,${index + 1},Shop ${index + 1}`).join("\n")}`;
  h.api.listFinanceAccounts.mockResolvedValue({ accounts: [{ ...venmo, currencyCode: null }] });
  await openImport(long);
  await choose();
  expect(await screen.findByText(/60 transactions on Nov 1, 2026\./)).toBeTruthy();
  expect(screen.getByText("And 10 more. Every row in the file is imported.")).toBeTruthy();
  expect(screen.getByText("Shop 50")).toBeTruthy();
  expect(screen.queryByText("Shop 51")).toBeNull();
  // Without an account currency no currency is shown.
  expect(screen.getByText("−1.00")).toBeTruthy();
});

// ── Files ────────────────────────────────────────────────────────────────────

it("deletes the picked copy on iPhone only, where it is the app's own copy", async () => {
  h.files.picked = { name: "a.csv", text: "x" };
  expect(await pickCsv()).toEqual({ name: "a.csv", text: "x" });
  expect(h.files.deleted).toEqual(["file:///tmp/picked/a.csv"]);
  h.files.deleted = [];
  h.platform = "android";
  await pickCsv();
  expect(h.files.deleted).toEqual([]);
  h.files.picked = null;
  expect(await pickCsv()).toBeNull();
});

it("leaves no export behind, whether it is shared, cancelled or fails", async () => {
  const folder = "file:///cache/finance-export";
  const uri = `${folder}/out.csv`;
  expect(await shareCsv("out.csv", "a,b")).toBe("shared");
  expect(h.share).toHaveBeenCalledWith({ url: uri });
  expect(h.files.written).toEqual([{ uri, content: "a,b" }]);
  expect(h.files.existing.size).toBe(0);
  h.share.mockResolvedValueOnce({ action: "dismissedAction" });
  expect(await shareCsv("out.csv", "a,b")).toBe("dismissed");
  expect(h.files.existing.size).toBe(0);
  h.share.mockRejectedValueOnce(new Error("sheet failed"));
  await expect(shareCsv("out.csv", "a,b")).rejects.toThrow("sheet failed");
  expect(h.files.existing.size).toBe(0);
});

it("clears an export left by an app that was closed with the share sheet open", async () => {
  const folder = "file:///cache/finance-export";
  h.files.existing.add(folder);
  h.files.existing.add(`${folder}/nohmi-transactions-2026-11-01.csv`);
  let duringShare: string[] = [];
  h.share.mockImplementationOnce(async () => {
    duringShare = [...h.files.existing];
    return { action: "sharedAction" };
  });
  await shareCsv("new.csv", "a,b");
  // Only the new file existed while the sheet was open, and nothing is left afterwards.
  expect(duringShare.sort()).toEqual([folder, `${folder}/new.csv`]);
  expect(h.files.existing.size).toBe(0);
});

it("never reads a file that is too large, and still deletes its copy", async () => {
  h.files.picked = { name: "huge.csv", text: "Date,Amount", size: 4_000_001 };
  expect(await pickCsv()).toEqual({ name: "huge.csv", text: null });
  expect(h.files.read).toBe(0);
  expect(h.files.deleted).toEqual(["file:///tmp/picked/huge.csv"]);
  await openImport("Date,Amount\n2026-11-01,5", "huge.csv");
  h.files.picked = { name: "huge.csv", text: "Date,Amount\n2026-11-01,5", size: 4_000_001 };
  await choose();
  expect(await screen.findByText("This file cannot be imported")).toBeTruthy();
  expect(screen.getByText(/This file is too large to import\./)).toBeTruthy();
  expect(button("Import")).toHaveProperty("disabled", true);
  fireEvent.click(button("Import"));
  expect(h.api.importFinanceTransactions).not.toHaveBeenCalled();
});

// ── Export ───────────────────────────────────────────────────────────────────

const row = (change: Record<string, unknown> = {}) => ({
  id: "t",
  date: "2026-11-03",
  merchant: "Corner Shop",
  amount: 12.5,
  direction: "expense",
  currencyCode: "USD",
  category: "Groceries",
  notes: null,
  pending: false,
  ...change,
});

it("writes transactions as CSV a spreadsheet reads safely", () => {
  const csv = transactionsCsv([
    row(),
    row({
      merchant: '=HYPERLINK("x")',
      direction: "income",
      amount: 100,
      notes: 'He said "hi", twice',
      pending: true,
      category: null,
      currencyCode: null,
    }),
    row({ merchant: "-Minus Co", direction: "transfer", amount: 7 }),
  ] as never);
  expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
  expect(csv.slice(1).split("\r\n")).toEqual([
    '"Date","Merchant","Amount","Currency","Type","Status","Category","Notes"',
    '"2026-11-03","Corner Shop","-12.50","USD","Expense","Posted","Groceries",""',
    '"2026-11-03","\'=HYPERLINK(""x"")","100.00","","Income","Pending","","He said ""hi"", twice"',
    '"2026-11-03","\'-Minus Co","7.00","USD","Transfer","Posted","Groceries",""',
    "",
  ]);
});

it("reads every page of a view and stops at the export limit", async () => {
  const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
    start: { items: [1, 2], nextCursor: "b" },
    b: { items: [3], nextCursor: null },
  };
  const read = vi.fn(async (cursor: string | undefined) => pages[cursor ?? "start"] as never);
  expect(await collectTransactions(read)).toEqual({ rows: [1, 2, 3], truncated: false });
  expect(read.mock.calls.map((call) => call[0])).toEqual([undefined, "b"]);
  const endless = vi.fn(async () => ({ items: Array(2000).fill(0), nextCursor: "more" }));
  const capped = await collectTransactions(endless);
  expect(capped.rows).toHaveLength(exportLimit);
  expect(capped.truncated).toBe(true);
  expect(endless).toHaveBeenCalledTimes(3);
});

function mountExport(page: (cursor: string | undefined) => Promise<never>, disabled = false) {
  return mount(<ExportTransactions view="v1" page={page} disabled={disabled} />);
}

it("exports the whole view through the share sheet and reports the count", async () => {
  const page = vi.fn(
    async (cursor: string | undefined) =>
      (cursor
        ? { items: [row({ id: "b", merchant: "Second" })], nextCursor: null }
        : { items: [row()], nextCursor: "next" }) as never,
  );
  mountExport(page);
  press("Export transactions as CSV");
  expect(h.loading).toHaveBeenCalledWith("Preparing export…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Exported 2 transactions", { id: "feedback" }),
  );
  expect(page).toHaveBeenCalledTimes(2);
  const [written] = h.files.written;
  expect(written?.uri).toMatch(
    /^file:\/\/\/cache\/finance-export\/nohmi-transactions-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  expect(written?.content).toContain('"Second"');
  expect(h.share).toHaveBeenCalledWith({ url: written?.uri });
  expect(h.files.existing.size).toBe(0);
  expectNoInlineResult();
});

it("says so when an export is cancelled, empty, cut short or fails", async () => {
  h.share.mockResolvedValueOnce({ action: "dismissedAction" });
  const one = mountExport(async () => ({ items: [row()], nextCursor: null }) as never);
  press("Export transactions as CSV");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Export cancelled. Nothing was saved.", { id: "feedback" }),
  );
  expect(h.files.existing.size).toBe(0);
  one.unmount();
  const empty = mountExport(async () => ({ items: [], nextCursor: null }) as never);
  press("Export transactions as CSV");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("No transactions to export in this view.", {
      id: "feedback",
    }),
  );
  expect(h.share).toHaveBeenCalledTimes(1);
  empty.unmount();
  const many = mountExport(
    async () => ({ items: Array(2500).fill(row()), nextCursor: "more" }) as never,
  );
  press("Export transactions as CSV");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Exported the first 5,000 transactions of this view. Narrow the view to export the rest.",
      { id: "feedback" },
    ),
  );
  many.unmount();
  mountExport(async () => {
    throw new Error("offline");
  });
  press("Export transactions as CSV");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t export these transactions. Nothing was saved.", {
      id: "feedback",
    }),
  );
  expect(h.success).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("offers export only where a file can be shared, and not while the list is busy", async () => {
  const view = mountExport(async () => ({ items: [], nextCursor: null }) as never, true);
  expect(button("Export transactions as CSV")).toHaveProperty("disabled", true);
  view.unmount();
  h.platform = "web";
  mountExport(async () => ({ items: [], nextCursor: null }) as never);
  expect(screen.queryByRole("button", { name: "Export transactions as CSV" })).toBeNull();
});

it("does not share the previous account's transactions after an account change", async () => {
  let release!: (value: never) => void;
  const page = () => new Promise<never>((resolve) => (release = resolve));
  const view = mountExport(page);
  press("Export transactions as CSV");
  h.owner = "owner-b";
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ExportTransactions view="v1" page={page} disabled={false} />
    </QueryClientProvider>,
  );
  await act(async () => release({ items: [row()], nextCursor: null } as never));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
  expect(h.share).not.toHaveBeenCalled();
  expect(h.files.written).toEqual([]);
});

it("tells the person why the server refused a file the preview accepted", async () => {
  await openImport(valid);
  await choose();
  await screen.findByText("venmo.csv");
  h.api.importFinanceTransactions.mockRejectedValueOnce(
    new ApiClientError({
      code: "invalid_request",
      message: "Choose a venmo account before importing that export.",
      status: 400,
    }),
  );
  fireEvent.click(button("Import"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t import this file. Nothing was imported. Choose a venmo account before importing that export.",
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("exports the list's own view: its account, dates and filters, page after page", async () => {
  h.api.listFinanceTransactions.mockImplementation(async (query: { cursor?: string }) =>
    query.cursor
      ? { items: [row({ id: "b", merchant: "Second" })], nextCursor: null }
      : { items: [row({ id: "a" })], nextCursor: query.cursor === undefined ? "next" : null },
  );
  mount(<Transactions accountId="acct-v" from="2026-11-01" through="2026-11-30" />);
  await screen.findByText("Corner Shop");
  h.api.listFinanceTransactions.mockClear();
  press("Export transactions as CSV");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Exported 2 transactions", { id: "feedback" }),
  );
  expect(h.api.listFinanceTransactions.mock.calls.map((call) => call[0])).toEqual([
    expect.objectContaining({
      accountId: "acct-v",
      from: "2026-11-01",
      to: "2026-11-30",
      cursor: undefined,
      limit: 100,
    }),
    expect.objectContaining({ accountId: "acct-v", from: "2026-11-01", cursor: "next" }),
  ]);
});

it("offers no export on a spending category's drill-down list", async () => {
  h.api.listFinanceSpendingTransactions.mockResolvedValue({ items: [row()], nextCursor: null });
  mount(<Transactions reference={{ groupId: "g" } as never} />);
  await screen.findByText("Corner Shop");
  expect(screen.queryByRole("button", { name: "Export transactions as CSV" })).toBeNull();
});

it("opens the share sheet only once the file is written, and cleans up when writing fails", async () => {
  let finish!: () => void;
  h.files.writing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const sharing = shareCsv("out.csv", "a,b");
  await act(async () => {});
  expect(h.share).not.toHaveBeenCalled();
  finish();
  expect(await sharing).toBe("shared");
  expect(h.files.written).toHaveLength(1);
  h.files.writing = Promise.reject(new Error("disk full"));
  await expect(shareCsv("out.csv", "a,b")).rejects.toThrow("disk full");
  expect(h.share).toHaveBeenCalledTimes(1);
  expect(h.files.existing.size).toBe(0);
});

it("stops an export when the view changes while it is being read", async () => {
  let release!: (value: never) => void;
  const page = () => new Promise<never>((resolve) => (release = resolve));
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ExportTransactions view="november" page={page} disabled={false} />
    </QueryClientProvider>,
  );
  press("Export transactions as CSV");
  view.rerender(
    <QueryClientProvider client={client}>
      <ExportTransactions view="november, pending" page={page} disabled={false} />
    </QueryClientProvider>,
  );
  await act(async () => release({ items: [row()], nextCursor: null } as never));
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "The view changed, so nothing was exported. Export again.",
      { id: "feedback" },
    ),
  );
  expect(h.share).not.toHaveBeenCalled();
  expect(h.files.written).toEqual([]);
  expectNoInlineResult();
});

it("offers a retry when the accounts cannot be read at all", async () => {
  h.api.listFinanceAccounts.mockRejectedValue(new Error("offline"));
  h.params = { accountId: "acct-v" };
  mount(<FinanceTransactionImport />);
  const retry = await screen.findByRole("button", { name: /Retry/ });
  expect(screen.queryByRole("progressbar")).toBeNull();
  h.api.listFinanceAccounts.mockResolvedValue({ accounts: [venmo] });
  await act(async () => {
    fireEvent.click(retry);
  });
  expect(await screen.findByText("Import transactions")).toBeTruthy();
});
