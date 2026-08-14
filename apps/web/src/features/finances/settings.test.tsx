// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  employer: "Ilo Labs",
  employmentType: "full_time" as const,
  expectedNetPay: 4125,
  grossAnnualIncome: 145000,
  nextPayday: "2026-08-28",
  payAccountId: id,
  payFrequency: "biweekly" as const,
  role: "Product lead",
};

const mocks = vi.hoisted(() => ({
  getDomainProfile: vi.fn(),
  getFinanceGuidedSetup: vi.fn(),
  getFinanceOverview: vi.fn(),
  getFinanceProfile: vi.fn(),
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

  it("shows active guidance and saves the signed-in person's financial profile", async () => {
    const active = {
      ...draftProfile,
      categories: [],
      instructions: [],
      preferences: {},
      sourceContexts: [],
      status: "active" as const,
      version: 2,
    };
    mocks.getDomainProfile.mockResolvedValue(active);
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      ...guidedSetupFixture,
      accountSources: [],
      guidance: {
        approvedProfile: active,
        draftNotice: null,
        draftProposal: null,
      },
      humanOnlyActions: [],
    });
    mocks.getFinanceOverview.mockResolvedValue({
      accounts: [{ id, institution: "Credit Union", name: "Checking" }],
      budgets: [],
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    mocks.getFinanceProfile.mockResolvedValue({
      effectiveDate: "2026-08-01",
      employer: null,
      employmentType: null,
      expectedNetPay: null,
      grossAnnualIncome: null,
      nextPayday: null,
      payAccountId: null,
      payFrequency: null,
      role: null,
    });

    renderSettings();
    const browser = userEvent.setup();
    expect(await screen.findByText("Active approved guidance")).toBeVisible();
    expect(screen.getByText("Consequential finance actions stay in Finance.")).toBeVisible();
    expect(screen.queryByText("Monthly review guidance")).not.toBeInTheDocument();

    await browser.type(screen.getByRole("textbox", { name: "Employer" }), "Ilo Labs");
    await browser.type(screen.getByRole("textbox", { name: "Role" }), "Product lead");
    await browser.selectOptions(
      screen.getByRole("combobox", { name: "Employment type" }),
      "full_time",
    );
    await browser.clear(screen.getByLabelText("Effective date"));
    await browser.type(screen.getByLabelText("Effective date"), "2026-08-15");
    await browser.type(screen.getByRole("textbox", { name: "Gross annual income" }), "145000");
    await browser.type(screen.getByRole("textbox", { name: "Expected net paycheck" }), "4125");
    await browser.selectOptions(
      screen.getByRole("combobox", { name: "Pay frequency" }),
      "biweekly",
    );
    await browser.type(screen.getByLabelText("Next payday"), "2026-08-28");
    await browser.selectOptions(screen.getByRole("combobox", { name: "Pay account" }), id);
    await browser.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(mocks.updateFinanceProfile).toHaveBeenCalledWith({
        effectiveDate: "2026-08-15",
        employer: "Ilo Labs",
        employmentType: "full_time",
        expectedNetPay: 4125,
        grossAnnualIncome: 145000,
        nextPayday: "2026-08-28",
        payAccountId: id,
        payFrequency: "biweekly",
        role: "Product lead",
      }),
    );
  });

  it("preserves unsaved profile edits when the profile refreshes in the background", async () => {
    mocks.getFinanceProfile.mockResolvedValue({
      effectiveDate: "2026-08-01",
      employer: "Original employer",
      employmentType: null,
      expectedNetPay: null,
      grossAnnualIncome: null,
      nextPayday: null,
      payAccountId: null,
      payFrequency: null,
      role: null,
    });
    const { queryClient } = renderSettings();
    const browser = userEvent.setup();
    const employer = await screen.findByRole("textbox", { name: "Employer" });
    await waitFor(() => expect(employer).toHaveValue("Original employer"));

    await browser.clear(employer);
    await browser.type(employer, "Unsaved employer");
    await act(() => {
      queryClient.setQueryData(["finance-profile"], {
        effectiveDate: "2026-08-01",
        employer: "Refetched employer",
        employmentType: null,
        expectedNetPay: null,
        grossAnnualIncome: null,
        nextPayday: null,
        payAccountId: null,
        payFrequency: null,
        role: null,
      });
    });
    expect(queryClient.getQueryData(["finance-profile"])).toMatchObject({
      employer: "Refetched employer",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(employer).toHaveValue("Unsaved employer");
  });

  it("keeps draft guidance visible and restores activation after a failed request", async () => {
    mocks.upsertDomainProfile.mockRejectedValueOnce(new Error("Guidance activation failed"));
    renderSettings();
    const browser = userEvent.setup();

    await browser.click(await screen.findByRole("button", { name: "Activate guidance" }));

    expect(await screen.findByText("Guidance activation failed")).toBeVisible();
    expect(screen.getByText("Keep financial review trustworthy.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate guidance" })).toBeEnabled();
  });

  it("keeps profile edits and restores saving after a failed request", async () => {
    mocks.updateFinanceProfile.mockRejectedValueOnce(new Error("Profile save failed"));
    renderSettings();
    const browser = userEvent.setup();
    const employer = await screen.findByRole("textbox", { name: "Employer" });

    await browser.type(employer, "Unsaved employer");
    await browser.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile save failed")).toBeVisible();
    expect(employer).toHaveValue("Unsaved employer");
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
  });
});
