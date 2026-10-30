import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { FinanceCreateButton } from "./workspace-header";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { resolveWorkspaceSettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { type Action, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceAccountsPage } from "./accounts-page.js";
import { FinanceOverviewPage } from "./overview-page.js";
import {
  accountOwnership,
  FinanceAccountRecord,
  FinancePositionMaterial,
  FinanceSourceState,
  financeAmount,
  requireFinanceResult,
} from "./position-material.js";
import { FinanceWealthPage } from "./wealth-page.js";

async function selectGoalAction(operation: string, name: string) {
  fireEvent.keyDown(await screen.findByRole("button", { name: `Actions for ${name}` }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: `${operation} ${name}` }));
}

vi.spyOn(toast, "loading");
vi.spyOn(toast, "success");
vi.spyOn(toast, "error");

// JSDOM has no viewport intersection observations; carousel layout is verified in the browser.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const workspaceReadiness = vi.hoisted(() => vi.fn());
vi.mock("./use-finance-workspace-readiness", () => ({
  useFinanceWorkspaceReadiness: workspaceReadiness,
}));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
  createFinanceAccount: vi.fn(),
  getFinanceConfiguration: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  getFinanceLedgerHealth: vi.fn().mockResolvedValue({ balanceOnlyAccounts: 0 }),
  syncFinanceAccount: vi.fn(),
  disconnectFinanceAccount: vi.fn(),
  getFinanceBudget: vi.fn(),
  getFinanceInbox: vi.fn(),
  getFinanceMaintenanceHistory: vi.fn(),
  getFinancePlaybook: vi.fn(),
  getFinanceSnapshot: vi.fn(),
  getFinanceStatus: vi.fn(),
  listFinanceRecurringOccurrences: vi.fn(),
  getPlaidStatus: vi.fn(),
  listFinanceAccounts: vi.fn(),
  listFinanceGoals: vi.fn(),
  manageFinanceGoal: vi.fn(),
  updateFinanceAccount: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const plaidConnectProps = vi.hoisted(() => vi.fn());
vi.mock("./plaid-connect.js", () => ({
  PlaidConnectButton: (props: unknown) => {
    plaidConnectProps(props);
    return <button type="button">Connect bank</button>;
  },
}));
const envelope = (data: unknown) => ({
  data,
  outcome: "completed",
  communication: { headline: "Loaded", requiredDisclosures: [], optionalDetails: [] },
});
const account = {
  id: "account-1",
  name: "Shared checking",
  institution: "Example Bank",
  balance: 1000,
  currencyCode: "USD",
  includeInPlanning: true,
  kind: "cash",
  kindSource: "provider",
  ownershipType: "unknown",
  ownershipShare: null,
  provider: "plaid",
  status: "connected",
  providerType: "depository",
  providerSubtype: "checking",
  lastSyncedAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T11:12:13.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  synchronization: {
    state: "current",
    message: null,
    lastSuccessAt: "2026-09-03T10:00:00.000Z",
    nextRetryAt: null,
  },
};
const goal = {
  id: "goal-1",
  name: "Emergency reserve",
  currentAmount: 200,
  targetAmount: 5000,
  deadline: null,
  priority: "high",
  status: "active",
  version: 7,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
};
function mount(page: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>{page}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  workspaceReadiness.mockReturnValue({
    manualCreationVisible: true,
    readiness: { workspaceAccessible: true },
    isPending: false,
    isError: false,
    error: null,
    reload: vi.fn(),
  });
  api.getMe.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    planningTimezone: "America/New_York",
  });
  api.getWorkspaceSettings.mockResolvedValue(resolveWorkspaceSettings("finances", {}));
  api.getFinanceConfiguration.mockResolvedValue({
    accounts: { state: "loaded", value: { accounts: [account] } },
  });
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    unavailableSources: [],
    matchEvents: [],
  });
  api.getFinanceLedgerHealth.mockResolvedValue({ balanceOnlyAccounts: 0 });
  api.getFinanceSnapshot.mockResolvedValue(
    envelope({
      asOf: "2026-09-03T12:00:00.000Z",
      cash: null,
      debt: 0,
      investments: null,
      netWorth: null,
      accounts: { current: 1, needingAttention: 0 },
      budget: { activeVersionId: null, allocated: 1000, remaining: null, spent: null },
      inbox: { awaitingInput: 0, open: 0 },
      ledger: { trustworthy: false, reconciledThrough: null },
    }),
  );
  api.getFinanceBudget.mockResolvedValue(
    envelope({
      id: "budget-1",
      planId: "plan-1",
      status: "proposed",
      version: 3,
      effectiveFrom: "2026-09",
      expectedResources: 1000,
      allocatedTotal: 1000,
      balanceDelta: 0,
      assumptions: ["Income still needs confirmation"],
      rationale: "Keep a reserve while income settles.",
      allocations: [{ key: "reserve", kind: "savings", amount: 1000 }],
      resources: [{ key: "income", kind: "income", amount: 1000 }],
    }),
  );
  api.getFinanceStatus.mockResolvedValue({
    details: {
      latestReview: null,
      cashFlow: { projectedLowestBalance: null },
      reimbursements: { outstanding: 0 },
    },
  });
  api.getFinanceInbox.mockResolvedValue(envelope([]));
  api.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { finances: 0 } },
    unavailableDomains: [],
    items: [],
    nextCursor: null,
  });
  api.getFinancePlaybook.mockResolvedValue({
    assessment: {
      blockers: ["Confirm income stability"],
      nextActions: ["Build reserves"],
      uncertainty: [],
      readiness: "incomplete",
    },
    playbook: { version: "1.0.0", steps: [] },
  });
  api.getFinanceMaintenanceHistory.mockResolvedValue({ items: [], nextCursor: null });
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    accountSemantics: {
      trustworthy: false,
      possibleDuplicateGroups: [],
      excludedAccountIds: [],
      unresolvedOwnershipAccountIds: [account.id],
    },
    totals: { cash: 1000, debt: 0, investments: 0, netWorth: 1000, otherAssets: 0 },
  });
  api.listFinanceGoals.mockResolvedValue(envelope([goal]));
  api.manageFinanceGoal.mockResolvedValue(envelope({ ...goal, status: "paused", version: 8 }));
  api.updateFinanceAccount.mockResolvedValue(
    envelope({ ...account, ownershipType: "joint", ownershipShare: 0.5 }),
  );
  api.createFinanceAccount.mockResolvedValue({ ...account, provider: "manual" });
  api.disconnectFinanceAccount.mockResolvedValue(envelope({ ...account, status: "needs_reauth" }));
});

describe("Finance position pages", () => {
  it.each([
    "prior failed key",
    "failed envelope",
  ])("keeps account corrections and renews their key after a confirmed %s", async (failure) => {
    if (failure === "prior failed key")
      api.updateFinanceAccount.mockRejectedValueOnce(
        new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
      );
    else
      api.updateFinanceAccount.mockResolvedValueOnce({ ...envelope(account), outcome: "failed" });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByText(/Couldn’t confirm whether we could save this account/);
    expect(screen.getByLabelText("Account name")).toHaveValue("Household checking");
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(api.updateFinanceAccount).toHaveBeenCalledTimes(2));
    const first = api.updateFinanceAccount.mock.calls[0]?.[1];
    const second = api.updateFinanceAccount.mock.calls[1]?.[1];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("keeps the account retry key when the network outcome is uncertain", async () => {
    api.updateFinanceAccount.mockRejectedValueOnce(new Error("Network response lost"));
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByText(/Couldn’t confirm whether we could save this account/);
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(api.updateFinanceAccount).toHaveBeenCalledTimes(2));
    expect(api.updateFinanceAccount.mock.calls[1]?.[1]).toEqual(
      api.updateFinanceAccount.mock.calls[0]?.[1],
    );
  });

  it.each([
    "prior failed key",
    "failed envelope",
  ])("keeps goal edits and renews their key after a confirmed %s", async (failure) => {
    if (failure === "prior failed key")
      api.manageFinanceGoal.mockRejectedValueOnce(
        new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
      );
    else api.manageFinanceGoal.mockResolvedValueOnce({ ...envelope(goal), outcome: "failed" });
    mount(<FinanceWealthPage />);
    expect(
      screen.getByRole("heading", { name: "Explore a hypothetical goal" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Hypothetical current amount (blank means unknown)")).toHaveValue(
      "",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Emergency reserve" }));
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "6500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await screen.findByText(/Couldn’t confirm whether we could save this goal/);
    expect(screen.getByLabelText("Target amount")).toHaveValue("6,500.00");
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() => expect(api.manageFinanceGoal).toHaveBeenCalledTimes(2));
    const first = api.manageFinanceGoal.mock.calls[0]?.[0];
    const second = api.manageFinanceGoal.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it.each([
    "prior failed key",
    "failed envelope",
    "uncertain network",
  ])("retries goal actions with the appropriate key after %s", async (failure) => {
    if (failure === "prior failed key")
      api.manageFinanceGoal.mockRejectedValueOnce(
        new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
      );
    else if (failure === "failed envelope")
      api.manageFinanceGoal.mockResolvedValueOnce({ ...envelope(goal), outcome: "failed" });
    else api.manageFinanceGoal.mockRejectedValueOnce(new Error("Network response lost"));
    mount(<FinanceWealthPage />);
    await selectGoalAction("Pause", "Emergency reserve");
    await screen.findByText(/Couldn’t .*update this goal/);
    await selectGoalAction("Pause", "Emergency reserve");
    await waitFor(() => expect(api.manageFinanceGoal).toHaveBeenCalledTimes(2));
    const first = api.manageFinanceGoal.mock.calls[0]?.[0];
    const second = api.manageFinanceGoal.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    if (failure === "uncertain network") expect(second.idempotencyKey).toBe(first.idempotencyKey);
    else expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("keeps unknown amounts unavailable and summarizes the proposed plan without duplicate context", async () => {
    api.getFinanceStatus.mockResolvedValue({
      details: {
        latestReview: null,
        cashFlow: { projectedLowestBalance: 98765 },
        reimbursements: { outstanding: 0 },
      },
    });
    mount(<FinanceOverviewPage />);
    const metrics = await screen.findByRole("region", { name: "Finance key metrics" });
    expect(within(metrics).getAllByText("Unavailable")).toHaveLength(3);
    const plan = await screen.findByRole("region", { name: "Complete plan" });
    expect(await within(plan).findByText("proposed")).toBeVisible();
    expect(within(plan).getByText("2026-09")).toBeVisible();
    expect(within(plan).getByText("$1,000.00 allocated · $0.00 unassigned")).toBeVisible();
    expect(within(plan).getByRole("link", { name: "View budget" })).toHaveAttribute(
      "href",
      "/finances/plan",
    );
    expect(screen.queryByText(/98,765/)).not.toBeInTheDocument();
    expect(screen.queryByText("Outstanding reimbursements")).not.toBeInTheDocument();
    expect(screen.queryByText("Keep a reserve while income settles.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Version 3/)).not.toBeInTheDocument();
  });

  it("keeps a failed budget source local while displaying the successful snapshot", async () => {
    api.getFinanceBudget.mockRejectedValue(new Error("private budget source failure"));
    mount(<FinanceOverviewPage />);
    const failure = await screen.findByRole("region", { name: "Complete plan unavailable" });
    expect(within(failure).getByRole("button", { name: "Try again" })).toBeVisible();
    const metrics = screen.getByRole("region", { name: "Finance key metrics" });
    expect(within(metrics).getAllByText("Unavailable")).toHaveLength(3);
    expect(await screen.findByText("No recorded changes yet.")).toBeVisible();
    expect(screen.queryByText("private budget source failure")).not.toBeInTheDocument();
    expect(screen.queryByText("No plan yet.")).not.toBeInTheDocument();
    expect(api.getFinancePlaybook).not.toHaveBeenCalled();
    api.getFinanceBudget.mockResolvedValue(envelope(null));
    fireEvent.click(within(failure).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Create plan" })).toBeVisible();
    expect(api.getFinanceBudget).toHaveBeenCalledTimes(2);
    expect(api.getFinanceSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not fetch or imply an all-clear Reviews queue in the compact Overview", async () => {
    api.listAgentAccessWorkItems.mockRejectedValue(new Error("Review service unavailable"));
    mount(<FinanceOverviewPage />);
    expect(await screen.findByRole("region", { name: "Finance key metrics" })).toBeVisible();
    expect(await screen.findByText("proposed")).toBeVisible();
    expect(screen.queryByText("Review inbox unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("No items need review")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next step" })).not.toBeInTheDocument();
    expect(api.listAgentAccessWorkItems).not.toHaveBeenCalled();
    expect(api.getFinanceInbox).not.toHaveBeenCalled();
  });

  it("links the latest recorded review and maintenance summary without duplicating their histories", async () => {
    api.getFinanceSnapshot.mockResolvedValue(
      envelope({
        asOf: account.createdAt,
        cash: 100,
        debt: 0,
        investments: 0,
        netWorth: 100,
        accounts: { current: 1, needingAttention: 0 },
        budget: { activeVersionId: "budget-1", allocated: 100, remaining: 50, spent: 50 },
        inbox: { awaitingInput: 2, open: 2 },
        ledger: { trustworthy: true, reconciledThrough: "2026-09-01" },
      }),
    );
    api.getFinanceBudget.mockResolvedValue(
      envelope({
        id: "budget-1",
        planId: "plan-1",
        status: "active",
        version: 4,
        effectiveFrom: "2026-09",
        expectedResources: 1000,
        allocatedTotal: 1000,
        balanceDelta: 0,
        assumptions: [],
        rationale: "Current plan",
        allocations: [],
        resources: [],
      }),
    );
    api.getFinanceInbox.mockResolvedValue({
      ...envelope([
        { id: "q1", status: "open" },
        { id: "q2", status: "open" },
      ]),
      communication: {
        headline: "Two questions",
        optionalDetails: [],
        requiredDisclosures: [],
        nextQuestion: { prompt: "Was this transfer yours?" },
      },
    });
    api.getFinancePlaybook.mockResolvedValue({
      assessment: {
        blockers: [],
        nextActions: ["Automate savings"],
        uncertainty: [],
        readiness: "ready",
      },
      playbook: { version: "2.0.0", steps: [] },
    });
    api.getFinanceStatus.mockResolvedValue({
      details: {
        latestReview: {
          id: "review-1",
          completedAt: account.updatedAt,
          status: "completed_with_notes",
        },
        cashFlow: { projectedLowestBalance: 100 },
        reimbursements: { outstanding: 25 },
      },
    });
    api.getFinanceMaintenanceHistory.mockResolvedValue({
      items: [
        { run: { id: "a", status: "completed" }, recovery: null, nextAction: null },
        {
          run: null,
          recovery: { legacyRunId: "b", state: "blocked", reason: "This run needs recovery." },
          nextAction: null,
        },
        {
          run: { id: "c", status: "awaiting_agent_challenge" },
          recovery: null,
          nextAction: { reason: "Check merchant" },
        },
      ],
      nextCursor: null,
    });
    mount(<FinanceOverviewPage />);
    const plan = await screen.findByRole("region", { name: "Complete plan" });
    expect(await within(plan).findByText("active")).toBeVisible();
    expect(within(plan).getByText("$1,000.00 allocated · $0.00 unassigned")).toBeVisible();
    const changes = screen.getByRole("region", { name: "What changed" });
    expect(await within(changes).findByText("Period review · completed with notes")).toBeVisible();
    expect(within(changes).getByRole("link", { name: /Sep 3, 2026/ })).toHaveAttribute(
      "href",
      "/finances/reviews/review-1",
    );
    expect(within(changes).getByText("Maintenance complete")).toBeVisible();
    expect(within(changes).getByRole("link", { name: "Open Activity" })).toHaveAttribute(
      "href",
      "/finances/activity",
    );
    expect(screen.getByText("$25.00 expected back")).toBeVisible();
    expect(screen.getByRole("link", { name: "View reimbursements" })).toHaveAttribute(
      "href",
      "/finances/cashflow?view=reimbursements",
    );
    expect(
      screen.queryByRole("button", { name: "Recent maintenance (3)" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("This run needs recovery.")).not.toBeInTheDocument();
    expect(screen.queryByText("Check merchant")).not.toBeInTheDocument();
    expect(screen.queryByText("Automate savings")).not.toBeInTheDocument();
    expect(api.getFinanceInbox).not.toHaveBeenCalled();
    expect(api.getFinancePlaybook).not.toHaveBeenCalled();
    expect(api.getFinanceMaintenanceHistory).toHaveBeenCalledWith({ limit: 3 });
  });

  it("offers empty-plan recovery without duplicating financial-profile navigation", async () => {
    api.getFinanceSnapshot.mockResolvedValue(
      envelope({
        asOf: account.createdAt,
        cash: 0,
        debt: 0,
        investments: 0,
        netWorth: 0,
        accounts: { current: 0, needingAttention: 0 },
        budget: { activeVersionId: null, allocated: 0, remaining: 0, spent: 0 },
        inbox: { awaitingInput: 0, open: 0 },
        ledger: { trustworthy: true, reconciledThrough: null },
      }),
    );
    api.getFinanceBudget.mockResolvedValue(envelope(null));
    api.getFinancePlaybook.mockResolvedValue({
      assessment: { blockers: [], nextActions: [], uncertainty: [], readiness: "ready" },
      playbook: { version: "2.0.0", steps: [] },
    });
    mount(<FinanceOverviewPage />);
    const plan = await screen.findByRole("region", { name: "Complete plan" });
    expect(await within(plan).findByText("No plan yet.")).toBeVisible();
    expect(within(plan).getByRole("link", { name: "Create plan" })).toHaveAttribute(
      "href",
      "/finances/plan",
    );
    expect(screen.getByRole("region", { name: "Finance key metrics" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Update financial profile" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next step" })).not.toBeInTheDocument();
    expect(api.getFinancePlaybook).not.toHaveBeenCalled();
  });

  it("saves joint ownership with the exact account revision and an idempotency key", async () => {
    let finishUpdate: ((value: unknown) => void) | undefined;
    api.updateFinanceAccount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpdate = resolve;
        }),
    );
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Ownership"), { target: { value: "joint" } });
    fireEvent.change(screen.getByLabelText("Your ownership share (%)"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() =>
      expect(api.updateFinanceAccount).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          ownershipType: "joint",
          ownershipShare: 0.5,
          expectedUpdatedAt: account.updatedAt,
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "Saving account…" })).toBeDisabled();
    expect(api.updateFinanceAccount.mock.calls[0]?.[1]).not.toHaveProperty("balance");
    expect(api.updateFinanceAccount.mock.calls[0]?.[1]).not.toHaveProperty("kind");
    finishUpdate?.(envelope({ ...account, ownershipType: "joint", ownershipShare: 0.5 }));
  });

  it("shows a confirmed ownership share when opening an account", async () => {
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [{ ...account, ownershipType: "joint", ownershipShare: 0.5 }],
      accountSemantics: {
        trustworthy: true,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [],
      },
      totals: { cash: 500, debt: 0, investments: 0, netWorth: 500, otherAssets: 0 },
    });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    expect(screen.getByLabelText("Your ownership share (%)")).toHaveValue(50);
  });

  it("shows the empty account state with its missing-evidence warning", async () => {
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [],
      accountSemantics: {
        trustworthy: false,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    expect(await screen.findByText("No accounts tracked")).toBeVisible();
    expect(screen.queryByText("Account interpretation needs attention")).not.toBeInTheDocument();
  });

  it("lets the signed-in person confirm provider account disconnection", async () => {
    let finishDisconnect: ((value: unknown) => void) | undefined;
    api.disconnectFinanceAccount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDisconnect = resolve;
        }),
    );
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    expect(screen.getByText(/nohmi will stop using this account locally/)).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByText(/nohmi will stop using this account locally/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(
      screen.queryByText(/nohmi will stop using this account locally/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    expect(screen.getByText(/Plaid may continue sending this account's data/)).toBeVisible();
    expect(screen.getByText(/This does not revoke access at your institution/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    await waitFor(() =>
      expect(api.disconnectFinanceAccount).toHaveBeenCalledWith(account.id, {
        idempotencyKey: expect.any(String),
      }),
    );
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep connected" })).toBeDisabled();
    expect(screen.getByText("Cancel").closest("button")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeVisible();
    finishDisconnect?.(envelope({ ...account, status: "needs_reauth" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop tracking account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it.each([
    "finance_account_disconnected",
    "finance_account_legacy_disconnected",
  ])("does not offer disconnection for an account already marked %s", async (failureCode) => {
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [{ ...account, synchronization: { ...account.synchronization, failureCode } }],
      accountSemantics: {
        trustworthy: false,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [account.id],
      },
      totals: { cash: 1000, debt: 0, investments: 0, netWorth: 1000, otherAssets: 0 },
    });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    expect(screen.queryByRole("button", { name: "Stop tracking account" })).not.toBeInTheDocument();
  });

  it.each([
    "manual",
    "paypal",
    "venmo",
    "zelle",
  ])("does not offer Provider Item disconnection for a %s account", async (provider) => {
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [{ ...account, provider }],
      accountSemantics: {
        trustworthy: false,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [account.id],
      },
      totals: { cash: 1000, debt: 0, investments: 0, netWorth: 1000, otherAssets: 0 },
    });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    expect(screen.queryByRole("button", { name: "Stop tracking account" })).not.toBeInTheDocument();
  });

  it.each([
    "confirmed",
    "application rejection",
    "server failure",
    "uncertain",
  ])("retries a %s account disconnection with the safe idempotency key", async (failure) => {
    if (failure === "confirmed")
      api.disconnectFinanceAccount.mockResolvedValueOnce({
        ...envelope(account),
        outcome: "failed",
        communication: {
          headline: "Disconnection rejected",
          requiredDisclosures: [],
          optionalDetails: [],
        },
      });
    else if (failure === "application rejection")
      api.disconnectFinanceAccount.mockRejectedValueOnce(
        new ApiClientError({ code: "conflict", message: "Synchronization active", status: 409 }),
      );
    else if (failure === "server failure")
      api.disconnectFinanceAccount.mockRejectedValueOnce(
        new ApiClientError({ code: "internal_error", message: "Response failed", status: 503 }),
      );
    else api.disconnectFinanceAccount.mockRejectedValueOnce(new Error("Network response lost"));
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    expect(await screen.findByText(/Couldn’t .*disconnect this account/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking account" }));
    await waitFor(() => expect(api.disconnectFinanceAccount).toHaveBeenCalledTimes(2));
    const firstKey = api.disconnectFinanceAccount.mock.calls[0]?.[1].idempotencyKey;
    const secondKey = api.disconnectFinanceAccount.mock.calls[1]?.[1].idempotencyKey;
    if (failure === "confirmed" || failure === "application rejection")
      expect(secondKey).not.toBe(firstKey);
    else expect(secondKey).toBe(firstKey);
  });

  it("preserves an account correction after a conflict", async () => {
    api.updateFinanceAccount.mockRejectedValue(
      new ApiClientError({
        code: "conflict",
        message: "Account changed. Reload before saving.",
        status: 409,
      }),
    );
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect(
      await screen.findByText(/This item changed or is no longer available/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("Household checking");
    expect(api.updateFinanceAccount).toHaveBeenCalledTimes(1);
  });

  it("creates manual tracking without inventing a balance", async () => {
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add in Finances" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Cash reserve" } });
    fireEvent.change(screen.getByLabelText("Institution"), {
      target: { value: "Personal records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() =>
      expect(api.createFinanceAccount).toHaveBeenCalledWith({
        name: "Cash reserve",
        currencyCode: null,
        institution: "Personal records",
        provider: "manual",
        kind: "cash",
        balance: null,
      }),
    );
  });

  it("keeps manual account creation open while the request is pending", async () => {
    let finishCreate: ((value: unknown) => void) | undefined;
    api.createFinanceAccount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        }),
    );
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add in Finances" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Cash reserve" } });
    fireEvent.change(screen.getByLabelText("Institution"), {
      target: { value: "Personal records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByRole("button", { name: "Adding account…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const pendingNotice = vi
      .mocked(toast.loading)
      .mock.calls.find(([message]) => message === "Adding account…")?.[1]?.id;
    expect(pendingNotice).toEqual(expect.any(String));
    finishCreate?.({ ...account, id: "manual-pending", provider: "manual" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Adding account…" })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Account added", { id: pendingNotice }),
    );
    expect(screen.getByText("Account added").closest("[data-sonner-toast]")).not.toBeNull();
  });

  it("edits manual account semantics and keeps failed account creation recoverable", async () => {
    const manual = {
      ...account,
      id: "manual-account",
      name: "Cash box",
      provider: "manual",
      balance: null,
      currencyCode: null,
      ownershipType: "unknown",
      ownershipShare: null,
    };
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [manual],
      accountSemantics: {
        trustworthy: false,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [manual.id],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    });
    api.createFinanceAccount.mockRejectedValueOnce(new Error("Manual account unavailable"));
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Cash box" }));
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Home safe" } });
    fireEvent.change(screen.getByLabelText("Account kind"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Ownership"), { target: { value: "individual" } });
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "125.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() =>
      expect(api.updateFinanceAccount).toHaveBeenCalledWith(
        manual.id,
        expect.objectContaining({
          balance: 125.5,
          institution: "Home safe",
          kind: "other",
          ownershipShare: 1,
          ownershipType: "individual",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add in Finances" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Reserve" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Household" } });
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn’t confirm whether we could create this account/),
        expect.objectContaining({ id: expect.any(String) }),
      ),
    );
    expect(
      screen
        .getByText(/Couldn’t confirm whether we could create this account/)
        .closest("[data-sonner-toast]"),
    ).not.toBeNull();
    expect(api.createFinanceAccount).toHaveBeenCalledWith(expect.objectContaining({ balance: 42 }));
  });

  it("uses snapshot wealth instead of unqualified account totals and versions goal actions", async () => {
    mount(<FinanceWealthPage />);
    const position = await screen.findByRole("region", { name: "Wealth key metrics" });
    expect(within(position).getAllByText("Unavailable")).toHaveLength(3);
    expect(within(position).queryByText("$1,000.00")).not.toBeInTheDocument();
    await selectGoalAction("Pause", "Emergency reserve");
    await waitFor(() =>
      expect(api.manageFinanceGoal).toHaveBeenCalledWith({
        operation: "pause",
        goalId: goal.id,
        expectedVersion: 7,
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("creates a real goal with an optional deadline", async () => {
    mount(<FinanceWealthPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Goal name"), {
      target: { value: "Home deposit" },
    });
    fireEvent.change(within(dialog).getByLabelText("Target amount"), {
      target: { value: "12500.50" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create goal" }));
    await waitFor(() =>
      expect(api.manageFinanceGoal).toHaveBeenCalledWith({
        operation: "create",
        name: "Home deposit",
        targetAmount: 12500.5,
        priority: "medium",
        deadline: null,
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("keeps a failed goal edit and retries the same version and key", async () => {
    api.manageFinanceGoal.mockRejectedValue(new Error("Goal changed. Reload it."));
    mount(<FinanceWealthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Emergency reserve" }));
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "6500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await screen.findByText(/Couldn’t confirm whether we could save this goal/);
    expect(screen.getByLabelText("Target amount")).toHaveValue("6,500.00");
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await waitFor(() => expect(api.manageFinanceGoal).toHaveBeenCalledTimes(2));
    expect(api.manageFinanceGoal.mock.calls[1]?.[0]).toEqual(
      api.manageFinanceGoal.mock.calls[0]?.[0],
    );
    expect(api.manageFinanceGoal.mock.calls[0]?.[0]).toMatchObject({
      operation: "update",
      expectedVersion: 7,
      goalId: goal.id,
      changes: { targetAmount: 6500 },
    });
  });

  it("shows duplicate records and lets a user exclude one from planning", async () => {
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [
        account,
        { ...account, id: "account-2", name: "Imported checking", provider: "manual" },
      ],
      accountSemantics: {
        trustworthy: false,
        possibleDuplicateGroups: [{ accountIds: ["account-1", "account-2"] }],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [account.id],
      },
      totals: { cash: 2000 },
    });
    mount(
      <>
        <FinanceCreateButton />
        <FinanceAccountsPage />
      </>,
    );
    expect(await screen.findByText(/Possible duplicate of Imported checking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Shared checking" }));
    fireEvent.click(screen.getByLabelText("Include in planning"));
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() =>
      expect(api.updateFinanceAccount).toHaveBeenCalledWith(account.id, {
        includeInPlanning: false,
        expectedUpdatedAt: account.updatedAt,
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("keeps real goal records available when wealth evidence fails", async () => {
    api.getFinanceSnapshot.mockRejectedValue(new Error("Snapshot unavailable"));
    mount(<FinanceWealthPage />);
    expect(await screen.findByText("Wealth snapshot unavailable")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Edit Emergency reserve" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Ownership-qualified wealth" }),
    ).not.toBeInTheDocument();
  });

  it("renders paused, completed, dated, and low-priority goals with guarded actions", async () => {
    api.listFinanceGoals.mockResolvedValue(
      envelope([
        {
          ...goal,
          id: "paused",
          name: "Paused goal",
          status: "paused",
          priority: "medium",
          deadline: "2026-12-01",
        },
        { ...goal, id: "done", name: "Done goal", status: "completed", priority: "low" },
        { ...goal, id: "removed", name: "Removed goal", status: "removed" },
      ]),
    );
    api.listFinanceAccounts.mockResolvedValue({
      accounts: [],
      accountSemantics: {
        trustworthy: true,
        possibleDuplicateGroups: [],
        excludedAccountIds: [],
        unresolvedOwnershipAccountIds: [],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    });
    mount(<FinanceWealthPage />);
    expect(await screen.findByText("Paused")).toBeVisible();
    expect(screen.getByText(/Medium priority · Due 2026-12-01/)).toBeVisible();
    expect(screen.getByText(/Low priority · No deadline/)).toBeVisible();
    expect(screen.queryByText("Removed goal")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage accounts" })).not.toBeInTheDocument();
    await selectGoalAction("Resume", "Paused goal");
    await waitFor(() =>
      expect(api.manageFinanceGoal).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "resume" }),
      ),
    );
    await selectGoalAction("Remove", "Done goal");
    expect(screen.getByRole("dialog", { name: "Remove goal" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await selectGoalAction("Complete", "Paused goal");
    expect(screen.getByRole("dialog", { name: "Complete goal" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm completion" }));
    await waitFor(() =>
      expect(api.manageFinanceGoal).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "complete" }),
      ),
    );
  });

  it("presents every account evidence state and source recovery without inventing values", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const variants = [
      {
        ...account,
        id: "cash-manual",
        name: "Cash manual",
        balance: null,
        currencyCode: null,
        includeInPlanning: false,
        ownershipType: "individual",
        ownershipShare: 1,
        provider: "manual",
        lastSyncedAt: null,
        synchronization: {
          state: "stale",
          message: "Refresh it",
          lastSuccessAt: null,
          nextRetryAt: account.createdAt,
        },
      },
      {
        ...account,
        id: "investment",
        name: "Investment",
        kind: "investment",
        ownershipType: "joint",
        ownershipShare: 1,
        status: "needs_reauth",
        synchronization: { ...account.synchronization, state: "blocked" },
      },
      {
        ...account,
        id: "debt",
        name: "Debt",
        kind: "debt",
        currencyCode: null,
        synchronization: { ...account.synchronization, state: "retrying" },
      },
      { ...account, id: "asset", name: "Asset", kind: "other_asset" },
    ];
    mount(
      <>
        <FinanceSourceState
          label="Position"
          query={{ isPending: true, isError: false, error: null, refetch }}
        />
        <FinanceSourceState
          label="Accounts"
          query={{ isPending: false, isError: true, error: new Error("Offline"), refetch }}
        />
        <FinanceSourceState
          label="Ready"
          query={{ isPending: false, isError: false, error: null, refetch }}
        />
        <ul>
          {variants.map((record, index) => (
            <FinanceAccountRecord
              account={record as never}
              duplicateNames={index === 0 ? ["Old cash"] : []}
              key={record.id}
              {...(index === 0 ? { onEdit } : {})}
            />
          ))}
        </ul>
        <FinancePositionMaterial
          result={
            {
              ...envelope({
                asOf: account.createdAt,
                cash: 50,
                debt: 10,
                investments: 20,
                netWorth: 60,
                budget: { spent: 5 },
                ledger: { trustworthy: true, reconciledThrough: "2026-09-01" },
              }),
              communication: {
                headline: "Loaded",
                optionalDetails: [],
                requiredDisclosures: [{ message: "One balance is estimated." }],
              },
            } as never
          }
          wealth
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Account options for Cash manual" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Cash manual" }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByText("One balance is estimated.")).toBeInTheDocument();
    expect(financeAmount(null)).toBe("Unavailable");
    expect(
      accountOwnership({
        ...account,
        ownershipType: "individual",
        ownershipShare: 0.3333,
      } as never),
    ).toBe("Individual · 33.33% yours");
    expect(
      accountOwnership({ ...account, ownershipType: "unknown", ownershipShare: null } as never),
    ).toBe("Ownership needs confirmation");
    expect(() =>
      requireFinanceResult({
        ...envelope(null),
        outcome: "failed",
        communication: { headline: "No result", optionalDetails: [], requiredDisclosures: [] },
      } as never),
    ).toThrow("No result");
  });
});

it.each([
  "proposed",
  "active",
])("summarizes a %s plan and keeps trustworthy evidence in the totals disclosure", async (status) => {
  const snapshot = await api.getFinanceSnapshot();
  const plan = await api.getFinanceBudget();
  api.getFinanceSnapshot.mockResolvedValue({
    ...snapshot,
    data: { ...snapshot.data, ledger: { ...snapshot.data.ledger, trustworthy: true } },
  });
  api.getFinanceBudget.mockResolvedValue({ ...plan, data: { ...plan.data, status } });
  mount(<FinanceOverviewPage />);
  const summary = await screen.findByRole("region", { name: "Complete plan" });
  expect(await within(summary).findByText(status)).toBeVisible();
  expect(within(summary).getByText("$1,000.00 allocated · $0.00 unassigned")).toBeVisible();
  expect(within(summary).getByRole("link", { name: "View budget" })).toHaveAttribute(
    "href",
    "/finances/plan",
  );
  expect(screen.queryByRole("region", { name: "Next step" })).not.toBeInTheDocument();
  expect(screen.queryByText("Current evidence")).not.toBeInTheDocument();
  const totals = screen.getByRole("button", { name: "About these totals" });
  expect(totals).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(totals);
  expect(totals).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Current evidence")).toBeVisible();
  expect(screen.getByRole("link", { name: "Review accounts" })).toHaveAttribute(
    "href",
    "/finances/accounts",
  );
});

it("keeps account evidence visible when its refresh fails and allows source-specific recovery", async () => {
  const snapshot = await api.getFinanceSnapshot();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["finance-snapshot"], snapshot);
  api.getFinanceSnapshot.mockClear();
  api.getFinanceSnapshot
    .mockRejectedValueOnce(new Error("private snapshot refresh failure"))
    .mockResolvedValue(snapshot);
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <FinanceOverviewPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.queryByText(/Showing the last available update/)).not.toBeInTheDocument();
  const metrics = screen.getByRole("region", { name: "Finance key metrics" });
  expect(within(metrics).getAllByText("Unavailable")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "About these totals" }));
  expect(screen.getByText("Partial evidence")).toBeVisible();
  expect(client.getQueryData(["finance-snapshot"])).toEqual(snapshot);
  expect(api.getFinanceSnapshot).toHaveBeenCalledTimes(1);
  const retryAction = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action as Action;
  await act(async () => retryAction.onClick({} as Parameters<Action["onClick"]>[0]));
  await waitFor(() => expect(api.getFinanceSnapshot).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(client.getQueryState(["finance-snapshot"])?.status).toBe("success"));
  expect(client.getQueryData(["finance-snapshot"])).toEqual(snapshot);
  expect(within(metrics).getAllByText("Unavailable")).toHaveLength(3);
  await waitFor(() =>
    expect(screen.queryByText("Financial position unavailable")).not.toBeInTheDocument(),
  );
});

it("retries account coverage and syncs an account with blocked evidence", async () => {
  api.getFinanceLedgerHealth
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({ balanceOnlyAccounts: 1 });
  const response = await api.listFinanceAccounts();
  api.listFinanceAccounts.mockResolvedValue({
    ...response,
    accounts: [{ ...account, synchronization: { ...account.synchronization, state: "blocked" } }],
  });
  api.syncFinanceAccount.mockResolvedValue({});
  mount(<FinanceAccountsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/1 balance-only account/)).toBeVisible();
  const syncAction = screen.getByRole("button", { name: `Sync ${account.name}` });
  expect(syncAction.textContent?.trim()).toBe("");
  fireEvent.click(syncAction);
  await waitFor(() => expect(api.syncFinanceAccount).toHaveBeenCalledWith(account.id));
  await waitFor(() => expect(api.listFinanceAccounts.mock.calls.length).toBeGreaterThan(2));
});
it("reloads the latest account after a conflict before another edit", async () => {
  api.updateFinanceAccount.mockRejectedValue(
    new ApiClientError({ code: "conflict", message: "Changed", status: 409 }),
  );
  mount(<FinanceAccountsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "My draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save account" }));
  await screen.findByText(/This item changed or is no longer available/);
  const response = await api.listFinanceAccounts();
  api.listFinanceAccounts.mockResolvedValue({
    ...response,
    accounts: [{ ...account, name: "New server name", updatedAt: "2026-10-06T12:00:00Z" }],
  });
  fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
  await waitFor(() => expect(screen.getByLabelText("Account name")).toHaveValue("New server name"));
});

// Canonical entry remains reachable regardless of financial snapshot readiness.
it.each([
  "partial",
  "failed",
])("discovers workspace view settings on the actual %s Finance overview", async (state) => {
  if (state === "failed")
    api.getFinanceSnapshot.mockRejectedValue(new Error("Snapshot unavailable"));
  mount(<FinanceOverviewPage />);
  // Authenticated identity settles before opening the owner-bound settings controls.
  await screen.findByText("No unmatched scheduled money in this date range.");
  const entry = screen.getByRole("button", { name: "Workspace view settings" });
  expect(entry).toBeVisible();
  fireEvent.click(entry);
  expect(screen.getByText(/Saved account display selections do not change/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open Finance settings" })).toHaveAttribute(
    "href",
    "/settings?page=finances",
  );
  if (state === "failed") {
    expect(
      await screen.findByRole("region", { name: "Financial position unavailable" }),
    ).toBeVisible();
  } else {
    const metrics = await screen.findByRole("region", { name: "Finance key metrics" });
    expect(within(metrics).getAllByText("Unavailable")).toHaveLength(3);
  }
  expect(entry).toBeVisible();
});

it("retains account correction and bank linking while manual capture and imports are hidden", async () => {
  workspaceReadiness.mockReturnValue({
    manualCreationVisible: false,
    readiness: { workspaceAccessible: true },
    isPending: false,
    isError: false,
    reload: vi.fn(),
  });
  mount(<FinanceAccountsPage />);
  expect(await screen.findByRole("button", { name: "Edit Shared checking" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Import records" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit Shared checking" }));
  expect(screen.getByLabelText("Ownership")).toBeEnabled();
});

it.each([
  "USD",
  "EUR",
])("passes explicitly stated %s manual currency without guessing", async (currencyCode) => {
  mount(<FinanceCreateButton />);
  fireEvent.click(screen.getByRole("button", { name: "Add in Finances" }));
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
  expect(screen.getByLabelText("Currency code")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Travel cash" } });
  fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Personal records" } });
  fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: currencyCode } });
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  await waitFor(() =>
    expect(api.createFinanceAccount).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCode, balance: null }),
    ),
  );
});

it("confirms previously unknown goal progress and consumes refreshed canonical evidence in the connected explorer", async () => {
  const goalId = "22222222-2222-4222-8222-222222222222";
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const legacy = { ...goal, id: goalId, currentAmount: 0 };
  const confirmed = {
    ...legacy,
    version: 8,
    planningEvidence: {
      kind: "goal",
      evidenceId: "33333333-3333-4333-8333-333333333333",
      ownerUserId,
      actor: { type: "user", userId: ownerUserId },
      provenance: "explicit_user",
      currencyCode: "EUR",
      asOf: "2026-01-01",
      recordedAt: "2026-01-01T12:00:00Z",
      goalId,
      goalVersion: 8,
      progressAmountCents: 0,
    },
  };
  api.listFinanceGoals.mockResolvedValue(envelope([legacy]));
  api.manageFinanceGoal.mockImplementation(async () => {
    api.listFinanceGoals.mockResolvedValue(envelope([confirmed]));
    return envelope(confirmed);
  });
  mount(<FinanceWealthPage />);
  expect(
    await screen.findByText(/Progress and currency unknown · Recorded target 5000/),
  ).toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm progress for Emergency reserve" }),
  );
  fireEvent.change(screen.getByLabelText("Current goal amount you confirm"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Currency for the whole goal"), {
    target: { value: "EUR" },
  });
  fireEvent.change(screen.getByLabelText("Progress statement as-of date"), {
    target: { value: "2026-01-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm my progress statement" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.manageFinanceGoal).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "confirm_progress",
      goalId,
      expectedVersion: 7,
      progressAmountCents: 0,
      currencyCode: "EUR",
      asOf: "2026-01-01",
    }),
  );
  expect(
    await screen.findByText("Your statement as of 2026-01-01 · Version 8"),
  ).toBeInTheDocument();
  expect(api.listFinanceGoals.mock.calls.length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole("button", { name: "Explore Emergency reserve" }));
  expect(screen.getByLabelText("Confirmed goal progress")).toHaveValue("0");
  expect(screen.getByLabelText("Confirmed goal currency")).toHaveValue("EUR");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Explore a separate hypothetical goal" }));
  expect(screen.getByLabelText("Hypothetical current amount (blank means unknown)")).toHaveValue(
    "",
  );
  expect(api.manageFinanceGoal).toHaveBeenCalledTimes(1);
});

it("withholds saved-goal confirmation when authenticated planning context cannot be loaded", async () => {
  api.getMe.mockRejectedValue(new Error("Session unavailable"));
  mount(<FinanceWealthPage />);
  expect(await screen.findByText("Goal confirmation context unavailable")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirm progress for Emergency reserve" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Explore Emergency reserve" })).toBeDisabled();
  expect(screen.getByLabelText("Projection as-of local date")).toHaveValue("");
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
});

it.each([
  "goals",
  "me",
])("suppresses cached saved-goal evidence and dismisses confirmation after an authoritative %s denial", async (deniedRead) => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const goalId = "22222222-2222-4222-8222-222222222222";
  const confirmed = {
    ...goal,
    id: goalId,
    currentAmount: 0,
    planningEvidence: {
      kind: "goal",
      evidenceId: "33333333-3333-4333-8333-333333333333",
      ownerUserId,
      actor: { type: "user", userId: ownerUserId },
      provenance: "explicit_user",
      currencyCode: "EUR",
      asOf: "2026-01-01",
      recordedAt: "2026-01-01T12:00:00Z",
      goalId,
      goalVersion: 7,
      progressAmountCents: 0,
    },
  };
  api.listFinanceGoals.mockResolvedValue(envelope([confirmed]));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <FinanceWealthPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Explore Emergency reserve" }));
  expect(screen.getByLabelText("Confirmed goal currency")).toHaveValue("EUR");
  fireEvent.click(screen.getByRole("button", { name: "Reconfirm saved progress" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  const denial = new ApiClientError({ code: "forbidden", message: "Access revoked", status: 403 });
  if (deniedRead === "goals") api.listFinanceGoals.mockRejectedValue(denial);
  else api.getMe.mockRejectedValue(denial);
  await act(async () => {
    await client.invalidateQueries({ queryKey: [deniedRead === "goals" ? "finance-goals" : "me"] });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(
    screen.queryByRole("button", { name: "Explore Emergency reserve" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirmed goal progress")).not.toBeInTheDocument();
  expect(screen.queryByText(/Your statement as of/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Confirmed by you as of/)).not.toBeInTheDocument();
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
  api.listFinanceGoals.mockResolvedValue(envelope([confirmed]));
  api.getMe.mockResolvedValue({ id: ownerUserId, planningTimezone: "America/New_York" });
  await act(async () => {
    await client.invalidateQueries({ queryKey: [deniedRead === "goals" ? "finance-goals" : "me"] });
  });
  await screen.findByRole("button", { name: "Explore Emergency reserve" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirmed goal progress")).not.toBeInTheDocument();
});

it.each([
  "goals",
  "me",
])("retains saved-goal evidence and confirmation draft after a transient %s read failure", async (failedRead) => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const goalId = "22222222-2222-4222-8222-222222222222";
  api.listFinanceGoals.mockResolvedValue(
    envelope([
      {
        ...goal,
        id: goalId,
        currentAmount: 0,
        planningEvidence: {
          kind: "goal",
          evidenceId: "33333333-3333-4333-8333-333333333333",
          ownerUserId,
          actor: { type: "user", userId: ownerUserId },
          provenance: "explicit_user",
          currencyCode: "EUR",
          asOf: "2026-01-01",
          recordedAt: "2026-01-01T12:00:00Z",
          goalId,
          goalVersion: 7,
          progressAmountCents: 0,
        },
      },
    ]),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <FinanceWealthPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Explore Emergency reserve" }));
  fireEvent.click(screen.getByRole("button", { name: "Reconfirm saved progress" }));
  fireEvent.change(screen.getByLabelText("Current goal amount you confirm"), {
    target: { value: "123" },
  });
  const failure = new ApiClientError({
    code: "internal_error",
    message: "Temporary service failure",
    status: 503,
  });
  if (failedRead === "goals") api.listFinanceGoals.mockRejectedValue(failure);
  else api.getMe.mockRejectedValue(failure);
  await act(async () => {
    await client.invalidateQueries({ queryKey: [failedRead === "goals" ? "finance-goals" : "me"] });
  });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Current goal amount you confirm")).toHaveValue("123");
  expect(screen.getByLabelText("Confirmed goal currency")).toHaveValue("EUR");
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
});

it("waits for initial owner identity before exposing Overview view settings", async () => {
  let finishMe: ((value: unknown) => void) | undefined;
  api.getMe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishMe = resolve;
      }),
  );
  api.getWorkspaceSettings.mockResolvedValue({
    workspace: "finances",
    revision: 1,
    preferences: {},
  });
  api.getFinanceConfiguration.mockResolvedValue({
    accounts: { state: "loaded", value: { accounts: [account] } },
  });
  mount(<FinanceOverviewPage />);
  await screen.findByRole("region", { name: "Finance key metrics" });
  expect(screen.queryByRole("button", { name: "Workspace view settings" })).not.toBeInTheDocument();
  await act(async () => finishMe?.({ id: "owner-a", planningTimezone: "America/New_York" }));
  const entry = await screen.findByRole("button", { name: "Workspace view settings" });
  fireEvent.click(entry);
  await screen.findByRole("button", { name: "Cash account view selections" });
  expect(entry).toHaveAttribute("aria-expanded", "true");
  await waitFor(() => expect(api.getFinanceConfiguration).toHaveBeenCalled());
  expect(entry).toBeVisible();
  expect(screen.getByRole("link", { name: "Open Finance settings" })).toBeVisible();
});

it("exposes direct account actions and labels debt as an amount owed", async () => {
  const response = await api.listFinanceAccounts();
  api.listFinanceAccounts.mockResolvedValue({
    ...response,
    accounts: [{ ...account, kind: "debt" }],
  });
  mount(<FinanceAccountsPage />);
  expect(await screen.findByText("Amount owed")).toHaveClass("text-destructive");
  expect(screen.getByRole("button", { name: "Edit Shared checking" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Transactions for Shared checking" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit Shared checking" }));
  expect(screen.getByLabelText("Include in planning")).toBeChecked();
});

it("opens comparison from a duplicate account row and restricts keep choices to its group", async () => {
  const response = await api.listFinanceAccounts();
  api.listFinanceAccounts.mockResolvedValue({
    ...response,
    accounts: [
      account,
      { ...account, id: "account-2", name: "Replacement checking" },
      { ...account, id: "account-3", name: "Unrelated checking" },
    ],
    accountSemantics: {
      ...response.accountSemantics,
      possibleDuplicateGroups: [{ accountIds: [account.id, "account-2"] }],
    },
  });
  mount(<FinanceAccountsPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Compare duplicates for Shared checking" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("option", { name: /Replacement checking/ })).toBeVisible();
  expect(
    within(dialog).queryByRole("option", { name: /Unrelated checking/ }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Preview comparison" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it.each([
  "finance_account_disconnected",
  "finance_account_legacy_disconnected",
  "ITEM_LOGIN_REQUIRED",
])("routes %s to the expected bank consent mode", async (failureCode) => {
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [
      {
        ...account,
        provider: "plaid",
        status: "needs_reauth",
        synchronization: {
          ...account.synchronization,
          state: "blocked",
          recovery: "reconnect",
          failureCode,
        },
      },
    ],
    accountSemantics: {
      trustworthy: false,
      possibleDuplicateGroups: [],
      excludedAccountIds: [],
      unresolvedOwnershipAccountIds: [],
    },
    totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
  });
  mount(<FinanceAccountsPage />);
  await screen.findByRole("button", { name: "Connect bank" });
  expect(plaidConnectProps).toHaveBeenCalledWith(
    expect.objectContaining({ label: `Reconnect ${account.name}`, iconOnly: true }),
  );
  expect(
    plaidConnectProps.mock.calls
      .filter(([props]) => props.label === `Reconnect ${account.name}`)
      .every(
        ([props]) =>
          props.accountId === (failureCode === "ITEM_LOGIN_REQUIRED" ? account.id : undefined),
      ),
  ).toBe(true);
});
