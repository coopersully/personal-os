// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceAssistantScreen } from "./assistant";
import { FinanceConversationReference } from "./conversation-reference";
import { FinanceTransactionScreen } from "./details";
import { FinanceReviewsScreen } from "./reviews";

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
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    listFinanceAccounts: vi.fn(),
    getFinanceTransaction: vi.fn(),
    getFinanceCategories: vi.fn(),
    getFinanceReviewQueue: vi.fn(),
    resolveFinanceReview: vi.fn(),
    updateFinanceTransaction: vi.fn(),
    getFinanceStatus: vi.fn(),
    listFinanceActionReviews: vi.fn(),
    approveFinanceActionReview: vi.fn(),
    dismissFinanceActionReview: vi.fn(),
    getFinancePeriodReview: vi.fn(),
    getFinanceReviewBacklog: vi.fn(),
    listFinanceReviewBacklogItems: vi.fn(),
    listFinanceReviewHistory: vi.fn(),
    getFinanceReviewHistoryItem: vi.fn(),
    getFinanceLedgerHealth: vi.fn(),
    listFinanceAlerts: vi.fn(),
    resolveFinanceAlert: vi.fn(),
    listFinanceReimbursements: vi.fn(),
    reconcileFinanceReimbursement: vi.fn(),
    getFinanceContextualQuestion: vi.fn(),
    answerFinanceContextualQuestion: vi.fn(),
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
    // Unlike the native component, a hidden sheet renders nothing, so its options stay out of reach.
    Modal: ({ children, visible = true }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: { OS: "web" },
    useColorScheme: () => "light",
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean; checked?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected ?? accessibilityState?.checked}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      placeholder,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      placeholder?: string;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        placeholder={placeholder}
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
vi.mock("../../components/app-toaster", () => ({ AppToaster: () => null }));
vi.mock("./spending-chart", () => ({ SpendingChart: () => null }));
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

const account = {
  id: "manual-1",
  name: "Cash wallet",
  institution: "Cash",
  currencyCode: "USD",
  balance: 240,
  includeInPlanning: true,
  kind: "cash",
  provider: "manual",
  ownershipType: "individual",
  ownershipShare: 1,
  synchronization: null,
  status: "manual",
  accountMask: null,
  lastSyncedAt: null,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
};
const categories = [
  { id: "c-groceries", name: "Groceries", color: null, group: "Living", isSystem: true, slug: "g" },
  { id: "c-travel", name: "Travel", color: null, group: "Living", isSystem: true, slug: "t" },
];
const transaction = {
  id: "t-1",
  accountId: account.id,
  amount: 60,
  category: "Groceries",
  categoryId: "c-groceries",
  categoryConfidence: 1,
  createdAt: "2026-11-10T12:00:00.000Z",
  currencyCode: "USD",
  date: "2026-11-10",
  direction: "expense",
  merchant: "Corner market",
  needsReview: true,
  notes: null,
  pending: false,
  updatedAt: "2026-11-10T12:00:00.000Z",
};
const part = (id: string, categoryId: string, amount: number, allocationOrder: number) => ({
  id,
  categoryId,
  amount,
  allocationOrder,
  treatment: "personal",
  state: "active",
  invalidatedAt: null,
  rationale: "Agreed at the till",
  revision: 1,
});
const split = {
  ...transaction,
  category: null,
  categoryId: null,
  allocations: [part("a-1", "c-groceries", 40, 0), part("a-2", "c-travel", 20, 1)],
};
const reviewCase = (item: object) => ({
  id: "case-1",
  createdAt: "2026-11-10T12:00:00.000Z",
  rationale: null,
  reason: "low_confidence",
  status: "open",
  suggestedCategory: null,
  transaction: item,
});
const actionReview = {
  id: "ar-1",
  actionKind: "categorization",
  assumptions: ["Card statement is complete"],
  changes: [
    { entityId: "t-1", entityType: "transaction", summary: "Move Corner market to Groceries" },
  ],
  expectedRevision: null,
  fingerprint: "f".repeat(64),
  rationale: "Three earlier purchases here were groceries.",
  requestedAt: "2026-11-12T12:00:00.000Z",
  requestingAgentId: "agent-1",
  runId: null,
  sourceRefs: [],
  status: "pending",
};
const status = (latestReview: object | null) => ({ details: { latestReview } });
const periodReview = {
  id: "pr-1",
  status: "completed_with_questions",
  period: { start: "2026-10-01", end: "2026-10-31" },
  createdAt: "2026-11-02T12:00:00.000Z",
  cutoff: "2026-11-01T12:00:00.000Z",
  income: 5200,
  spending: { budgetVariance: null, gross: 3400, personal: 3100.5, savings: null },
  position: { opening: 9000, closing: 10100, cashLowPoint: 7200 },
  recommendations: [
    {
      recommendation: "Confirm the October rent transfer",
      disposition: "needs_input",
      evidence: ["Two transfers of the same amount."],
      assumptions: [],
      tradeoffs: ["Leaving it open keeps the month unreconciled."],
    },
  ],
  closeReadiness: {
    missingProvenance: 0,
    possibleDuplicates: 1,
    ready: false,
    reconciledThrough: null,
    unansweredExceptions: 2,
    uncategorized: 0,
    unmatchedTransfers: 3,
  },
  work: { approvals: 0, exceptions: 2, questions: 4, rulesAndActions: 0 },
  monitoring: { href: "/finances", responsibility: "nohmi keeps watching new transactions." },
};
const counts = (items: number) => ({
  items,
  needsReviewTransactions: items,
  openReviewCases: 2,
  deferredReviewCases: 1,
  currentMonth: items,
  historical: 0,
  future: 0,
  unknownDate: 0,
  mismatchedReviewCases: 0,
});
const backlog = {
  counts: counts(7),
  groups: [
    { group: "roundups", label: "Possible roundups", guidance: "A clue only.", counts: counts(0) },
    {
      group: "internal_movements",
      label: "Possible internal movements",
      guidance: "Inspect both sides.",
      counts: counts(3),
    },
    {
      group: "card_payments",
      label: "Possible card payments",
      guidance: "Confirm the card.",
      counts: counts(0),
    },
    {
      group: "ambiguous_payments",
      label: "Ambiguous payments",
      guidance: "Ask when unsure.",
      counts: counts(0),
    },
    {
      group: "other_categorization",
      label: "Other review work",
      guidance: "Review the exact reason.",
      counts: counts(4),
    },
  ],
};
const backlogItem = (id: string, merchant: string | null) => ({
  id,
  source: "review_case",
  transactionId: `t-${id}`,
  reviewCaseId: "case-1",
  group: "other_categorization",
  reason: "category_ambiguity",
  status: "open",
  period: "current_month",
  transaction: merchant
    ? {
        date: "2026-11-10",
        merchant,
        amountCents: 4250,
        currencyCode: "USD",
        direction: "expense",
        category: null,
        needsReview: true,
        pending: false,
      }
    : null,
  evidence: [],
  savedClarification: null,
});
const historyRow = (id: string, merchant: string, extra: object = {}) => ({
  id,
  context: { merchant, date: "2026-11-05" },
  firstSeenAt: "2026-11-05T12:00:00.000Z",
  reason: "category_ambiguity",
  resolvedAt: "2026-11-06T12:00:00.000Z",
  status: "resolved",
  transactionId: "t-1",
  ...extra,
});
const historyItem = (extra: object = {}) => ({
  ...historyRow("h-1", "Corner market"),
  prompt: "Is Corner market groceries?",
  evidence: {},
  resolution: { type: "dismiss", rationale: "Already handled in person." },
  resolutionProvenance: { actorType: "user" },
  relatedTransactionAvailable: true,
  retainedQuestions: [{ id: "q-1", prompt: "What was this for?", state: "answered" }],
  retainedAnswers: [
    { id: "an-1", text: "Weekly shop", sourceKind: "app", recordedAt: "2026-11-06T12:00:00.000Z" },
  ],
  ...extra,
});
const health = {
  asOf: "2026-11-14T12:00:00.000Z",
  balanceOnlyAccounts: 0,
  candidateTransfers: 3,
  missingProvenance: 0,
  pendingTransactions: 2,
  possibleDuplicates: 1,
  staleAccounts: 0,
  unresolvedReviews: 7,
};
const alert = {
  id: "al-1",
  title: "Rent went up",
  body: "November rent was $50 higher than October.",
  createdAt: "2026-11-03T12:00:00.000Z",
  evidence: {},
  recurringObligationId: null,
  severity: "warning",
  status: "open",
  type: "recurring_amount_changed",
};
const sourceRefs = [{ kind: "transaction", id: "t-9" }];
const match = {
  id: "m-1",
  amount: 30,
  creditTransactionId: "t-credit",
  createdAt: "2026-11-08T12:00:00.000Z",
  evidence: { sourceRefs: [{ kind: "transaction", id: "t-credit" }], summary: "Venmo credit" },
  rationale: "Sam paid part back",
  reimbursementId: "r-1",
};
const reimbursement = {
  id: "r-1",
  allocationId: "a-9",
  sourceExpense: { merchant: "Trattoria", transactionId: "t-9", currency: "USD" },
  cancelledAt: null,
  corrections: [],
  createdAt: "2026-11-01T12:00:00.000Z",
  dueDate: "2026-11-30",
  evidence: { sourceRefs, summary: "Dinner split" },
  expectedAmount: 80,
  matches: [match],
  payer: "Sam",
  rationale: "Sam owes half of dinner",
  receivedAmount: 30,
  revision: 4,
  status: "partially_received",
  updatedAt: "2026-11-08T12:00:00.000Z",
};
const question = (state = "open") => ({
  state: "available",
  question: {
    id: "cq-1",
    reviewCaseId: "case-1",
    transactionId: "t-1",
    prompt: "What was this purchase for?",
    disclosure: "minimal",
    status: state,
    work: { id: "cq-1", revision: "3", domain: "finances", kind: "question", actionRevision: "2" },
    transaction: {
      merchant: "Corner market",
      date: "2026-11-10",
      amountCents: 6000,
      currencyCode: "USD",
    },
  },
});
const rejection = (code: number) =>
  new ApiClientError({ code: "error", message: "no", status: code });
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}
function open(view: string, params: Record<string, string> = {}) {
  h.params = { view, ...params };
  return mount(<FinanceReviewsScreen />);
}
const pushed = (params: object) =>
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-reviews", params });

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.params = {};
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { cash: 0, netWorth: 0, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: { possibleDuplicateGroups: [] },
  });
  h.api.getFinanceCategories.mockResolvedValue(categories);
  h.api.getFinanceReviewQueue.mockResolvedValue([]);
  h.api.getFinanceTransaction.mockResolvedValue({ data: transaction });
  h.api.getFinanceStatus.mockResolvedValue(
    status({ id: "pr-1", status: "completed", completedAt: "2026-11-02T12:00:00.000Z" }),
  );
  h.api.listFinanceActionReviews.mockResolvedValue([actionReview]);
  h.api.getFinancePeriodReview.mockResolvedValue(periodReview);
  h.api.getFinanceReviewBacklog.mockResolvedValue(backlog);
  h.api.listFinanceReviewBacklogItems.mockResolvedValue({
    items: [backlogItem("1", "Corner market")],
    nextCursor: null,
    total: 1,
  });
  h.api.listFinanceReviewHistory.mockResolvedValue({
    items: [historyRow("h-1", "Corner market")],
    nextCursor: null,
  });
  h.api.getFinanceReviewHistoryItem.mockResolvedValue(historyItem());
  h.api.getFinanceLedgerHealth.mockResolvedValue(health);
  h.api.listFinanceAlerts.mockResolvedValue([alert]);
  h.api.listFinanceReimbursements.mockResolvedValue({
    reimbursements: [reimbursement],
    unmatchedCredits: [],
  });
  h.api.getFinanceContextualQuestion.mockResolvedValue(question());
});
afterEach(cleanup);

// Assistant: where reviews are reached

it("links the review destinations from the assistant", async () => {
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByText("Period review"));
  pushed({ view: "period", id: "pr-1" });
  for (const [title, view] of [
    ["Review backlog", "backlog"],
    ["Review history", "history"],
    ["Ledger checks", "checks"],
    ["Reimbursements", "reimbursements"],
  ] as const) {
    fireEvent.click(screen.getByText(title));
    pushed({ view });
  }
});

it("offers no period review before one is recorded", async () => {
  h.api.getFinanceStatus.mockResolvedValue(status(null));
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByText("No period review recorded yet."));
  expect(h.push).not.toHaveBeenCalled();
});

// Action reviews

it("approves an action review once and reports it through one toast", async () => {
  h.api.approveFinanceActionReview.mockResolvedValue({ status: "applied", result: {} });
  mount(<FinanceAssistantScreen />);
  expect(await screen.findByText("Move Corner market to Groceries")).toBeTruthy();
  h.api.listFinanceActionReviews.mockResolvedValue([]);
  press("Approve Categorization");
  press("Approve Categorization");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Approved and applied", { id: "feedback" }),
  );
  expect(h.api.approveFinanceActionReview).toHaveBeenCalledTimes(1);
  expect(h.api.approveFinanceActionReview).toHaveBeenCalledWith("ar-1");
  expect(await screen.findByText("No changes waiting for your approval.")).toBeTruthy();
  expectNoInlineResult();
});

it.each([
  ["pending_review", "Not applied. This change now needs a new review."],
  ["needs_input", "Not applied. nohmi needs an answer from you before this change can go ahead."],
])("does not report an approval that came back %s as applied", async (state, message) => {
  h.api.approveFinanceActionReview.mockResolvedValue({ status: state });
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Approve Categorization");
  await waitFor(() => expect(h.info).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("says nothing was applied when the review was already resolved", async () => {
  h.api.approveFinanceActionReview.mockRejectedValue(rejection(409));
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Approve Categorization");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Nothing was applied. This review changed or is no longer waiting for approval.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.api.listFinanceActionReviews.mock.calls.length).toBeGreaterThan(1);
  expectNoInlineResult();
});

it("holds an unconfirmed approval until the latest state is read", async () => {
  h.api.approveFinanceActionReview.mockRejectedValue(new Error("offline"));
  let release: (value: unknown) => void = () => undefined;
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  h.api.listFinanceActionReviews.mockReturnValue(new Promise((resolve) => (release = resolve)));
  press("Approve Categorization");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the approval. Checking the latest state before you try again.",
      { id: "feedback" },
    ),
  );
  expect(button("Approve Categorization").disabled).toBe(true);
  expect(button("Dismiss Categorization").disabled).toBe(true);
  await act(async () => release([actionReview]));
  await waitFor(() => expect(button("Approve Categorization").disabled).toBe(false));
  expect(h.success).not.toHaveBeenCalled();
});

it("reports an approval of an already applied review as applied", async () => {
  // The server replays the stored result when the review was applied before this tap.
  h.api.listFinanceActionReviews.mockResolvedValueOnce([actionReview]);
  h.api.listFinanceActionReviews.mockResolvedValue([{ ...actionReview, status: "applied" }]);
  h.api.approveFinanceActionReview.mockResolvedValue({ status: "applied", result: {} });
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  expect(h.api.listFinanceActionReviews).toHaveBeenCalledWith(200);
  press("Approve Categorization");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Approved and applied", { id: "feedback" }),
  );
  expect(await screen.findByText("No changes waiting for your approval.")).toBeTruthy();
});

it("dismisses an action review", async () => {
  h.api.dismissFinanceActionReview.mockResolvedValue({ ...actionReview, status: "dismissed" });
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Dismiss Categorization");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Review dismissed", { id: "feedback" }),
  );
  expect(h.api.dismissFinanceActionReview).toHaveBeenCalledWith("ar-1");
  expectNoInlineResult();
});

it("does not call an already applied review dismissed", async () => {
  h.api.dismissFinanceActionReview.mockResolvedValue({ ...actionReview, status: "applied" });
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Dismiss Categorization");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Nothing was dismissed. This review was already applied.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
});

it("reports a dismissal the server rejected and one it could not confirm", async () => {
  h.api.dismissFinanceActionReview.mockRejectedValueOnce(rejection(404));
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Dismiss Categorization");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Nothing was dismissed. This review is no longer available.",
      { id: "feedback" },
    ),
  );
  h.api.dismissFinanceActionReview.mockRejectedValueOnce(new Error("offline"));
  await waitFor(() => expect(button("Dismiss Categorization").disabled).toBe(false));
  press("Dismiss Categorization");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the dismissal. Checking the latest state before you try again.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
});

it("shows only reviews still waiting for approval", async () => {
  h.api.listFinanceActionReviews.mockResolvedValue([{ ...actionReview, status: "dismissed" }]);
  mount(<FinanceAssistantScreen />);
  expect(await screen.findByText("No changes waiting for your approval.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve Categorization" })).toBeNull();
});

// Period review

it("shows a saved period review without offering a change", async () => {
  open("period", { id: "pr-1" });
  expect(await screen.findByText("Completed with questions")).toBeTruthy();
  expect(h.api.getFinancePeriodReview).toHaveBeenCalledWith("pr-1");
  expect(screen.getByText("$5,200.00")).toBeTruthy();
  expect(screen.getByText("$3,100.50")).toBeTruthy();
  expect(screen.getByText("Confirm the October rent transfer")).toBeTruthy();
  expect(screen.getByText("This review still had unresolved evidence at its cutoff.")).toBeTruthy();
  expect(
    screen.getByText("4 questions · 2 exceptions · 3 unmatched transfers · 1 possible duplicate"),
  ).toBeTruthy();
  // Savings was not recorded; it is never shown as zero.
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText("Open review backlog"));
  pushed({ view: "backlog" });
});

it("says so when a period review cannot be opened", async () => {
  open("period");
  expect(await screen.findByText("This review is unavailable.")).toBeTruthy();
  expect(h.api.getFinancePeriodReview).not.toHaveBeenCalled();
});

// Backlog

it("lists the backlog by group and opens a record's transaction", async () => {
  open("backlog");
  expect(await screen.findByText("Flagged transactions")).toBeTruthy();
  // The first group holding records is shown.
  await waitFor(() =>
    expect(h.api.listFinanceReviewBacklogItems).toHaveBeenCalledWith(
      expect.objectContaining({ group: "internal_movements" }),
    ),
  );
  fireEvent.click(screen.getByText("Other review work"));
  await waitFor(() =>
    expect(h.api.listFinanceReviewBacklogItems).toHaveBeenCalledWith(
      expect.objectContaining({ group: "other_categorization" }),
    ),
  );
  fireEvent.click(await screen.findByText("Corner market"));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-transaction", params: { id: "t-1" } });
});

it("offers no transaction for a backlog record whose source is gone", async () => {
  h.api.listFinanceReviewBacklogItems.mockResolvedValue({
    items: [backlogItem("2", null)],
    nextCursor: null,
    total: 1,
  });
  open("backlog");
  fireEvent.click(await screen.findByText("Transaction unavailable"));
  expect(h.push).not.toHaveBeenCalled();
});

it("says when a backlog group is empty", async () => {
  h.api.listFinanceReviewBacklogItems.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  open("backlog");
  expect(await screen.findByText("No outstanding review records in this group.")).toBeTruthy();
});

it("restarts the backlog when it changed between pages", async () => {
  h.api.listFinanceReviewBacklogItems.mockResolvedValueOnce({
    items: [backlogItem("1", "Corner market")],
    nextCursor: "next",
    total: 2,
  });
  open("backlog");
  await screen.findByText("Corner market");
  h.api.listFinanceReviewBacklogItems.mockRejectedValueOnce(rejection(409));
  h.api.listFinanceReviewBacklogItems.mockResolvedValue({
    items: [backlogItem("3", "Night bus")],
    nextCursor: null,
    total: 1,
  });
  fireEvent.click(screen.getByText("Load more records"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "The backlog changed while you were reading it. Showing it again from the start.",
    ),
  );
  expect(await screen.findByText("Night bus")).toBeTruthy();
  expect(screen.queryByText("Corner market")).toBeNull();
});

it("keeps the loaded records when another page fails to load", async () => {
  h.api.listFinanceReviewBacklogItems.mockResolvedValueOnce({
    items: [backlogItem("1", "Corner market")],
    nextCursor: "next",
    total: 2,
  });
  open("backlog");
  await screen.findByText("Corner market");
  h.api.listFinanceReviewBacklogItems.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByText("Load more records"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn’t load more records."));
  expect(screen.getByText("Corner market")).toBeTruthy();
  expect(screen.getByText("Load more records")).toBeTruthy();
});

// History

it("lists review history page by page and opens one review", async () => {
  h.api.listFinanceReviewHistory.mockResolvedValueOnce({
    items: [historyRow("h-1", "Corner market")],
    nextCursor: "h-1",
  });
  open("history");
  await screen.findByText("Corner market");
  h.api.listFinanceReviewHistory.mockResolvedValueOnce({
    items: [historyRow("h-2", "Night bus", { status: "deferred", archived: true })],
    nextCursor: null,
  });
  fireEvent.click(screen.getByText("Load more history"));
  expect(await screen.findByText("Night bus")).toBeTruthy();
  expect(h.api.listFinanceReviewHistory).toHaveBeenLastCalledWith({ cursor: "h-1", limit: 20 });
  expect(screen.queryByText("Load more history")).toBeNull();
  fireEvent.click(screen.getByText("Corner market"));
  pushed({ view: "history-item", id: "h-1" });
});

it("says when there is no review history", async () => {
  h.api.listFinanceReviewHistory.mockResolvedValue({ items: [], nextCursor: null });
  open("history");
  expect(await screen.findByText("No review history yet.")).toBeTruthy();
});

it("shows a dismissed review's recorded outcome", async () => {
  open("history-item", { id: "h-1" });
  expect(await screen.findByText("Is Corner market groceries?")).toBeTruthy();
  expect(h.api.getFinanceReviewHistoryItem).toHaveBeenCalledWith("h-1");
  expect(screen.getByText("Dismissed")).toBeTruthy();
  expect(screen.getByText("Already handled in person.")).toBeTruthy();
  expect(screen.getByText("Recorded by you")).toBeTruthy();
  expect(screen.getByText("What was this for?")).toBeTruthy();
  expect(screen.getByText("Weekly shop")).toBeTruthy();
  fireEvent.click(screen.getByText("Open transaction"));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-transaction", params: { id: "t-1" } });
});

it("keeps an archived review read-only with no transaction to open", async () => {
  h.api.getFinanceReviewHistoryItem.mockResolvedValue(
    historyItem({
      archived: true,
      prompt: undefined,
      resolution: { type: "clarify", clarification: "It was a gift." },
      resolutionProvenance: { actorType: "agent" },
      retainedQuestions: undefined,
      retainedAnswers: undefined,
    }),
  );
  open("history-item", { id: "h-1" });
  expect(
    await screen.findByText("Source removed. This review is retained as read-only history."),
  ).toBeTruthy();
  expect(screen.getByText("It was a gift.")).toBeTruthy();
  expect(screen.getByText("Recorded by an agent")).toBeTruthy();
  expect(screen.queryByText("Open transaction")).toBeNull();
});

// Ledger checks and alerts

it("shows the ledger checks and runs them again on request", async () => {
  open("checks");
  expect(await screen.findByText("Unconfirmed transfers")).toBeTruthy();
  expect(screen.getByText("Possible duplicates")).toBeTruthy();
  h.api.getFinanceLedgerHealth.mockResolvedValue({ ...health, candidateTransfers: 0 });
  press("Run checks again");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Ledger checks updated", { id: "feedback" }),
  );
  expect(h.loading).toHaveBeenCalledWith("Running ledger checks…");
  expect(h.api.getFinanceLedgerHealth).toHaveBeenCalledTimes(2);
  expectNoInlineResult();
  fireEvent.click(screen.getByText("Unresolved reviews"));
  pushed({ view: "backlog" });
});

it("does not call the checks updated when they could not be run", async () => {
  open("checks");
  await screen.findByText("Unconfirmed transfers");
  h.api.getFinanceLedgerHealth.mockRejectedValue(new Error("offline"));
  press("Run checks again");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t run the ledger checks. The figures shown may be out of date.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
});

it.each([
  ["Mark Rent went up resolved", "resolve", "resolved", "Alert resolved"],
  ["Dismiss Rent went up", "dismiss", "dismissed", "Alert dismissed"],
])("resolves an alert with %s", async (name, action, state, message) => {
  h.api.resolveFinanceAlert.mockResolvedValue({ ...alert, status: state });
  open("checks");
  expect(await screen.findByText("November rent was $50 higher than October.")).toBeTruthy();
  h.api.listFinanceAlerts.mockResolvedValue([]);
  press(name);
  press(name);
  await waitFor(() => expect(h.success).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.api.resolveFinanceAlert).toHaveBeenCalledTimes(1);
  expect(h.api.resolveFinanceAlert).toHaveBeenCalledWith("al-1", { action, rationale: null });
  expect(await screen.findByText("No open financial alerts.")).toBeTruthy();
  expectNoInlineResult();
});

it("does not call an alert resolved when the change awaits review", async () => {
  h.api.resolveFinanceAlert.mockResolvedValue({ status: "pending_review", review: {} });
  open("checks");
  await screen.findByText("Rent went up");
  press("Mark Rent went up resolved");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Not applied. This change is waiting for review.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
});

it.each([
  [rejection(404), "This alert is no longer available. Nothing was changed."],
  [rejection(400), "Couldn’t update this alert. Nothing was changed."],
  [new Error("offline"), "Couldn’t confirm the change. Check your alerts before trying again."],
])("reports an alert that could not be resolved", async (failure, message) => {
  h.api.resolveFinanceAlert.mockRejectedValue(failure);
  open("checks");
  await screen.findByText("Rent went up");
  press("Dismiss Rent went up");
  await waitFor(() => expect(h.error).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.api.listFinanceAlerts.mock.calls.length).toBeGreaterThan(1);
  expectNoInlineResult();
});

// Reimbursements

it("lists reimbursements and opens one", async () => {
  open("reimbursements");
  fireEvent.click(await screen.findByText("Sam"));
  expect(screen.getByText("$30.00 received of $80.00 · due Nov 30")).toBeTruthy();
  pushed({ view: "reimbursement", id: "r-1" });
});

it("says when no reimbursements are outstanding", async () => {
  h.api.listFinanceReimbursements.mockResolvedValue({ reimbursements: [], unmatchedCredits: [] });
  open("reimbursements");
  expect(await screen.findByText("No reimbursements outstanding.")).toBeTruthy();
});

it("shows a reimbursement with its receipts and corrections", async () => {
  open("reimbursement", { id: "r-1" });
  expect(await screen.findByText("Sam owes half of dinner")).toBeTruthy();
  press("Correct expectation");
  pushed({ view: "reimbursement-correct", id: "r-1" });
  press("Remove receipt match 1");
  pushed({ view: "reimbursement-correct", id: "r-1", match: "m-1" });
  fireEvent.click(screen.getByText("Trattoria"));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-transaction", params: { id: "t-9" } });
});

it("offers no correction for a cancelled reimbursement", async () => {
  h.api.listFinanceReimbursements.mockResolvedValue({
    reimbursements: [{ ...reimbursement, status: "cancelled", matches: [], payer: null }],
    unmatchedCredits: [],
  });
  open("reimbursement", { id: "r-1" });
  expect(await screen.findByText("No receipts recorded yet.")).toBeTruthy();
  expect(screen.getAllByText("Payer not set").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Correct expectation" })).toBeNull();
  cleanup();
  h.api.listFinanceReimbursements.mockResolvedValue({
    reimbursements: [{ ...reimbursement, status: "cancelled" }],
    unmatchedCredits: [],
  });
  open("reimbursement", { id: "r-1" });
  expect(await screen.findByText("Sam paid part back · ", { exact: false })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove receipt match 1" })).toBeNull();
});

it("says when a reimbursement is no longer listed", async () => {
  open("reimbursement", { id: "r-missing" });
  expect(await screen.findByText("This reimbursement is unavailable.")).toBeTruthy();
});

async function openCorrection(params: Record<string, string> = {}) {
  const view = open("reimbursement-correct", { id: "r-1", ...params });
  await screen.findByLabelText("Reason for correction");
  return view;
}
const saveCorrection = () => button(/Save correction|Retry same correction/);
function fillCorrection() {
  type("Expected amount", "75.00");
  type("Reason for correction", "Sam covered the tip");
  type("Supporting evidence", "Message from Sam on 12 Nov");
}

it("corrects a reimbursement expectation against the revision shown", async () => {
  h.api.reconcileFinanceReimbursement.mockResolvedValue({ ...reimbursement, expectedAmount: 75 });
  await openCorrection();
  expect((screen.getByLabelText("Expected amount") as HTMLInputElement).value).toBe("80.00");
  expect(saveCorrection().disabled).toBe(true);
  fillCorrection();
  type("Due date", "2026-12-15");
  fireEvent.click(saveCorrection());
  fireEvent.click(saveCorrection());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Reimbursement correction saved", { id: "feedback" }),
  );
  expect(h.api.reconcileFinanceReimbursement).toHaveBeenCalledTimes(1);
  expect(h.api.reconcileFinanceReimbursement).toHaveBeenCalledWith({
    operation: "correct_expected",
    idempotencyKey: expect.any(String),
    reimbursementId: "r-1",
    expectedRevision: 4,
    expectedAmount: 75,
    payer: "Sam",
    dueDate: "2026-12-15",
    rationale: "Sam covered the tip",
    evidence: { summary: "Message from Sam on 12 Nov", sourceRefs },
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("blocks a correction below what was already received or with a bad date", async () => {
  await openCorrection();
  fillCorrection();
  type("Expected amount", "20");
  expect(
    screen.getByText("Enter an amount of at least $30.00, the amount already received."),
  ).toBeTruthy();
  expect(saveCorrection().disabled).toBe(true);
  type("Expected amount", "75");
  type("Due date", "15/12/2026");
  expect(screen.getByText("Use a date such as 2026-12-31, or leave it blank.")).toBeTruthy();
  expect(saveCorrection().disabled).toBe(true);
  type("Due date", "");
  type("Payer", "  ");
  expect(saveCorrection().disabled).toBe(false);
  h.api.reconcileFinanceReimbursement.mockResolvedValue(reimbursement);
  fireEvent.click(saveCorrection());
  await waitFor(() => expect(h.api.reconcileFinanceReimbursement).toHaveBeenCalled());
  expect(h.api.reconcileFinanceReimbursement.mock.calls[0]?.[0]).toMatchObject({
    payer: null,
    dueDate: null,
  });
});

it("retries an unconfirmed correction as the same request, never a new one", async () => {
  h.api.reconcileFinanceReimbursement.mockRejectedValueOnce(new Error("offline"));
  await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the correction. Retry to send the same correction again; it will not be applied twice.",
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Expected amount") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Reason for correction") as HTMLInputElement).disabled).toBe(true);
  h.api.reconcileFinanceReimbursement.mockResolvedValue(reimbursement);
  fireEvent.click(button("Retry same correction"));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const [first, second] = h.api.reconcileFinanceReimbursement.mock.calls.map((call) => call[0]);
  expect(second).toEqual(first);
  // Leaving while the outcome is unknown warns that it may have been saved.
  expectNoInlineResult();
});

it("warns before leaving a correction whose outcome is unknown", async () => {
  h.api.reconcileFinanceReimbursement.mockRejectedValue(new Error("offline"));
  await openCorrection();
  fillCorrection();
  press("Cancel");
  expect(h.alert).toHaveBeenLastCalledWith(
    "Discard changes?",
    "The correction has not been saved.",
    expect.anything(),
  );
  confirm("Keep editing");
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(saveCorrection());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  press("Cancel");
  expect(h.alert).toHaveBeenLastCalledWith(
    "Leave this correction?",
    "The last save may already have gone through. Check the reimbursement before correcting it again.",
    expect.anything(),
  );
  confirm("Leave");
  expect(h.back).toHaveBeenCalledTimes(1);
});

it("closes an untouched correction without asking", async () => {
  await openCorrection();
  press("Close");
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalledTimes(1);
});

it.each([
  [
    409,
    "Nothing was saved. This reimbursement changed. Close and reopen it to see the latest; your draft is still here.",
  ],
  [400, "Couldn’t save this correction. Nothing was changed; your draft is still here."],
])("keeps the draft and sends a new request after a %s rejection", async (code, message) => {
  h.api.reconcileFinanceReimbursement.mockRejectedValueOnce(rejection(code));
  await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  await waitFor(() => expect(h.error).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.back).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Expected amount") as HTMLInputElement).value).toBe("75.00");
  h.api.reconcileFinanceReimbursement.mockResolvedValue(reimbursement);
  fireEvent.click(saveCorrection());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const [first, second] = h.api.reconcileFinanceReimbursement.mock.calls.map((call) => call[0]);
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});

it("lets a retry the server recorded as failed go again under a new key", async () => {
  h.api.reconcileFinanceReimbursement.mockRejectedValueOnce(new Error("offline"));
  await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  await waitFor(() => expect(button("Retry same correction")).toBeTruthy());
  h.api.reconcileFinanceReimbursement.mockRejectedValueOnce(
    new ApiClientError({
      code: "conflict",
      message: "That Finance mutation is already in progress.",
      status: 409,
    }),
  );
  fireEvent.click(button("Retry same correction"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "The earlier attempt is still being processed. Wait a moment, then retry the same correction.",
      { id: "feedback" },
    ),
  );
  h.api.reconcileFinanceReimbursement.mockRejectedValueOnce(
    new ApiClientError({
      code: "conflict",
      message: "That Finance mutation previously failed; use a new idempotency key to retry.",
      status: 409,
    }),
  );
  fireEvent.click(button("Retry same correction"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Nothing was saved. The earlier attempt failed on the server. Save again to send your draft as a new correction.",
      { id: "feedback" },
    ),
  );
  // The draft is kept and editable, and Save sends it as a new request.
  expect((screen.getByLabelText("Expected amount") as HTMLInputElement).value).toBe("75.00");
  expect((screen.getByLabelText("Expected amount") as HTMLInputElement).disabled).toBe(false);
  expect(h.back).not.toHaveBeenCalled();
  h.api.reconcileFinanceReimbursement.mockResolvedValue(reimbursement);
  fireEvent.click(button("Save correction"));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const keys = h.api.reconcileFinanceReimbursement.mock.calls.map((call) => call[0].idempotencyKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).toBe(keys[0]);
  expect(keys[3]).not.toBe(keys[0]);
});

it("says when a correction needs an answer rather than a review", async () => {
  h.api.reconcileFinanceReimbursement.mockResolvedValue({ status: "needs_input", question: {} });
  await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "Not applied. nohmi needs an answer from you before this correction can go ahead.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("does not call a correction saved when it was only submitted for review", async () => {
  h.api.reconcileFinanceReimbursement.mockResolvedValue({ status: "pending_review", review: {} });
  await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "Submitted for review. The correction has not been applied.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(saveCorrection().disabled).toBe(true);
});

it("removes a receipt match with that receipt's evidence", async () => {
  h.api.reconcileFinanceReimbursement.mockResolvedValue({ ...reimbursement, matches: [] });
  await openCorrection({ match: "m-1" });
  expect(screen.queryByLabelText("Expected amount")).toBeNull();
  type("Reason for correction", "Wrong credit");
  type("Supporting evidence", "The credit was a refund");
  press("Remove receipt match");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.reconcileFinanceReimbursement).toHaveBeenCalledWith({
    operation: "unmatch_credit",
    idempotencyKey: expect.any(String),
    reimbursementId: "r-1",
    expectedRevision: 4,
    matchId: "m-1",
    rationale: "Wrong credit",
    evidence: { summary: "The credit was a refund", sourceRefs: match.evidence.sourceRefs },
  });
});

it("offers no correction for a receipt that is no longer matched", async () => {
  open("reimbursement-correct", { id: "r-1", match: "m-gone" });
  expect(await screen.findByText("This correction is unavailable.")).toBeTruthy();
});

// Contextual question

function openQuestion() {
  h.params = { id: "cq-1", kind: "contextual_question" };
  return mount(<FinanceConversationReference />);
}

it("answers a contextual question directly", async () => {
  h.api.answerFinanceContextualQuestion.mockResolvedValue({ state: "accepted" });
  openQuestion();
  expect(await screen.findByText("What was this purchase for?")).toBeTruthy();
  expect(button("Save context").disabled).toBe(true);
  type("Your answer", "  Weekly shop for the flat  ");
  h.api.getFinanceContextualQuestion.mockResolvedValue(question("answered"));
  press("Save context");
  press("Save context");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Context saved", { id: "feedback" }));
  expect(h.api.answerFinanceContextualQuestion).toHaveBeenCalledTimes(1);
  expect(h.api.answerFinanceContextualQuestion).toHaveBeenCalledWith({
    operationId: expect.any(String),
    work: question().question.work,
    text: "Weekly shop for the flat",
    source: { kind: "app", messageId: null },
  });
  // The answered state comes from the server's record of the question.
  expect(await screen.findByText("Answered. The financial review stays open.")).toBeTruthy();
  expect(screen.queryByLabelText("Your answer")).toBeNull();
  expectNoInlineResult();
});

it("does not call a stale question's answer saved", async () => {
  h.api.answerFinanceContextualQuestion.mockResolvedValue({ state: "blocked" });
  openQuestion();
  await screen.findByText("What was this purchase for?");
  type("Your answer", "Weekly shop");
  press("Save context");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Nothing was saved. This transaction changed, so this question can no longer accept context.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(await screen.findByText("This question can no longer accept context.")).toBeTruthy();
  expect(screen.queryByLabelText("Your answer")).toBeNull();
});

it.each([
  ["unavailable", "Nothing was saved. This question is unavailable."],
  [
    "uncertain",
    "Couldn’t confirm the answer. Send it again; the same answer is never recorded twice.",
  ],
])("reports a %s answer without calling it saved", async (state, message) => {
  h.api.answerFinanceContextualQuestion.mockResolvedValue({ state });
  openQuestion();
  await screen.findByText("What was this purchase for?");
  type("Your answer", "Weekly shop");
  press("Save context");
  await waitFor(() => expect(h.error).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.success).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Your answer") as HTMLInputElement).value).toBe("Weekly shop");
});

it("resends an unconfirmed answer as the same operation and a changed one as new", async () => {
  h.api.answerFinanceContextualQuestion.mockRejectedValueOnce(new Error("offline"));
  openQuestion();
  await screen.findByText("What was this purchase for?");
  type("Your answer", "Weekly shop");
  press("Save context");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the answer. Send it again; the same answer is never recorded twice.",
      { id: "feedback" },
    ),
  );
  // Until the outcome is known the text stays as sent.
  expect((screen.getByLabelText("Your answer") as HTMLInputElement).disabled).toBe(true);
  h.api.answerFinanceContextualQuestion.mockRejectedValueOnce(rejection(400));
  press("Save context");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t save this answer. Nothing was saved; your draft is still here.",
      { id: "feedback" },
    ),
  );
  h.api.answerFinanceContextualQuestion.mockResolvedValue({ state: "accepted" });
  expect((screen.getByLabelText("Your answer") as HTMLInputElement).disabled).toBe(false);
  type("Your answer", "Weekly shop, flat");
  press("Save context");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const [first, second, third] = h.api.answerFinanceContextualQuestion.mock.calls.map(
    (call) => call[0].operationId,
  );
  expect(second).toBe(first);
  expect(third).not.toBe(first);
});

it.each([
  ["answered", "Answered. The financial review stays open."],
  ["stale", "This question can no longer accept context."],
])("offers no answer for a question already %s", async (state, copy) => {
  h.api.getFinanceContextualQuestion.mockResolvedValue(question(state));
  openQuestion();
  expect(await screen.findByText(copy)).toBeTruthy();
  expect(screen.queryByLabelText("Your answer")).toBeNull();
  fireEvent.click(screen.getByText("View transaction"));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-transaction", params: { id: "t-1" } });
});

it("says when a contextual question is unavailable", async () => {
  h.api.getFinanceContextualQuestion.mockResolvedValue({
    state: "unavailable",
    reasonCode: "producer_not_registered",
    retryable: false,
  });
  openQuestion();
  expect(await screen.findByText("Reference unavailable.")).toBeTruthy();
});

// A review of a split transaction

async function openSplitReview() {
  h.params = { id: "t-1" };
  h.api.getFinanceTransaction.mockResolvedValue({ data: split });
  h.api.getFinanceReviewQueue.mockResolvedValue([reviewCase(split)]);
  mount(<FinanceTransactionScreen />);
  await screen.findByRole("button", { name: "Approve splits" });
}

it("asks before a review's single category replaces a transaction's parts", async () => {
  h.api.resolveFinanceReview.mockResolvedValue({
    applied: true,
    threshold: 1,
    transaction: { ...transaction, category: "Travel", categoryId: "c-travel" },
  });
  await openSplitReview();
  fireEvent.click(screen.getByText("Split in 2 parts"));
  fireEvent.click(
    within((await screen.findAllByRole("dialog")).at(-1) as HTMLElement).getByRole("button", {
      name: /Travel/,
    }),
  );
  expect(h.alert).toHaveBeenLastCalledWith(
    "Replace 2 parts?",
    "Choosing Travel puts the whole transaction in that category and removes its 2 parts.",
    expect.anything(),
  );
  expect(h.api.resolveFinanceReview).not.toHaveBeenCalled();
  confirm("Keep splits");
  expect(h.api.resolveFinanceReview).not.toHaveBeenCalled();
  confirm("Replace parts");
  await waitFor(() =>
    expect(h.api.resolveFinanceReview).toHaveBeenCalledWith(
      "case-1",
      expect.objectContaining({ action: "recategorize", categoryId: "c-travel" }),
    ),
  );
});

it("approves a split under review as it stands", async () => {
  h.api.resolveFinanceReview.mockResolvedValue({ applied: true, threshold: 1, transaction: split });
  await openSplitReview();
  press("Approve splits");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Splits approved", { id: "feedback" }),
  );
  expect(h.api.resolveFinanceReview).toHaveBeenCalledWith(
    "case-1",
    expect.objectContaining({ action: "approve" }),
  );
  expect(h.alert).not.toHaveBeenCalled();
});

it("still unmounts cleanly while an approval is in flight", async () => {
  let release: (value: unknown) => void = () => undefined;
  h.api.approveFinanceActionReview.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const view = mount(<FinanceAssistantScreen />);
  await screen.findByText("Move Corner market to Groceries");
  press("Approve Categorization");
  view.unmount();
  await act(async () => release({ status: "applied", result: {} }));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
});

// Variants of the records above

it("shows a completed period review that was ready to close", async () => {
  h.api.getFinancePeriodReview.mockResolvedValue({
    ...periodReview,
    status: "completed",
    recommendations: [{ ...periodReview.recommendations[0], evidence: [], tradeoffs: [] }],
    closeReadiness: { ...periodReview.closeReadiness, ready: true, possibleDuplicates: 2 },
  });
  open("period", { id: "pr-1" });
  expect(await screen.findByText("Completed")).toBeTruthy();
  expect(
    screen.getByText("The recorded evidence was ready to close at the review cutoff."),
  ).toBeTruthy();
  expect(screen.getByText("Evidence: None recorded.")).toBeTruthy();
  expect(screen.getByText(/2 possible duplicates$/)).toBeTruthy();
});

it("says when a period review recorded no recommendations", async () => {
  h.api.getFinancePeriodReview.mockResolvedValue({ ...periodReview, recommendations: [] });
  open("period", { id: "pr-1" });
  expect(await screen.findByText("No recommendations recorded for this review.")).toBeTruthy();
});

it("names a maintained update and summarises a long list of changes", async () => {
  h.api.listFinanceActionReviews.mockResolvedValue([
    {
      ...actionReview,
      actionKind: "maintenance_turn",
      assumptions: [],
      changes: Array.from({ length: 7 }, (_, index) => ({
        entityId: null,
        entityType: "transaction",
        summary: `Change ${index + 1}`,
      })),
    },
  ]);
  h.api.approveFinanceActionReview.mockRejectedValue(rejection(400));
  mount(<FinanceAssistantScreen />);
  expect(await screen.findByText("Maintained finances")).toBeTruthy();
  expect(screen.getByText("Change 5")).toBeTruthy();
  expect(screen.queryByText("Change 6")).toBeNull();
  expect(screen.getByText("And 2 more.")).toBeTruthy();
  expect(screen.queryByText(/^Assumes/)).toBeNull();
  press("Approve Maintained finances");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t approve this change. Nothing was applied.", {
      id: "feedback",
    }),
  );
  h.api.dismissFinanceActionReview.mockRejectedValue(rejection(400));
  await waitFor(() => expect(button("Dismiss Maintained finances").disabled).toBe(false));
  press("Dismiss Maintained finances");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t dismiss this review. Nothing was changed.", {
      id: "feedback",
    }),
  );
});

it("labels a flag with no review and a record with no date", async () => {
  h.api.getFinanceReviewBacklog.mockResolvedValue({
    ...backlog,
    groups: backlog.groups.map((entry) => ({ ...entry, counts: counts(0) })),
  });
  const flagged = backlogItem("4", "Night bus");
  h.api.listFinanceReviewBacklogItems.mockResolvedValue({
    items: [
      {
        ...flagged,
        source: "transaction_flag",
        status: "needs_review",
        transaction: { ...flagged.transaction, date: null, currencyCode: null },
      },
    ],
    nextCursor: null,
    total: 1,
  });
  open("backlog");
  expect(await screen.findByText("Category ambiguity · Transaction flag")).toBeTruthy();
  // With no group holding records, the first group is shown.
  expect(h.api.listFinanceReviewBacklogItems).toHaveBeenCalledWith(
    expect.objectContaining({ group: "roundups" }),
  );
});

it("lists an open history entry without transaction context", async () => {
  h.api.listFinanceReviewHistory.mockResolvedValue({
    items: [historyRow("h-3", "x", { context: undefined, resolvedAt: null, status: "open" })],
    nextCursor: "h-3",
  });
  open("history");
  expect(await screen.findByText("Category ambiguity")).toBeTruthy();
  h.api.listFinanceReviewHistory.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByText("Load more history"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn’t load more history."));
});

it("shows an unresolved review's evidence without an outcome", async () => {
  h.api.getFinanceReviewHistoryItem.mockResolvedValue(
    historyItem({
      context: undefined,
      prompt: undefined,
      resolution: null,
      resolvedAt: null,
      resolutionProvenance: null,
      relatedTransactionAvailable: false,
      retainedQuestions: [],
      retainedAnswers: [],
    }),
  );
  open("history-item", { id: "h-1" });
  expect(await screen.findByText("Category ambiguity")).toBeTruthy();
  expect(screen.queryByText("Recorded outcome")).toBeNull();
  expect(screen.queryByText("Open transaction")).toBeNull();
  expect(screen.queryByText("Questions and answers")).toBeNull();
});

it("names an outcome it has no wording for and one with no actor", async () => {
  h.api.getFinanceReviewHistoryItem.mockResolvedValue(
    historyItem({ resolution: { type: "merge_cases" }, resolutionProvenance: {} }),
  );
  open("history-item", { id: "h-1" });
  expect(await screen.findByText("Merge cases")).toBeTruthy();
  expect(screen.queryByText(/^Recorded by/)).toBeNull();
});

it("lists an overdue reimbursement's corrections", async () => {
  h.api.listFinanceReimbursements.mockResolvedValue({
    reimbursements: [
      {
        ...reimbursement,
        status: "overdue",
        dueDate: null,
        sourceExpense: null,
        corrections: [
          {
            id: "co-1",
            operation: "correct_expected",
            rationale: "Agreed a lower amount",
            recordedAt: "2026-11-09T12:00:00.000Z",
          },
          {
            id: "co-2",
            operation: "unmatch_credit",
            rationale: "Wrong credit",
            recordedAt: "2026-11-09T13:00:00.000Z",
          },
        ],
      },
    ],
    unmatchedCredits: [],
  });
  open("reimbursement", { id: "r-1" });
  expect(await screen.findByText("Expectation corrected")).toBeTruthy();
  expect(screen.getByText("Receipt match removed")).toBeTruthy();
  expect(screen.getByText("No due date")).toBeTruthy();
  expect(screen.getByText("Overdue")).toBeTruthy();
});

it("drops a late answer to a correction after the form is closed", async () => {
  let fail: (reason: unknown) => void = () => undefined;
  h.api.reconcileFinanceReimbursement.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const view = await openCorrection();
  fillCorrection();
  fireEvent.click(saveCorrection());
  view.unmount();
  await act(async () => fail(new Error("offline")));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.error).not.toHaveBeenCalled();
});

it("drops late answers to an alert decision and a question after leaving", async () => {
  let release: (value: unknown) => void = () => undefined;
  h.api.resolveFinanceAlert.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const checks = open("checks");
  await screen.findByText("Rent went up");
  press("Dismiss Rent went up");
  checks.unmount();
  await act(async () => release({ ...alert, status: "dismissed" }));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  h.dismiss.mockClear();
  h.api.answerFinanceContextualQuestion.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const view = openQuestion();
  await screen.findByText("What was this purchase for?");
  type("Your answer", "Weekly shop");
  press("Save context");
  view.unmount();
  await act(async () => release({ state: "accepted" }));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
});

it("reports an answer the server recorded as failed", async () => {
  h.api.answerFinanceContextualQuestion.mockResolvedValue({ state: "failed" });
  openQuestion();
  await screen.findByText("What was this purchase for?");
  type("Your answer", "Weekly shop");
  press("Save context");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t save this answer. Nothing was saved; your draft is still here.",
      { id: "feedback" },
    ),
  );
});
