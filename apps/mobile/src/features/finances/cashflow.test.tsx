// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceCashflow, FinanceCashflowRoute } from "./cashflow";
import {
  activeMatches,
  costStatement,
  eligibleTransactions,
  latestSchedule,
  newScenarioDraft,
  parseCents,
  recurringAmount,
  scenarioInput,
  scheduleState,
  scheduleStatement,
  shiftDate,
} from "./cashflow-rules";
import { localToday } from "./mutations";

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
  api: {
    listFinanceRecurringOccurrences: vi.fn(),
    listFinanceRecurringObligations: vi.fn(),
    listFinanceRecurringItems: vi.fn(),
    listFinanceRecurringSchedules: vi.fn(),
    listFinanceAccounts: vi.fn(),
    listFinanceCashflowSources: vi.fn(),
    getFinanceCategories: vi.fn(),
    manageFinanceRecurringItem: vi.fn(),
    confirmFinanceRecurringSchedule: vi.fn(),
    manageFinanceOccurrenceMatch: vi.fn(),
    compareFinanceScenarios: vi.fn(),
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

const today = localToday("America/New_York");
const account = { id: "acct-1", name: "Checking", currencyCode: "USD" };
const payroll = {
  id: "inc-1",
  displayName: "Acme payroll",
  payer: "Acme",
  cadence: "biweekly",
  expectedAmount: 2500,
  accountId: "acct-1",
  status: "needs_review",
  nextExpectedDate: shiftDate(today, 5),
  lastObservedDate: shiftDate(today, -9),
  source: "inferred",
  confidence: 0.9,
  revision: 4,
};
const rent = {
  id: "ob-1",
  kind: "bill",
  displayName: "Rent",
  merchant: "Landlord LLC",
  cadence: "monthly",
  expectedAmount: 1800,
  accountId: "acct-1",
  status: "active",
  nextExpectedDate: shiftDate(today, 12),
  lastObservedDate: null,
  source: "user",
  confidence: 1,
  revision: 2,
  planningEvidence: null,
};
const streaming = {
  ...rent,
  id: "ob-2",
  kind: "subscription",
  displayName: "Streaming",
  expectedAmount: 15.99,
  status: "paused",
  nextExpectedDate: null,
};
const vault = { ...rent, id: "ob-3", kind: "savings", displayName: "Vault", accountId: null };
const rentSchedule = {
  id: "sched-1",
  source: { kind: "obligation", id: "ob-1" },
  sourceRevision: 2,
  supersedesId: null,
  accountId: "acct-1",
  cadence: "monthly",
  timezone: "America/New_York",
  anchorLocalDate: "2026-01-01",
  effectiveFrom: "2026-01-01",
  semimonthlyDays: null,
  amountBasis: "fixed",
  amountCents: 180_000,
  currencyCode: "USD",
  actorUserId: "owner-a",
  recordedAt: "2026-01-01T12:00:00Z",
};
const rentDue = {
  key: "occ-1",
  occurrenceId: "o-1",
  scheduleVersionId: "sched-1",
  source: { kind: "obligation", id: "ob-1" },
  sourceRevision: 2,
  accountId: "acct-1",
  displayName: "Rent",
  localDate: shiftDate(today, -3),
  slot: 0,
  expectedAmountCents: 180_000,
  currencyCode: "USD",
  amountBasis: "fixed",
  certainty: "expected",
  inCurrentSchedule: true,
  matchState: "partially_matched",
  matchedAmountCents: 50_000,
  remainingExpectedCents: 130_000,
  matchIds: ["m-1"],
};
const payday = {
  ...rentDue,
  key: "occ-2",
  occurrenceId: null,
  source: { kind: "income", id: "inc-1" },
  displayName: "Acme payroll",
  expectedAmountCents: 250_000,
  matchState: "expected",
  matchedAmountCents: 0,
  remainingExpectedCents: 250_000,
  matchIds: [],
};
const partMatch = {
  id: "m-1",
  occurrenceId: "o-1",
  kind: "match",
  allocationId: "al-0",
  incomeTransactionId: null,
  amountCents: 50_000,
  currencyCode: "USD",
  allocationRevision: 1,
  transactionRevision: "5",
  reimbursementRelationshipRevision: "1",
  reversesMatchId: null,
  actorUserId: "owner-a",
  recordedAt: "2026-11-10T12:00:00Z",
  rationale: "Part paid early",
};
const allocation = (id: string, amountCents: number, eligible = true) => ({
  id,
  revision: 3,
  amountCents,
  treatment: "personal",
  expenseEligibility: { eligible, reasons: [] },
});
const landlord = {
  id: "tx-1",
  accountId: "acct-1",
  merchant: "Landlord LLC",
  date: shiftDate(today, -3),
  amountCents: 130_000,
  currencyCode: "USD",
  direction: "expense",
  pending: false,
  transactionRevision: "7",
  reimbursementRelationshipRevision: "1",
  incomeEligibility: { eligible: false, reasons: ["not_income"] },
  allocations: [allocation("al-1", 130_000)],
};
const deposit = {
  ...landlord,
  id: "tx-2",
  merchant: "ACME PAYROLL",
  amountCents: 250_000,
  direction: "income",
  incomeEligibility: { eligible: true, reasons: [] },
  allocations: [],
};
const range = { from: shiftDate(today, -30), to: today };
const routeRange = { key: "occ-1", ...range };

const completed = <T,>(data: T) => ({
  outcome: "completed",
  data,
  communication: { headline: "" },
});
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function open(view: string, params: Record<string, string> = {}) {
  h.params = { view, ...params };
  return mount(<FinanceCashflowRoute />);
}
/** Presses a button of the most recent native confirmation. */
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}
const items = (income: unknown[] = [payroll], obligations: unknown[] = [rent, streaming, vault]) =>
  completed({ income, obligations });

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = {};
  h.platform = "ios";
  h.api.listFinanceRecurringItems.mockResolvedValue(items());
  h.api.listFinanceRecurringSchedules.mockResolvedValue([rentSchedule]);
  h.api.listFinanceAccounts.mockResolvedValue({ accounts: [account] });
  h.api.listFinanceRecurringObligations.mockResolvedValue([rent]);
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    ...range,
    occurrences: [rentDue, payday],
    matchEvents: [partMatch],
    unavailableSources: [],
  });
  h.api.listFinanceCashflowSources.mockResolvedValue({
    accounts: [],
    income: [],
    obligations: [],
    transactions: [landlord, deposit],
    coverage: { truncated: false, transactionLimit: 1000 },
  });
  h.api.getFinanceCategories.mockResolvedValue([{ id: "cat-1", name: "Groceries" }]);
});
afterEach(cleanup);

// ── Pure rules ───────────────────────────────────────────────────────────────

it("reads exact cents and refuses anything the record cannot hold", () => {
  expect(parseCents("1250")).toBe(125_000);
  expect(parseCents(" 12.5 ")).toBe(1250);
  expect(parseCents("0.07")).toBe(7);
  expect(parseCents("100000000")).toBe(10_000_000_000);
  expect(parseCents("100000000.01")).toBeUndefined();
  expect(parseCents("1,250")).toBeUndefined();
  expect(parseCents("12.345")).toBeUndefined();
  expect(parseCents("-5")).toBeUndefined();
});

it("takes the schedule no later statement replaces, and ties it to one source revision", () => {
  const later = { ...rentSchedule, id: "sched-2", supersedesId: "sched-1", sourceRevision: 3 };
  const other = { ...rentSchedule, id: "sched-9", source: { kind: "income", id: "ob-1" } };
  const source = { kind: "obligation" as const, id: "ob-1" };
  expect(latestSchedule([rentSchedule, later, other] as never, source)?.id).toBe("sched-2");
  expect(latestSchedule(undefined, source)).toBeNull();
  expect(scheduleState(rentSchedule as never, rent)).toBe("confirmed");
  expect(scheduleState(later as never, rent)).toBe("changed");
  expect(scheduleState(null, rent)).toBe("none");
});

it("checks a schedule statement the way the server will", () => {
  const context = {
    source: { kind: "obligation" as const, id: "ob-1" },
    expectedSourceRevision: 2,
    supersedes: null,
    accountId: "acct-1",
    accountCurrency: "USD",
  };
  const draft = {
    cadence: "monthly",
    timezone: "America/New_York",
    anchorLocalDate: "2026-01-15",
    effectiveFrom: "2026-02-01",
    day1: "",
    day2: "",
    amountBasis: "fixed",
    amount: "1800",
    currencyCode: "USD",
  };
  expect(scheduleStatement(draft, context).statement).toEqual({
    source: context.source,
    expectedSourceRevision: 2,
    supersedesId: null,
    accountId: "acct-1",
    cadence: "monthly",
    timezone: "America/New_York",
    anchorLocalDate: "2026-01-15",
    effectiveFrom: "2026-02-01",
    semimonthlyDays: null,
    amountBasis: "fixed",
    amountCents: 180_000,
    currencyCode: "USD",
  });
  const empty = scheduleStatement(
    {
      ...draft,
      cadence: "",
      timezone: "Mars/Olympus",
      anchorLocalDate: null,
      effectiveFrom: "2026-02-30",
      amountBasis: "",
      amount: "12.345",
      currencyCode: "usd",
    },
    context,
  );
  expect(empty.statement).toBeNull();
  expect(Object.keys(empty.errors).sort()).toEqual([
    "amount",
    "amountBasis",
    "anchorLocalDate",
    "cadence",
    "currencyCode",
    "effectiveFrom",
    "timezone",
  ]);
  expect(scheduleStatement({ ...draft, amount: "" }, context).errors.amount).toMatch(/fixed/);
  expect(
    scheduleStatement({ ...draft, amountBasis: "variable", amount: "" }, context).statement,
  ).toMatchObject({ amountBasis: "variable", amountCents: null });
  expect(scheduleStatement({ ...draft, currencyCode: "EUR" }, context).errors.currencyCode).toBe(
    "This account is held in USD.",
  );
  const twice = { ...draft, cadence: "semimonthly", day1: "15", day2: "15" };
  expect(scheduleStatement(twice, context).errors.days).toBeTruthy();
  expect(scheduleStatement({ ...twice, day2: "32" }, context).errors.days).toBeTruthy();
  expect(scheduleStatement({ ...twice, day2: "30" }, context).statement?.semimonthlyDays).toEqual([
    15, 30,
  ]);
  const revised = scheduleStatement(draft, {
    ...context,
    supersedes: { ...rentSchedule, effectiveFrom: "2026-02-01" } as never,
  });
  expect(revised.errors.effectiveFrom).toMatch(/after/);
  expect(
    scheduleStatement(
      { ...draft, effectiveFrom: "2026-02-02" },
      { ...context, supersedes: { ...rentSchedule, effectiveFrom: "2026-02-01" } as never },
    ).statement?.supersedesId,
  ).toBe("sched-1");
});

it("offers only posted transactions the server accepts for an occurrence", () => {
  const candidates = [
    landlord,
    { ...landlord, id: "pending", pending: true },
    { ...landlord, id: "other-account", accountId: "acct-2" },
    { ...landlord, id: "other-currency", currencyCode: "EUR" },
    { ...landlord, id: "ineligible", allocations: [allocation("al-x", 100, false)] },
    { ...landlord, id: "older", date: shiftDate(today, -9) },
    deposit,
  ] as never;
  expect(eligibleTransactions(rentDue as never, candidates).map((item) => item.id)).toEqual([
    "tx-1",
    "older",
  ]);
  expect(eligibleTransactions(payday as never, candidates).map((item) => item.id)).toEqual([
    "tx-2",
  ]);
});

it("keeps a match reversible until it is reversed, even once it no longer counts", () => {
  const reversal = { ...partMatch, id: "r-1", kind: "reverse", reversesMatchId: "m-1" };
  expect(activeMatches(rentDue as never, [partMatch] as never)).toHaveLength(1);
  expect(activeMatches(rentDue as never, [partMatch, reversal] as never)).toHaveLength(0);
  expect(activeMatches({ ...rentDue, matchIds: [] } as never, [partMatch] as never)).toHaveLength(
    1,
  );
  expect(activeMatches(payday as never, [partMatch] as never)).toHaveLength(0);
});

it("applies a cost statement only to the revision it describes", () => {
  const evidence = {
    sourceId: "ob-1",
    sourceRevision: 2,
    expectedAmountCents: 180_000,
    cadence: "monthly",
    accountId: "acct-1",
    fixedness: "fixed",
  };
  expect(costStatement({ ...rent, planningEvidence: evidence } as never)).toBe(evidence);
  expect(costStatement(rent as never)).toBeNull();
  for (const change of [
    { sourceRevision: 1 },
    { expectedAmountCents: 1 },
    { cadence: "weekly" },
    { accountId: null },
    { sourceId: "ob-9" },
  ])
    expect(
      costStatement({ ...rent, planningEvidence: { ...evidence, ...change } } as never),
    ).toBeNull();
});

it("names the first problem with a scenario, or builds the comparison input", () => {
  const fill = (id: string, label: string) => ({
    ...newScenarioDraft(id, label),
    noOtherSpending: true,
    money: {
      ...newScenarioDraft(id, label).money,
      startingCash: "-200",
      monthlyIncome: "5000",
      monthlyHousingCost: "1800",
      monthlyDebtPayment: "0",
      monthlyReserveContribution: "250.50",
    },
  });
  const base = fill("a", "Now");
  const other = { ...fill("b", "Move"), assumptions: "Rent rises\n\n New lease " };
  const problem = (drafts: unknown[], asOf: string | null = "2026-11-01", horizon = "12") =>
    (scenarioInput(drafts as never, asOf, horizon) as { problem?: string }).problem;
  expect(problem([base, other], null)).toBe("Enter the as-of date.");
  expect(problem([base, other], "2026-11-01", "0")).toMatch(/1 to 120/);
  expect(problem([base, other], "2026-11-01", "121")).toMatch(/1 to 120/);
  expect(problem([base])).toBe("Add an alternative to compare.");
  expect(problem([base, { ...other, label: "Now" }])).toBe("Give each scenario a different name.");
  expect(problem([base, { ...other, label: " " }])).toBe("Give each scenario a name.");
  expect(problem([base, { ...other, money: { ...other.money, monthlyIncome: "" } }])).toMatch(
    /Move: enter monthly income/,
  );
  expect(problem([base, { ...other, money: { ...other.money, debtBalance: "x" } }])).toMatch(
    /debt balance/,
  );
  expect(problem([base, { ...other, money: { ...other.money, monthlyIncome: "-5" } }])).toMatch(
    /monthly income/,
  );
  expect(problem([base, { ...other, noOtherSpending: false }])).toMatch(/other monthly spending/);
  const row = (categoryId: string, limit: string) => ({
    id: categoryId + limit,
    categoryId,
    limit,
  });
  expect(problem([base, { ...other, allocations: [row("", "5")] }])).toMatch(/category/);
  expect(problem([base, { ...other, allocations: [row("c", "")] }])).toMatch(/amount/);
  expect(problem([base, { ...other, allocations: [row("c", "0")] }])).toMatch(/above 0/);
  expect(problem([base, { ...other, allocations: [row("c", "5"), row("c", "6")] }])).toMatch(
    /only once/,
  );
  expect(problem([base, { ...other, assumptions: "x".repeat(501) }])).toMatch(/25 assumptions/);
  expect(
    scenarioInput(
      [base, { ...other, noOtherSpending: false, allocations: [row("cat-1", "400")] }] as never,
      "2026-11-01",
      "24",
    ),
  ).toEqual({
    input: {
      asOf: "2026-11-01",
      horizonMonths: 24,
      baseline: {
        label: "Now",
        startingCash: -200,
        monthlyIncome: 5000,
        monthlyHousingCost: 1800,
        monthlyDebtPayment: 0,
        monthlyReserveContribution: 250.5,
        budgetAllocations: [],
        assumptions: ["Now: No category spending beyond housing and debt payments."],
      },
      alternatives: [
        {
          label: "Move",
          startingCash: -200,
          monthlyIncome: 5000,
          monthlyHousingCost: 1800,
          monthlyDebtPayment: 0,
          monthlyReserveContribution: 250.5,
          budgetAllocations: [{ categoryId: "cat-1", limit: 400 }],
          assumptions: ["Rent rises", "New lease"],
        },
      ],
    },
  });
});

// ── Plan › Cash flow and its views ───────────────────────────────────────────

it("keeps the outlook a schedule, opens an expected item and offers every view", async () => {
  const soon = { ...rentDue, key: "occ-9", localDate: shiftDate(today, 4) };
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [soon, { ...soon, key: "done", matchState: "matched" }],
    matchEvents: [],
    unavailableSources: [
      { source: { kind: "income", id: "inc-1" }, reason: "unconfirmed_schedule" },
    ],
  });
  mount(<FinanceCashflow />);
  expect(
    await screen.findByText(/This is an upcoming schedule, not a projected\s+account balance\./),
  ).toBeTruthy();
  press(/^Rent/);
  const upcoming = { from: today, to: shiftDate(today, 30) };
  expect(h.api.listFinanceRecurringOccurrences).toHaveBeenCalledWith(upcoming);
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "occurrence", key: "occ-9", ...upcoming },
  });
  expect(screen.getAllByRole("button", { name: /^Rent/ })).toHaveLength(1);
  expect(screen.getByText(/1 sources need schedule confirmation/)).toBeTruthy();
  for (const [name, view] of [
    ["Income", "income"],
    ["Bills & subscriptions", "bills"],
    ["Recent expected items", "recent"],
    ["Scenarios", "scenarios"],
  ] as const) {
    press(name);
    expect(h.push).toHaveBeenLastCalledWith({ pathname: "/finance-cashflow", params: { view } });
  }
  // The Plan tab reads nothing the other views need until they are opened.
  expect(h.api.listFinanceRecurringItems).not.toHaveBeenCalled();
});

it("lists income streams with their status and opens one", async () => {
  open("income");
  expect(h.screen).toHaveBeenCalledWith({ title: "income" });
  press(await screen.findByRole("button", { name: /Acme payroll/ }).then(() => /Acme payroll/));
  const row = button(/Acme payroll/);
  expect(row.textContent).toContain("Needs confirmation · Every two weeks · Next ");
  await waitFor(() => expect(row.textContent).toContain("$2,500.00"));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "item", kind: "income", id: "inc-1" },
  });
});

it("says so when there is no income or no bill pattern yet", async () => {
  h.api.listFinanceRecurringItems.mockResolvedValue(items([], []));
  const view = open("income");
  expect(await screen.findByText("No income patterns yet")).toBeTruthy();
  view.unmount();
  open("bills");
  expect(await screen.findByText("No bills or subscriptions yet")).toBeTruthy();
});

it("groups bills, subscriptions and savings and states what a change does not do", async () => {
  open("bills");
  expect(await screen.findByRole("button", { name: /Rent/ })).toBeTruthy();
  expect(screen.getByText("Bills")).toBeTruthy();
  expect(screen.getByText("Subscriptions")).toBeTruthy();
  expect(screen.getByText("Savings")).toBeTruthy();
  expect(button(/Streaming/).textContent).toContain("Paused · Monthly · Date not established");
  expect(screen.getByText(/does not cancel a subscription/)).toBeTruthy();
  press(/Streaming/);
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "item", kind: "obligation", id: "ob-2" },
  });
});

it("lists the last 30 days of expected items and opens one for matching", async () => {
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [rentDue, { ...payday, inCurrentSchedule: false, expectedAmountCents: null }],
    matchEvents: [],
    unavailableSources: [{ source: { kind: "income", id: "x" }, reason: "source_changed" }],
  });
  open("recent");
  const row = await screen.findByRole("button", { name: /Rent/ });
  expect(h.api.listFinanceRecurringOccurrences).toHaveBeenCalledWith(range);
  expect(row.textContent).toContain("Partly matched");
  expect(row.textContent).toContain("$1,800.00");
  expect(button(/Acme payroll/).textContent).toContain("Expected · Earlier schedule");
  expect(button(/Acme payroll/).textContent).toContain("Unavailable");
  expect(screen.getByText(/1 sources need schedule confirmation/)).toBeTruthy();
  fireEvent.click(row);
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "occurrence", ...routeRange },
  });
});

it("needs the account timezone before listing dated items", async () => {
  h.timezone = undefined;
  open("recent");
  expect(await screen.findByText(/Set your account timezone in Settings/)).toBeTruthy();
  expect(h.api.listFinanceRecurringOccurrences).not.toHaveBeenCalled();
});

it("shows an empty recent list and an unknown view as unavailable", async () => {
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    matchEvents: [],
    unavailableSources: [],
  });
  const view = open("recent");
  expect(await screen.findByText("No expected items in the last 30 days.")).toBeTruthy();
  view.unmount();
  open("nope");
  expect(screen.getByText("This page is unavailable.")).toBeTruthy();
  expect(h.screen).toHaveBeenLastCalledWith({ title: "cash flow" });
});

// ── Recurring item ───────────────────────────────────────────────────────────

it("shows an income stream's status and only the actions income can take", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  open("item", { kind: "income", id: "inc-1" });
  expect(await screen.findByText("Schedule not confirmed")).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "income" });
  expect(screen.getByText("Needs confirmation")).toBeTruthy();
  expect(screen.getByText("$2,500.00")).toBeTruthy();
  expect(screen.getByText("Account activity")).toBeTruthy();
  expect(screen.getByText("Checking")).toBeTruthy();
  expect(screen.queryByText("Cost not confirmed")).toBeNull();
  expect(button("Confirm schedule")).toBeTruthy();
  expect(button("Confirm pattern")).toBeTruthy();
  for (const absent of ["Mark cancelled", "Confirm cost", "Pause", "Resume"])
    expect(screen.queryByRole("button", { name: absent })).toBeNull();
  press("Confirm schedule");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "schedule", kind: "income", id: "inc-1" },
  });
});

it("confirms an income pattern and reports it only after the item is re-read", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  const answer = deferred<unknown>();
  h.api.manageFinanceRecurringItem.mockReturnValue(answer.promise);
  open("item", { kind: "income", id: "inc-1" });
  await screen.findByText("Schedule not confirmed");
  press("Confirm pattern");
  expect(h.loading).toHaveBeenCalledWith("Confirming…");
  await waitFor(() => expect(button("Confirm pattern")).toHaveProperty("disabled", true));
  expect(h.api.manageFinanceRecurringItem).toHaveBeenCalledWith({
    operation: "resume",
    itemId: "inc-1",
    itemType: "income",
    idempotencyKey: expect.any(String),
  });
  h.api.listFinanceRecurringItems.mockResolvedValue(items([{ ...payroll, status: "active" }]));
  expect(h.success).not.toHaveBeenCalled();
  await act(async () => answer.resolve(completed({ ...payroll, status: "active" })));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring item confirmed", { id: "feedback" }),
  );
  expect(await screen.findByRole("button", { name: "Pause" })).toHaveProperty("disabled", false);
  expect(screen.getByText("Active")).toBeTruthy();
  expectNoInlineResult();
});

it("shows a bill's confirmed schedule and cost statement", async () => {
  const stated = {
    ...rent,
    planningEvidence: {
      sourceId: "ob-1",
      sourceRevision: 2,
      expectedAmountCents: 180_000,
      cadence: "monthly",
      accountId: "acct-1",
      fixedness: "fixed",
      provenance: "agent_self_approval",
      asOf: "2026-10-01",
    },
  };
  h.api.listFinanceRecurringItems.mockResolvedValue(items([], [stated]));
  open("item", { kind: "obligation", id: "ob-1" });
  expect(await screen.findByText("Schedule confirmed")).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "recurring item" });
  expect(screen.getByText(/Monthly from Jan 1, 2026 · Fixed, \$1,800\.00/)).toBeTruthy();
  expect(screen.getByText("Fixed cost")).toBeTruthy();
  expect(screen.getByText("Recorded by your agent as of Oct 1, 2026.")).toBeTruthy();
  expect(screen.getByText("Bill")).toBeTruthy();
  expect(screen.getByText("You")).toBeTruthy();
  press("Revise schedule");
  press("Edit cost statement");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "cost", id: "ob-1" },
  });
});

it("says when a schedule no longer applies, and keeps cost off savings and closed items", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([{ ...rentSchedule, sourceRevision: 1 }]);
  const view = open("item", { kind: "obligation", id: "ob-1" });
  expect(await screen.findByText("Schedule needs confirming again")).toBeTruthy();
  expect(screen.getByText("Cost not confirmed")).toBeTruthy();
  expect(button("Confirm cost")).toBeTruthy();
  view.unmount();
  const savings = open("item", { kind: "obligation", id: "ob-3" });
  expect(await screen.findByText("Schedule not confirmed")).toBeTruthy();
  expect(screen.getByText("None established")).toBeTruthy();
  expect(screen.getByText("Savings")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm cost" })).toBeNull();
  expect(screen.queryByText("Cost not confirmed")).toBeNull();
  savings.unmount();
  open("item", { kind: "obligation", id: "ob-2" });
  expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
  for (const absent of ["Confirm schedule", "Revise schedule", "Confirm cost", "Pause"])
    expect(screen.queryByRole("button", { name: absent })).toBeNull();
  expect(button("Mark cancelled")).toBeTruthy();
});

it("reports a missing recurring item as unavailable", async () => {
  const view = open("item", { kind: "obligation", id: "gone" });
  expect(await screen.findByText("This recurring item is unavailable.")).toBeTruthy();
  view.unmount();
  open("item", { kind: "other", id: "ob-1" });
  expect(await screen.findByText("This recurring item is unavailable.")).toBeTruthy();
});

it("pauses and resumes, saying exactly what a refusal or a lost answer means", async () => {
  open("item", { kind: "obligation", id: "ob-1" });
  await screen.findByText("Schedule confirmed");
  h.api.manageFinanceRecurringItem.mockRejectedValueOnce(rejection(400));
  press("Pause");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t pause this item. Nothing was changed.", {
      id: "feedback",
    }),
  );
  h.api.manageFinanceRecurringItem.mockRejectedValueOnce(rejection(409));
  press("Pause");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This item changed elsewhere. Review the latest version before trying again.",
      { id: "feedback" },
    ),
  );
  h.api.manageFinanceRecurringItem.mockRejectedValueOnce(new Error("offline"));
  press("Pause");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the item was changed. Check its status before trying again.",
      { id: "feedback" },
    ),
  );
  h.api.manageFinanceRecurringItem.mockResolvedValueOnce(completed({ ...rent, status: "paused" }));
  press("Pause");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring item paused", { id: "feedback" }),
  );
  const keys = h.api.manageFinanceRecurringItem.mock.calls.map((call) => call[0].idempotencyKey);
  // A refused write gets a new key; an unanswered one is retried under its own.
  expect(keys[1]).not.toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  expect(keys[3]).toBe(keys[2]);
  expect(h.success).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("resumes a paused item and relays an answer that was not applied", async () => {
  open("item", { kind: "obligation", id: "ob-2" });
  await screen.findByRole("button", { name: "Resume" });
  h.api.manageFinanceRecurringItem.mockResolvedValueOnce({
    outcome: "user_input_required",
    data: streaming,
    communication: { headline: "Review this item first." },
  });
  press("Resume");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Review this item first.", { id: "feedback" }),
  );
  h.api.manageFinanceRecurringItem.mockResolvedValueOnce({
    outcome: "failed",
    data: streaming,
    communication: { headline: "Could not resume." },
  });
  press("Resume");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Could not resume.", { id: "feedback" }),
  );
  h.api.manageFinanceRecurringItem.mockResolvedValueOnce(completed(streaming));
  press("Resume");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring item resumed", { id: "feedback" }),
  );
  expect(h.api.manageFinanceRecurringItem).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: "resume", itemType: "obligation", itemId: "ob-2" }),
  );
  expectNoInlineResult();
});

it("marks a bill cancelled only after a destructive confirmation", async () => {
  h.api.manageFinanceRecurringItem.mockResolvedValue(completed({ ...rent, status: "cancelled" }));
  open("item", { kind: "obligation", id: "ob-1" });
  await screen.findByText("Schedule confirmed");
  press("Mark cancelled");
  expect(h.alert).toHaveBeenCalledWith(
    "Mark Rent cancelled?",
    expect.stringContaining("does not cancel anything with the provider"),
    [
      { text: "Keep", style: "cancel" },
      expect.objectContaining({ text: "Mark cancelled", style: "destructive" }),
    ],
  );
  confirm("Keep");
  expect(h.api.manageFinanceRecurringItem).not.toHaveBeenCalled();
  press("Mark cancelled");
  confirm("Mark cancelled");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring item marked cancelled", { id: "feedback" }),
  );
  expect(h.api.manageFinanceRecurringItem).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "cancel", itemType: "obligation", itemId: "ob-1" }),
  );
  expectNoInlineResult();
});

it("drops the result of a change when the account changes meanwhile", async () => {
  const answer = deferred<unknown>();
  h.api.manageFinanceRecurringItem.mockReturnValue(answer.promise);
  const view = open("item", { kind: "obligation", id: "ob-1" });
  await screen.findByText("Schedule confirmed");
  press("Pause");
  h.owner = "owner-b";
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <FinanceCashflowRoute />
    </QueryClientProvider>,
  );
  await act(async () => answer.resolve(completed(rent)));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
  expect(h.success).not.toHaveBeenCalled();
});

// ── Confirming a schedule ────────────────────────────────────────────────────

const save = (name = "Save changes") => screen.getByRole("button", { name });
function fillSchedule() {
  press("Every two weeks");
  type("First date (ISO date/time)", "2026-01-09");
  type("Effective from (ISO date/time)", "2026-01-09");
  press("Variable");
}

it("confirms a schedule for the item's own account and revision", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  h.api.confirmFinanceRecurringSchedule.mockResolvedValue(completed({}));
  open("schedule", { kind: "income", id: "inc-1" });
  expect(await screen.findByText("Confirm schedule")).toBeTruthy();
  expect(h.screen.mock.lastCall?.[0]).toMatchObject({ title: "", headerBackVisible: false });
  // Nothing about the schedule is taken from the detected pattern.
  expect(button("Repeats, Required")).toBeTruthy();
  expect(screen.getByLabelText("Timezone")).toHaveProperty("value", "America/New_York");
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "USD");
  expect(screen.getByLabelText("First date (ISO date/time)")).toHaveProperty("value", "");
  expect(save()).toHaveProperty("disabled", true);
  fillSchedule();
  expect(save()).toHaveProperty("disabled", false);
  type("Timezone", "Mars/Olympus");
  expect(screen.getByText("Enter a timezone such as America/New_York.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Timezone", "America/Chicago");
  type("Effective from (ISO date/time)", "2026-02-30");
  expect(screen.getByText(/Enter the effective date as a date/)).toBeTruthy();
  type("Effective from (ISO date/time)", "2026-01-09");
  type("Currency", "eur");
  expect(screen.getByText("This account is held in USD.")).toBeTruthy();
  type("Currency", "usd");
  type("Expected amount", "12.345");
  expect(screen.getByText("Enter an amount such as 1250.00.")).toBeTruthy();
  type("Expected amount", "");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring schedule confirmed", { id: "feedback" }),
  );
  expect(h.api.confirmFinanceRecurringSchedule).toHaveBeenCalledWith({
    source: { kind: "income", id: "inc-1" },
    expectedSourceRevision: 4,
    supersedesId: null,
    accountId: "acct-1",
    cadence: "biweekly",
    timezone: "America/Chicago",
    anchorLocalDate: "2026-01-09",
    effectiveFrom: "2026-01-09",
    semimonthlyDays: null,
    amountBasis: "variable",
    amountCents: null,
    currencyCode: "USD",
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("revises a schedule from the previous statement and needs a later effective date", async () => {
  h.api.confirmFinanceRecurringSchedule.mockResolvedValue(completed({}));
  open("schedule", { kind: "obligation", id: "ob-1" });
  expect(await screen.findByText("Revise schedule")).toBeTruthy();
  expect(button("Repeats, Monthly")).toBeTruthy();
  expect(screen.getByLabelText("Expected amount")).toHaveProperty("value", "1800.00");
  expect(screen.getByLabelText("First date (ISO date/time)")).toHaveProperty("value", "2026-01-01");
  expect(screen.getByText(/replaces the schedule in effect since Jan 1, 2026/)).toBeTruthy();
  type("Effective from (ISO date/time)", "2026-01-01");
  expect(screen.getByText(/Choose a date after Jan 1, 2026/)).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Effective from (ISO date/time)", "2026-12-01");
  press("Twice a month");
  type("First day of month", "1");
  type("Second day of month", "1");
  expect(screen.getByText(/two different days of the month/)).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Second day of month", "15");
  type("Expected amount", "");
  expect(screen.getByText("A fixed schedule needs its amount.")).toBeTruthy();
  type("Expected amount", "1850");
  fireEvent.click(save());
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.api.confirmFinanceRecurringSchedule).toHaveBeenCalledWith(
    expect.objectContaining({
      supersedesId: "sched-1",
      expectedSourceRevision: 2,
      cadence: "semimonthly",
      semimonthlyDays: [1, 15],
      amountBasis: "fixed",
      amountCents: 185_000,
      effectiveFrom: "2026-12-01",
    }),
  );
});

it("keeps the schedule draft open when the save is refused or unanswered", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  open("schedule", { kind: "income", id: "inc-1" });
  await screen.findByText("Confirm schedule");
  fillSchedule();
  h.api.confirmFinanceRecurringSchedule.mockRejectedValueOnce(rejection(409));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("could not be recorded"), {
      id: "feedback",
    }),
  );
  h.api.confirmFinanceRecurringSchedule.mockRejectedValueOnce(rejection(400));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t record this schedule. Check the entries; they are still here.",
      { id: "feedback" },
    ),
  );
  h.api.confirmFinanceRecurringSchedule.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm the schedule"), {
      id: "feedback",
    }),
  );
  h.api.confirmFinanceRecurringSchedule.mockResolvedValueOnce(completed({}));
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
  const keys = h.api.confirmFinanceRecurringSchedule.mock.calls.map(
    (call) => call[0].idempotencyKey,
  );
  expect(keys[3]).toBe(keys[2]);
  expect(keys[2]).not.toBe(keys[1]);
  expect(h.back).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("First date (ISO date/time)")).toHaveProperty("value", "2026-01-09");
  expectNoInlineResult();
});

it("asks before discarding an edited schedule and closes an untouched one at once", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  open("schedule", { kind: "income", id: "inc-1" });
  await screen.findByText("Confirm schedule");
  press("Close");
  expect(h.back).toHaveBeenCalledTimes(1);
  expect(h.alert).not.toHaveBeenCalled();
  press("Weekly");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith("Discard changes?", expect.any(String), expect.any(Array));
  confirm("Discard");
  expect(h.back).toHaveBeenCalledTimes(2);
});

it("offers no schedule form for a paused or missing item", async () => {
  const view = open("schedule", { kind: "obligation", id: "ob-2" });
  expect(await screen.findByText(/A paused or cancelled item cannot take a schedule/)).toBeTruthy();
  view.unmount();
  open("schedule", { kind: "obligation", id: "gone" });
  expect(await screen.findByText("This recurring item is unavailable.")).toBeTruthy();
});

// ── Confirming a cost ────────────────────────────────────────────────────────

it("records a cost statement for the version that is open", async () => {
  h.api.manageFinanceRecurringItem.mockResolvedValue(completed(rent));
  open("cost", { id: "ob-1" });
  expect(await screen.findByText("Confirm cost")).toBeTruthy();
  expect(screen.getByLabelText("As of (ISO date/time)")).toHaveProperty("value", today);
  expect(screen.getByText("$1,800.00")).toBeTruthy();
  press("Fixed");
  expect(save()).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("This is my statement"));
  expect(save()).toHaveProperty("disabled", false);
  type("As of (ISO date/time)", "2999-01-01");
  expect(screen.getByText("The statement date cannot be in the future.")).toBeTruthy();
  type("As of (ISO date/time)", "2026-02-30");
  expect(screen.getByText(/calendar date such as 2026-02-01/)).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("As of (ISO date/time)", "2026-10-01");
  type("Currency", "us");
  expect(screen.getByText("Use a three-letter code such as USD.")).toBeTruthy();
  type("Currency", "eur");
  expect(screen.getByText("This account is held in USD.")).toBeTruthy();
  type("Currency", "usd");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Cost statement saved", { id: "feedback" }),
  );
  expect(h.api.manageFinanceRecurringItem).toHaveBeenCalledWith({
    operation: "confirm_cost",
    itemType: "obligation",
    itemId: "ob-1",
    expectedRevision: 2,
    expectedAmountCents: 180_000,
    cadence: "monthly",
    accountId: "acct-1",
    currencyCode: "USD",
    fixedness: "fixed",
    asOf: "2026-10-01",
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("keeps the cost form open when the item changed elsewhere", async () => {
  h.api.manageFinanceRecurringItem.mockRejectedValue(rejection(409));
  open("cost", { id: "ob-1" });
  await screen.findByText("Confirm cost");
  press("Variable");
  fireEvent.click(screen.getByLabelText("This is my statement"));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"), {
      id: "feedback",
    }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("offers no cost form for savings, a paused item or an inexact amount", async () => {
  const view = open("cost", { id: "ob-3" });
  expect(await screen.findByText("This recurring item is unavailable.")).toBeTruthy();
  view.unmount();
  const paused = open("cost", { id: "ob-2" });
  expect(await screen.findByText("This recurring item is unavailable.")).toBeTruthy();
  paused.unmount();
  h.timezone = undefined;
  h.api.listFinanceRecurringItems.mockResolvedValue(
    items([], [{ ...rent, expectedAmount: 10.005, accountId: null }]),
  );
  open("cost", { id: "ob-1" });
  expect(await screen.findByText(/not exact to the cent/)).toBeTruthy();
  expect(screen.getByText(/Set your account timezone in Settings/)).toBeTruthy();
  press("Fixed");
  type("Currency", "USD");
  fireEvent.click(screen.getByLabelText("This is my statement"));
  expect(save()).toHaveProperty("disabled", true);
});

// ── Expected item and matching ───────────────────────────────────────────────

it("shows what was expected and matched, and opens the match and reverse forms", async () => {
  open("occurrence", routeRange);
  expect(await screen.findByText("Expected payment")).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "expected item" });
  expect(h.api.listFinanceRecurringOccurrences).toHaveBeenCalledWith(range);
  expect(screen.getByText("$1,800.00")).toBeTruthy();
  expect(screen.getByText("$1,300.00")).toBeTruthy();
  expect(screen.getByText(/Partly matched/)).toBeTruthy();
  expect(screen.getByText(/never creates or\s+changes a payment/)).toBeTruthy();
  press("Match a transaction");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "match", ...routeRange },
  });
  const matched = button(/\$500\.00/);
  expect(matched.textContent).toContain("Matched by you · Nov 10, 2026 · Part paid early");
  fireEvent.click(matched);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "match", ...routeRange, match: "m-1" },
  });
  press("Recurring item");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-cashflow",
    params: { view: "item", kind: "obligation", id: "ob-1" },
  });
});

it("keeps reversed matches as history and offers no match outside the current schedule", async () => {
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [{ ...rentDue, inCurrentSchedule: false, matchIds: [], matchState: "expected" }],
    matchEvents: [
      partMatch,
      {
        ...partMatch,
        id: "r-1",
        kind: "reverse",
        reversesMatchId: "m-1",
        approvalActor: { type: "agent", id: "agent-1" },
        rationale: "Wrong transaction",
        recordedAt: "2026-11-11T12:00:00Z",
      },
    ],
    unavailableSources: [],
  });
  open("occurrence", routeRange);
  expect(await screen.findByText(/belongs to an earlier schedule/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Match a transaction" })).toBeNull();
  expect(screen.getByText("History")).toBeTruthy();
  expect(screen.getByText("Match reversed")).toBeTruthy();
  expect(screen.getByText(/By your agent · Nov 11, 2026 · Wrong transaction/)).toBeTruthy();
});

it("reports an expected item it cannot find, or a route without a date range", async () => {
  const view = open("occurrence", { ...routeRange, key: "gone" });
  expect(await screen.findByText("This expected item is unavailable.")).toBeTruthy();
  view.unmount();
  open("occurrence", { key: "occ-1", from: "nope", to: today });
  await waitFor(() => expect(h.api.listFinanceRecurringOccurrences).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Expected payment")).toBeNull();
});

it("says nothing is matched on an income item that has no match yet", async () => {
  open("occurrence", { ...routeRange, key: "occ-2" });
  expect(await screen.findByText("Expected income")).toBeTruthy();
  expect(screen.getByText("Nothing is matched to this expected item.")).toBeTruthy();
  expect(screen.queryByText("History")).toBeNull();
});

it("matches part of a bill to a posted transaction, within what is still expected", async () => {
  h.api.manageFinanceOccurrenceMatch.mockResolvedValue(completed({}));
  h.api.listFinanceCashflowSources.mockResolvedValue({
    transactions: [landlord, { ...landlord, id: "pending", merchant: "Pending Co", pending: true }],
    coverage: { truncated: true, transactionLimit: 1000 },
  });
  open("match", routeRange);
  expect(await screen.findByText("Match a transaction")).toBeTruthy();
  expect(h.api.listFinanceCashflowSources).toHaveBeenCalledWith({
    from: shiftDate(rentDue.localDate, -14),
    to: shiftDate(rentDue.localDate, 14),
  });
  expect(screen.queryByRole("button", { name: /Pending Co/ })).toBeNull();
  expect(screen.getByText(/Only part of this period’s transactions/)).toBeTruthy();
  expect(save("Record match")).toHaveProperty("disabled", true);
  press(/Landlord LLC/);
  type("Amount matched", "1300.01");
  expect(screen.getByText("At most $1,300.00 can be matched here.")).toBeTruthy();
  type("Amount matched", "0");
  expect(screen.getByText("Enter an amount such as 125.00.")).toBeTruthy();
  type("Amount matched", "1000");
  expect(save("Record match")).toHaveProperty("disabled", true);
  type("Reason", " Rent for November ");
  fireEvent.click(save("Record match"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction matched", { id: "feedback" }),
  );
  expect(h.api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith({
    operation: "match_expense",
    occurrence: { scheduleVersionId: "sched-1", localDate: rentDue.localDate, slot: 0 },
    transactionId: "tx-1",
    expectedTransactionRevision: "7",
    expectedReimbursementRelationshipRevision: "1",
    amountCents: 100_000,
    currencyCode: "USD",
    rationale: "Rent for November",
    allocationId: "al-1",
    expectedAllocationRevision: 3,
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("asks which part of a split transaction covers the bill", async () => {
  h.api.manageFinanceOccurrenceMatch.mockResolvedValue(completed({}));
  h.api.listFinanceCashflowSources.mockResolvedValue({
    transactions: [
      {
        ...landlord,
        allocations: [
          allocation("al-1", 90_000),
          { ...allocation("al-2", 40_000), treatment: "reimbursable" },
          allocation("al-3", 1, false),
        ],
      },
    ],
    coverage: { truncated: false, transactionLimit: 1000 },
  });
  open("match", routeRange);
  await screen.findByText("Match a transaction");
  press(/Landlord LLC/);
  type("Amount matched", "400");
  type("Reason", "Shared rent");
  expect(save("Record match")).toHaveProperty("disabled", true);
  press("$400.00 · Reimbursable");
  type("Amount matched", "400.01");
  expect(screen.getByText("At most $400.00 can be matched here.")).toBeTruthy();
  type("Amount matched", "400");
  fireEvent.click(save("Record match"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith(
    expect.objectContaining({ allocationId: "al-2", expectedAllocationRevision: 3 }),
  );
});

it("matches income without a part, and keeps the form open when the match is refused", async () => {
  open("match", { ...routeRange, key: "occ-2" });
  await screen.findByText("Match a transaction");
  expect(screen.queryByRole("button", { name: /Landlord LLC/ })).toBeNull();
  press(/ACME PAYROLL/);
  type("Amount matched", "2500");
  type("Reason", "November pay");
  h.api.manageFinanceOccurrenceMatch.mockRejectedValueOnce(rejection(409));
  fireEvent.click(save("Record match"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("could not be recorded"), {
      id: "feedback",
    }),
  );
  h.api.manageFinanceOccurrenceMatch.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(save("Record match"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm the match"), {
      id: "feedback",
    }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  h.api.manageFinanceOccurrenceMatch.mockResolvedValueOnce(completed({}));
  fireEvent.click(save("Record match"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  const calls = h.api.manageFinanceOccurrenceMatch.mock.calls.map((call) => call[0]);
  expect(calls[2]).toEqual({
    operation: "match_income",
    occurrence: { scheduleVersionId: "sched-1", localDate: payday.localDate, slot: 0 },
    transactionId: "tx-2",
    expectedTransactionRevision: "7",
    expectedReimbursementRelationshipRevision: "1",
    amountCents: 250_000,
    currencyCode: "USD",
    rationale: "November pay",
    idempotencyKey: calls[1].idempotencyKey,
  });
  expectNoInlineResult();
});

it("says when no posted transaction can be matched, and when an item cannot take a match", async () => {
  h.api.listFinanceCashflowSources.mockResolvedValue({
    transactions: [],
    coverage: { truncated: false, transactionLimit: 1000 },
  });
  const view = open("match", routeRange);
  expect(
    await screen.findByText(/No posted transaction in this account and currency/),
  ).toBeTruthy();
  expect(save("Record match")).toHaveProperty("disabled", true);
  view.unmount();
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [{ ...rentDue, remainingExpectedCents: null }],
    matchEvents: [],
    unavailableSources: [],
  });
  const closed = open("match", routeRange);
  expect(await screen.findByText("This expected item cannot take a match.")).toBeTruthy();
  closed.unmount();
  open("match", { ...routeRange, key: "gone" });
  expect(await screen.findByText("This expected item is unavailable.")).toBeTruthy();
});

it("reverses a whole match with a reason", async () => {
  h.api.manageFinanceOccurrenceMatch.mockResolvedValue(completed({}));
  open("match", { ...routeRange, match: "m-1" });
  expect(await screen.findByText(/reverses the whole match/)).toBeTruthy();
  expect(h.api.listFinanceCashflowSources).not.toHaveBeenCalled();
  expect(screen.getByText("$500.00")).toBeTruthy();
  expect(save("Reverse match")).toHaveProperty("disabled", true);
  type("Reason", "Wrong transaction");
  fireEvent.click(save("Reverse match"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Match reversed", { id: "feedback" }));
  expect(h.api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith({
    operation: "reverse",
    matchId: "m-1",
    rationale: "Wrong transaction",
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("does not reverse a match that is already reversed, and reports a refused reversal", async () => {
  const view = open("match", { ...routeRange, match: "m-9" });
  expect(await screen.findByText(/This match is unavailable/)).toBeTruthy();
  view.unmount();
  h.api.manageFinanceOccurrenceMatch.mockRejectedValue(rejection(409));
  open("match", { ...routeRange, match: "m-1" });
  await screen.findByText(/reverses the whole match/);
  type("Reason", "Wrong transaction");
  fireEvent.click(save("Reverse match"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("may already be reversed"), {
      id: "feedback",
    }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

// ── Scenarios ────────────────────────────────────────────────────────────────

function fillScenario(name: string, income: string) {
  type(`${name} starting cash`, "1000");
  type(`${name} monthly income`, income);
  type(`${name} monthly housing`, "1800");
  type(`${name} monthly debt payment`, "0");
  type(`${name} monthly reserve`, "100");
}
const projection = (label: string, monthlyCashFlow: number) => ({
  label,
  monthlyCashFlow,
  projectedLowestBalance: 900,
  reserveRunwayMonths: 3.25,
  debtPayoffMonths: null,
  goalDateEffects: label === "Alternative" ? ["Goal reached two months sooner"] : [],
});

it("compares scenarios, shows the server's result and marks it stale after an edit", async () => {
  h.api.compareFinanceScenarios.mockResolvedValue({
    asOf: today,
    baseline: projection("Current assumptions", 3100),
    alternatives: [
      { ...projection("Alternative", 3600), reserveRunwayMonths: null, debtPayoffMonths: 14 },
    ],
    assumptions: ["Income is steady"],
    missingInputs: [],
    sensitivityWarnings: ["Income is uncertain"],
    goalConflicts: [],
    fingerprint: "f",
  });
  open("scenarios");
  expect(h.screen).toHaveBeenCalledWith({ title: "scenarios" });
  expect(screen.getByText(/Current assumptions: enter starting cash/)).toBeTruthy();
  expect(save("Compare")).toHaveProperty("disabled", true);
  fillScenario("Baseline", "5000");
  fireEvent.click(screen.getByLabelText("Baseline has no other monthly spending"));
  fillScenario("Alternative 1", "5500");
  expect(screen.getByText(/Alternative: add other monthly spending/)).toBeTruthy();
  await waitFor(() =>
    expect(button("Add alternative 1 spending")).toHaveProperty("disabled", false),
  );
  press("Add alternative 1 spending");
  expect(screen.queryByLabelText("Alternative 1 has no other monthly spending")).toBeNull();
  press("Groceries");
  type("Alternative 1 spending 1 amount", "4x");
  expect(screen.getByText("Enter an amount above 0, such as 400.00.")).toBeTruthy();
  type("Alternative 1 spending 1 amount", "400");
  type("Baseline goal target", "x");
  expect(screen.getByText("Enter an amount such as 1500.00.")).toBeTruthy();
  type("Baseline goal target", "");
  expect(save("Compare")).toHaveProperty("disabled", false);
  fireEvent.click(save("Compare"));
  expect(h.loading).toHaveBeenCalledWith("Comparing scenarios…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Comparison ready", { id: "feedback" }),
  );
  expect(h.api.compareFinanceScenarios).toHaveBeenCalledWith(
    expect.objectContaining({
      asOf: today,
      horizonMonths: 12,
      baseline: expect.objectContaining({ label: "Current assumptions", monthlyIncome: 5000 }),
      alternatives: [
        expect.objectContaining({
          label: "Alternative",
          monthlyIncome: 5500,
          budgetAllocations: [{ categoryId: "cat-1", limit: 400 }],
        }),
      ],
    }),
  );
  expect(screen.getByText("3,100.00")).toBeTruthy();
  expect(screen.getByText("3,600.00")).toBeTruthy();
  expect(screen.getAllByText("900.00")).toHaveLength(2);
  expect(screen.getByText("3.3 months")).toBeTruthy();
  expect(screen.getByText("14 months")).toBeTruthy();
  expect(screen.getByText("Goal reached two months sooner")).toBeTruthy();
  expect(screen.getByText("Income is uncertain")).toBeTruthy();
  expect(screen.getByText("Income is steady")).toBeTruthy();
  expect(screen.queryByText("Missing inputs")).toBeNull();
  expect(screen.getByText(/Your\s+plan is unchanged\./)).toBeTruthy();
  expect(screen.queryByText(/previous entries/)).toBeNull();
  type("Horizon in months", "24");
  expect(screen.getByText(/previous entries/)).toBeTruthy();
  press("Remove alternative 1 spending 1");
  expect(screen.getByLabelText("Alternative 1 has no other monthly spending")).toBeTruthy();
  expectNoInlineResult();
});

it("keeps the entries when a comparison fails, and adds or removes alternatives", async () => {
  h.api.compareFinanceScenarios.mockRejectedValue(new Error("offline"));
  open("scenarios");
  for (const name of ["Baseline", "Alternative 1"]) {
    fillScenario(name, "5000");
    fireEvent.click(screen.getByLabelText(`${name} has no other monthly spending`));
  }
  type("Alternative 1 name", "Current assumptions");
  expect(screen.getByText("Give each scenario a different name.")).toBeTruthy();
  type("Alternative 1 name", "Move");
  type("Alternative 1 assumptions", "Rent rises");
  type("As of (ISO date/time)", "");
  expect(screen.getByText("Enter the as-of date.")).toBeTruthy();
  type("As of (ISO date/time)", "2026-11-01T00:00");
  fireEvent.click(save("Compare"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t compare these scenarios. Your entries are still here.",
      { id: "feedback" },
    ),
  );
  expect(h.api.compareFinanceScenarios).toHaveBeenCalledWith(
    expect.objectContaining({ asOf: "2026-11-01" }),
  );
  expect(screen.getByLabelText("Alternative 1 name")).toHaveProperty("value", "Move");
  expect(screen.queryByText("Comparison")).toBeNull();
  press("Add alternative");
  expect(screen.getByLabelText("Alternative 2 name")).toHaveProperty("value", "Alternative 2");
  expect(save("Compare")).toHaveProperty("disabled", true);
  press("Remove alternative 2");
  expect(screen.queryByLabelText("Alternative 2 name")).toBeNull();
  expect(save("Compare")).toHaveProperty("disabled", false);
  expectNoInlineResult();
});

it("reports categories that could not be read without blocking a comparison", async () => {
  h.timezone = undefined;
  h.api.getFinanceCategories.mockRejectedValue(new Error("offline"));
  open("scenarios");
  expect(screen.getByLabelText("As of (ISO date/time)")).toHaveProperty("value", "");
  await waitFor(() => expect(h.api.getFinanceCategories).toHaveBeenCalled());
  expect(button("Add baseline spending")).toHaveProperty("disabled", true);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

it("starts a revision from a twice-monthly variable schedule with no account", async () => {
  h.api.listFinanceRecurringItems.mockResolvedValue(
    items(
      [],
      [
        { ...vault, accountId: "acct-gone" },
        { ...rent, id: "ob-4", accountId: null },
      ],
    ),
  );
  h.api.listFinanceRecurringSchedules.mockResolvedValue([
    {
      ...rentSchedule,
      source: { kind: "obligation", id: "ob-3" },
      cadence: "semimonthly",
      semimonthlyDays: [1, 15],
      amountBasis: "variable",
      amountCents: null,
      currencyCode: "EUR",
    },
  ]);
  const view = open("schedule", { kind: "obligation", id: "ob-3" });
  expect(await screen.findByText("Revise schedule")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByLabelText("First day of month")).toHaveProperty("value", "1");
  expect(screen.getByLabelText("Second day of month")).toHaveProperty("value", "15");
  expect(screen.getByLabelText("Expected amount")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "EUR");
  expect(button("Amount type, Variable")).toBeTruthy();
  view.unmount();
  h.timezone = undefined;
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  open("schedule", { kind: "obligation", id: "ob-4" });
  expect(await screen.findByText("None established")).toBeTruthy();
  expect(screen.getByLabelText("Timezone")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "");
});

it("opens the cost form from an earlier statement and shows a cancelled item as closed", async () => {
  const stated = {
    ...rent,
    accountId: "acct-gone",
    planningEvidence: {
      sourceId: "ob-1",
      sourceRevision: 2,
      expectedAmountCents: 180_000,
      cadence: "monthly",
      accountId: "acct-gone",
      fixedness: "variable",
      provenance: "explicit_user",
      currencyCode: "CAD",
      asOf: "2026-10-01",
    },
  };
  h.api.listFinanceRecurringItems.mockResolvedValue(
    items([], [stated, { ...streaming, status: "cancelled", cadence: "fortnightly" }]),
  );
  const view = open("cost", { id: "ob-1" });
  expect(await screen.findByText("Confirm cost")).toBeTruthy();
  expect(button("Cost type, Variable")).toBeTruthy();
  expect(screen.getByLabelText("Currency")).toHaveProperty("value", "CAD");
  expect(screen.getByText("Unavailable")).toBeTruthy();
  view.unmount();
  const item = open("item", { kind: "obligation", id: "ob-1" });
  expect(await screen.findByText("Variable cost")).toBeTruthy();
  expect(screen.getByText("Your statement as of Oct 1, 2026.")).toBeTruthy();
  item.unmount();
  h.api.listFinanceRecurringSchedules.mockResolvedValue([
    {
      ...rentSchedule,
      source: { kind: "obligation", id: "ob-2" },
      amountBasis: "variable",
      amountCents: null,
    },
  ]);
  open("item", { kind: "obligation", id: "ob-2" });
  expect(await screen.findByText(/Variable, amount not stated/)).toBeTruthy();
  expect(screen.getByText("Cancelled")).toBeTruthy();
  expect(screen.getByText("fortnightly")).toBeTruthy();
  expect(button("Resume")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark cancelled" })).toBeNull();
});

it("shows an outlook with income, no rows and no timezone without failing", async () => {
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      { ...payday, key: "b", localDate: shiftDate(today, 2) },
      { ...payday, key: "a", localDate: shiftDate(today, 2), remainingExpectedCents: null },
    ],
    matchEvents: [],
    unavailableSources: [],
  });
  const view = mount(<FinanceCashflow />);
  expect(await screen.findAllByRole("button", { name: /Acme payroll/ })).toHaveLength(2);
  expect(h.api.listFinanceRecurringObligations).not.toHaveBeenCalled();
  view.unmount();
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    matchEvents: [],
    unavailableSources: [],
  });
  const empty = mount(<FinanceCashflow />);
  expect(await screen.findByText("No scheduled income or bills in the next 30 days.")).toBeTruthy();
  empty.unmount();
  h.timezone = undefined;
  mount(<FinanceCashflow />);
  expect(button("Income")).toBeTruthy();
});

// ── Review follow-ups ────────────────────────────────────────────────────────

it("shows a recurring amount without a currency until its account is known", () => {
  expect(recurringAmount(rent as never, undefined)).toBe("1,800.00");
  expect(recurringAmount(rent as never, [{ id: "acct-1", currencyCode: null }])).toBe("1,800.00");
  expect(recurringAmount(rent as never, [{ id: "acct-1", currencyCode: "EUR" }])).toContain("EUR");
  expect(recurringAmount(vault as never, undefined)).toBe("$1,800.00");
});

it("lets a match that no longer counts be reversed", async () => {
  h.api.manageFinanceOccurrenceMatch.mockResolvedValue(completed({}));
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [{ ...rentDue, matchState: "invalidated", matchIds: [], matchedAmountCents: 0 }],
    matchEvents: [partMatch],
    unavailableSources: [],
  });
  const view = open("occurrence", routeRange);
  const row = await screen.findByRole("button", { name: /\$500\.00/ });
  expect(row.textContent).toContain("No longer counted, matched by you");
  expect(screen.queryByRole("button", { name: "Match a transaction" })).toBeNull();
  view.unmount();
  open("match", { ...routeRange, match: "m-1" });
  await screen.findByText(/reverses the whole match/);
  type("Reason", "Transaction was recategorized");
  fireEvent.click(save("Reverse match"));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  expect(h.api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "reverse", matchId: "m-1" }),
  );
});

it("opens the match form on a fresh read, never on a cached copy being re-read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const window = {
    from: shiftDate(rentDue.localDate, -14),
    to: shiftDate(rentDue.localDate, 14),
  };
  const key = ["finances", "owner-a", "cashflow-sources", window];
  client.setQueryData(key, {
    transactions: [],
    coverage: { truncated: false, transactionLimit: 1000 },
  });
  await client.invalidateQueries({ queryKey: key });
  const fresh = deferred<unknown>();
  h.api.listFinanceCashflowSources.mockReturnValue(fresh.promise);
  h.params = { view: "match", ...routeRange };
  render(
    <QueryClientProvider client={client}>
      <FinanceCashflowRoute />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(h.api.listFinanceCashflowSources).toHaveBeenCalled());
  expect(screen.queryByText("Match a transaction")).toBeNull();
  expect(screen.queryByText(/No posted transaction/)).toBeNull();
  await act(async () =>
    fresh.resolve({
      transactions: [landlord],
      coverage: { truncated: false, transactionLimit: 1000 },
    }),
  );
  expect(await screen.findByRole("button", { name: /Landlord LLC/ })).toBeTruthy();
  expect(h.screen).toHaveBeenCalledWith({ title: "match" });
  client.clear();
});

it("says to resume a paused item instead of pointing at actions it does not offer", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([
    { ...rentSchedule, source: { kind: "obligation", id: "ob-2" }, sourceRevision: 1 },
  ]);
  open("item", { kind: "obligation", id: "ob-2" });
  expect(await screen.findByText(/Resume it to revise the schedule\./)).toBeTruthy();
  expect(screen.getByText(/Resume this item to state whether its payment/)).toBeTruthy();
});

it("keeps an item's actions disabled until it is re-read after a change", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  h.api.manageFinanceRecurringItem.mockResolvedValue(completed({ ...rent, status: "paused" }));
  h.params = { view: "item", kind: "obligation", id: "ob-1" };
  render(
    <QueryClientProvider client={client}>
      <FinanceCashflowRoute />
    </QueryClientProvider>,
  );
  await screen.findByText("Schedule confirmed");
  h.api.listFinanceRecurringItems.mockRejectedValue(new Error("offline"));
  press("Pause");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Recurring item paused", { id: "feedback" }),
  );
  // The write is confirmed, but the item shown is still the one it replaced.
  expect(button("Pause")).toHaveProperty("disabled", true);
  expect(button("Mark cancelled")).toHaveProperty("disabled", true);
  h.api.listFinanceRecurringItems.mockResolvedValue(items([], [{ ...rent, status: "paused" }]));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["finances", "owner-a", "recurring-items"] });
  });
  expect(await screen.findByRole("button", { name: "Resume" })).toHaveProperty("disabled", false);
  expect(h.api.manageFinanceRecurringItem).toHaveBeenCalledTimes(1);
});

it("keeps an open schedule or cost draft when the item is paused elsewhere", async () => {
  h.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  h.api.confirmFinanceRecurringSchedule.mockRejectedValue(rejection(409));
  const view = open("schedule", { kind: "income", id: "inc-1" });
  await screen.findByText("Confirm schedule");
  fillSchedule();
  h.api.listFinanceRecurringItems.mockResolvedValue(items([{ ...payroll, status: "paused" }]));
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(await screen.findByText(/so a schedule cannot be recorded for\s+it/)).toBeTruthy();
  expect(screen.getByLabelText("First date (ISO date/time)")).toHaveProperty("value", "2026-01-09");
  expect(save()).toHaveProperty("disabled", true);
  view.unmount();
  h.error.mockClear();
  h.api.listFinanceRecurringItems.mockResolvedValue(items());
  h.api.manageFinanceRecurringItem.mockRejectedValue(rejection(409));
  open("cost", { id: "ob-1" });
  await screen.findByText("Confirm cost");
  press("Fixed");
  fireEvent.click(screen.getByLabelText("This is my statement"));
  h.api.listFinanceRecurringItems.mockResolvedValue(items([], [{ ...rent, status: "paused" }]));
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(await screen.findByText(/so its cost cannot be stated/)).toBeTruthy();
  expect(button("Cost type, Fixed")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
});

it("corrects a zero spending line beside its field", async () => {
  open("scenarios");
  await waitFor(() => expect(button("Add baseline spending")).toHaveProperty("disabled", false));
  press("Add baseline spending");
  type("Baseline spending 1 amount", "0");
  expect(screen.getByText("Enter an amount above 0, such as 400.00.")).toBeTruthy();
});
