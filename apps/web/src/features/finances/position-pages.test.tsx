// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

const api = vi.hoisted(() => ({
  createFinanceAccount: vi.fn(),
  getFinanceBudget: vi.fn(),
  getFinanceInbox: vi.fn(),
  getFinanceMaintenanceHistory: vi.fn(),
  getFinancePlaybook: vi.fn(),
  getFinanceSnapshot: vi.fn(),
  getFinanceStatus: vi.fn(),
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
vi.mock("./plaid-connect.js", () => ({
  PlaidConnectButton: () => <button type="button">Connect bank</button>,
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
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
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
    mount(<FinanceAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByText("Account was not saved");
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
    mount(<FinanceAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByText("Account was not saved");
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
    fireEvent.click(await screen.findByRole("button", { name: "Edit Emergency reserve" }));
    fireEvent.change(screen.getByLabelText("Target amount (USD)"), { target: { value: "6500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await screen.findByText("Goal was not saved");
    expect(screen.getByLabelText("Target amount (USD)")).toHaveValue(6500);
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
    fireEvent.click(await screen.findByRole("button", { name: "Pause Emergency reserve" }));
    await screen.findByText("Goal was not changed");
    fireEvent.click(screen.getByRole("button", { name: "Pause Emergency reserve" }));
    await waitFor(() => expect(api.manageFinanceGoal).toHaveBeenCalledTimes(2));
    const first = api.manageFinanceGoal.mock.calls[0]?.[0];
    const second = api.manageFinanceGoal.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    if (failure === "uncertain network") expect(second.idempotencyKey).toBe(first.idempotencyKey);
    else expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("keeps unknown amounts unavailable and exposes the complete proposed plan", async () => {
    api.getFinanceStatus.mockResolvedValue({
      details: {
        latestReview: null,
        cashFlow: { projectedLowestBalance: 98765 },
        reimbursements: { outstanding: 0 },
      },
    });
    mount(<FinanceOverviewPage />);
    expect(await screen.findByRole("link", { name: "Inspect forecast" })).toHaveAttribute(
      "href",
      "/finances/cashflow",
    );
    expect(screen.queryByText(/98,765/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect reimbursements" })).toHaveAttribute(
      "href",
      "/finances/cashflow?view=reimbursements",
    );
    const position = await screen.findByRole("region", { name: "Financial position" });
    expect(within(position).getAllByText("Unavailable")).toHaveLength(3);
    expect(await screen.findByText("Proposed · Version 3")).toBeInTheDocument();
    expect(screen.getByText("Keep a reserve while income settles.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect complete plan" })).toHaveAttribute(
      "href",
      "/finances/plan",
    );
  });

  it("keeps a failed source local while displaying the successful snapshot", async () => {
    api.getFinancePlaybook.mockRejectedValue(new Error("Priorities source offline"));
    mount(<FinanceOverviewPage />);
    expect(await screen.findByText("Priorities source offline")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Financial position" })).toBeInTheDocument();
    expect(screen.getByText("Proposed · Version 3")).toBeInTheDocument();
  });

  it("routes an open review question and exposes recent review and maintenance evidence", async () => {
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
        { runId: "a", stage: "settled", reviewQuestion: null },
        { runId: "b", stage: "failed", reviewQuestion: null },
        { runId: "c", stage: "agent_audit", reviewQuestion: { prompt: "Check merchant" } },
      ],
      nextCursor: null,
    });
    mount(<FinanceOverviewPage />);
    expect(await screen.findByText("Outstanding (2)")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Review item" })).toHaveLength(2);
    expect(screen.getByText("Active · Version 4")).toBeVisible();
    expect(screen.getByText("Automate savings")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open review" })).toHaveAttribute(
      "href",
      "/finances/reviews/review-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Recent maintenance (3)" }));
    expect(screen.getByText("The recorded maintenance run settled.")).toBeVisible();
    expect(screen.getByText("This run needs recovery.")).toBeVisible();
    expect(screen.getByText("Check merchant")).toBeVisible();
  });

  it("offers setup and empty-plan recovery when saved finance context is current", async () => {
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
    expect(await screen.findByRole("link", { name: "Resume setup" })).toHaveAttribute(
      "href",
      "/finances/setup",
    );
    expect(await screen.findByRole("link", { name: "Create plan" })).toBeVisible();
  });

  it("saves joint ownership with the exact account revision and an idempotency key", async () => {
    mount(<FinanceAccountsPage />);
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
    expect(api.updateFinanceAccount.mock.calls[0]?.[1]).not.toHaveProperty("balance");
    expect(api.updateFinanceAccount.mock.calls[0]?.[1]).not.toHaveProperty("kind");
  });

  it("preserves an account correction after a conflict", async () => {
    api.updateFinanceAccount.mockRejectedValue(new Error("Account changed. Reload before saving."));
    mount(<FinanceAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Shared checking" }));
    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "Household checking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByText("Account changed. Reload before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("Household checking");
    expect(api.updateFinanceAccount).toHaveBeenCalledTimes(1);
  });

  it("creates manual tracking without inventing a balance", async () => {
    mount(<FinanceAccountsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Cash reserve" } });
    fireEvent.change(screen.getByLabelText("Institution"), {
      target: { value: "Personal records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() =>
      expect(api.createFinanceAccount).toHaveBeenCalledWith({
        name: "Cash reserve",
        institution: "Personal records",
        provider: "manual",
        kind: "cash",
        balance: null,
      }),
    );
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
    mount(<FinanceAccountsPage />);
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

    fireEvent.click(screen.getByRole("button", { name: "Track account manually" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Reserve" } });
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Household" } });
    fireEvent.change(screen.getByLabelText("Balance"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText("Manual account unavailable")).toBeVisible();
    expect(api.createFinanceAccount).toHaveBeenCalledWith(expect.objectContaining({ balance: 42 }));
  });

  it("uses snapshot wealth instead of unqualified account totals and versions goal actions", async () => {
    mount(<FinanceWealthPage />);
    const position = await screen.findByRole("region", { name: "Ownership-qualified wealth" });
    expect(within(position).getAllByText("Unavailable")).toHaveLength(3);
    expect(within(position).queryByText("$1,000.00")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Pause Emergency reserve" }));
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
    fireEvent.change(within(dialog).getByLabelText("Target amount (USD)"), {
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
    fireEvent.change(screen.getByLabelText("Target amount (USD)"), { target: { value: "6500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await screen.findByText(/Goal changed\. Reload it\./);
    expect(screen.getByLabelText("Target amount (USD)")).toHaveValue(6500);
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
    mount(<FinanceAccountsPage />);
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
    expect(await screen.findByText("Snapshot unavailable")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Add accounts" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Resume Paused goal" }));
    await waitFor(() =>
      expect(api.manageFinanceGoal).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "resume" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Done goal" }));
    expect(screen.getByRole("dialog", { name: "Remove goal" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Paused goal" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Retry accounts" }));
    expect(refetch).toHaveBeenCalled();
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
