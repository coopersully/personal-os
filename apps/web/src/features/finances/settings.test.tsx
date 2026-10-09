// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { defaultNotificationPreferences } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceSettings } from "./settings.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-13T12:00:00.000Z";
const draftProfile = {
  categories: [],
  createdAt: now,
  domain: "finances" as const,
  id,
  instructions: ["Keep ambiguous transfers visible."],
  objective: "Keep financial review trustworthy.",
  preferences: { monthly_review: true },
  sourceContexts: [
    {
      notes: null,
      purpose: "Bills and daily spending",
      sourceId: id,
      sourceLabel: "Checking",
    },
  ],
  status: "draft" as const,
  summary: "Review monthly without hiding uncertain ledger activity.",
  updatedAt: now,
  version: 1,
};
const guidedSetupFixture = {
  accountSources: [
    {
      id,
      institution: "Credit Union",
      label: "Checking",
      lastSyncedAt: now,
      provider: "plaid" as const,
      status: "connected" as const,
    },
  ],
  alertSummary: { open: 0, warnings: 0 },
  asOf: now,
  budgetSummary: { count: 0, month: "2026-08", planned: 0 },
  cashflowSummary: {
    financialProfileConfigured: false,
    incomeStreams: 0,
    recurringNeedsReview: 0,
    recurringObligations: 0,
  },
  guidance: {
    approvedProfile: null,
    draftNotice: "Draft guidance is not active.",
    draftProposal: draftProfile,
  },
  humanOnlyActions: ["manage_financial_profile" as const],
  ledgerHealth: {
    asOf: now,
    balanceOnlyAccounts: 0,
    candidateTransfers: 0,
    missingProvenance: 0,
    pendingTransactions: 0,
    possibleDuplicates: 0,
    staleAccounts: 0,
    unresolvedReviews: 0,
  },
  reviewSummary: {
    count: 0,
    reasons: {
      ambiguous_merchant: 0,
      low_confidence: 0,
      one_time: 0,
      possible_duplicate: 0,
      possible_transfer: 0,
      refund_or_reversal: 0,
      unknown_merchant: 0,
    },
  },
  suggestedWorkflows: [
    {
      available: true,
      key: "capture_preferences",
      policy: "preview" as const,
      summary: "Capture durable preferences.",
      unavailableReason: null,
    },
  ],
};
const savedFinanceProfile = {
  effectiveDate: "2026-08-15",
  employer: "Harbor Arts Center",
  employmentType: "full_time" as const,
  expectedNetPay: 4125,
  grossAnnualIncome: 145000,
  nextPayday: "2026-08-28",
  payAccountId: id,
  payFrequency: "biweekly" as const,
  role: "Product lead",
};

const mocks = vi.hoisted(() => ({
  getFinanceConfiguration: vi.fn(),
  getNotificationStatus: vi.fn(),
  listAutomationHostConnections: vi.fn().mockResolvedValue([]),
  listAutomationHostSchedules: vi.fn().mockResolvedValue([]),
  listFinanceAnswerContinuations: vi.fn().mockResolvedValue([]),
  listFinanceHostRuns: vi.fn().mockResolvedValue([]),
  listFinanceGoals: vi.fn(),
  listFinanceAccounts: vi.fn(),
  getDomainProfile: vi.fn(),
  getFinanceGuidedSetup: vi.fn(),
  getFinanceOverview: vi.fn(),
  getFinanceProfile: vi.fn(),
  getFinancialProfile: vi.fn(),
  updateFinanceProfile: vi.fn(),
  upsertDomainProfile: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FinanceSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("Finance settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotificationStatus.mockResolvedValue({
      capability: "available",
      reason: null,
      timeZone: "UTC",
      preferences: [],
      effective: defaultNotificationPreferences,
      intents: [],
      attempts: [],
    });
    mocks.getFinanceConfiguration.mockResolvedValue({
      profile: { state: "loaded", value: null },
      income: { state: "loaded", value: null },
      accounts: { state: "loaded", value: { accounts: [] } },
    });
    mocks.listFinanceGoals.mockResolvedValue({ outcome: "completed", data: [] });
    mocks.listFinanceAccounts.mockResolvedValue({ accounts: [] });
    mocks.getDomainProfile.mockResolvedValue(draftProfile);
    mocks.getFinanceGuidedSetup.mockResolvedValue(guidedSetupFixture);
    mocks.getFinanceOverview.mockResolvedValue({
      accounts: [],
      budgets: [],
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    mocks.getFinanceProfile.mockResolvedValue(null);
    mocks.getFinancialProfile.mockResolvedValue({ outcome: "completed", data: null });
    mocks.updateFinanceProfile.mockResolvedValue(savedFinanceProfile);
    mocks.upsertDomainProfile.mockResolvedValue({
      ...draftProfile,
      status: "active",
      version: 2,
    });
  });

  it("reviews and activates draft guidance without claiming a scheduled automation", async () => {
    renderSettings();

    expect(await screen.findByText("Keep financial review trustworthy.")).toBeVisible();
    expect(screen.getByText("monthly_review: true")).toBeVisible();
    expect(screen.getByText("Monthly review guidance")).toBeVisible();
    expect(screen.getByText(/No recurring schedule has been created\./)).toBeVisible();
    expect(screen.queryByText("Scheduled automation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect an agent" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Activate guidance" }));
    await waitFor(() =>
      expect(mocks.upsertDomainProfile).toHaveBeenCalledWith({
        categories: [],
        domain: "finances",
        expectedVersion: 1,
        instructions: ["Keep ambiguous transfers visible."],
        objective: "Keep financial review trustworthy.",
        preferences: { monthly_review: true },
        sourceContexts: [
          {
            notes: null,
            purpose: "Bills and daily spending",
            sourceId: id,
            sourceLabel: "Checking",
          },
        ],
        status: "active",
        summary: "Review monthly without hiding uncertain ledger activity.",
      }),
    );
  });

  it("keeps draft guidance visible and restores activation after a failed request", async () => {
    mocks.upsertDomainProfile.mockRejectedValueOnce(new Error("Guidance activation failed"));
    renderSettings();
    const browser = userEvent.setup();

    await browser.click(await screen.findByRole("button", { name: "Activate guidance" }));

    expect(
      await screen.findByText(/Couldn’t confirm whether we could activate financial planning/),
    ).toBeVisible();
    expect(screen.getByText("Keep financial review trustworthy.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate guidance" })).toBeEnabled();
  });

  it("renders an active draft's detailed guidance and pending actions", async () => {
    const [sourceContext] = draftProfile.sourceContexts;
    const [accountSource] = guidedSetupFixture.accountSources;
    if (!sourceContext || !accountSource) throw new Error("Guidance fixtures are incomplete.");
    const detailedDraft = {
      ...draftProfile,
      categories: [{ description: "Meals away from home", label: "Dining" }],
      sourceContexts: [{ ...sourceContext, notes: "Primary household account" }],
    };
    mocks.getDomainProfile.mockResolvedValue(detailedDraft);
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      ...guidedSetupFixture,
      accountSources: [
        ...guidedSetupFixture.accountSources,
        { ...accountSource, id: "22222222-2222-4222-8222-222222222222" },
      ],
      guidance: {
        approvedProfile: { ...detailedDraft, status: "active" as const },
        draftNotice: "A newer draft awaits review.",
        draftProposal: detailedDraft,
      },
    });
    let finishActivation: (() => void) | undefined;
    mocks.upsertDomainProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishActivation = () => resolve({ ...detailedDraft, status: "active", version: 2 });
        }),
    );
    renderSettings();
    const browser = userEvent.setup();

    expect(await screen.findByText("Active + draft")).toBeVisible();
    expect(screen.getAllByText(/Primary household account/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dining: Meals away from home").length).toBeGreaterThan(0);
    expect(screen.getByText(/while the pending draft is reviewed/)).toBeVisible();
    await browser.click(screen.getByRole("button", { name: "Activate guidance" }));
    expect(screen.getByRole("button", { name: "Activating…" })).toBeDisabled();
    finishActivation?.();

    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
  });
});
