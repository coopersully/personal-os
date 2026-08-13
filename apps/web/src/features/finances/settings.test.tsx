// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceSettings } from "./settings.js";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-13T12:00:00.000Z";

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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FinanceSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Finance settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const draft = {
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
    mocks.getDomainProfile.mockResolvedValue(draft);
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      accountSources: [
        {
          id,
          institution: "Credit Union",
          label: "Checking",
          lastSyncedAt: now,
          provider: "plaid",
          status: "connected",
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
        draftProposal: draft,
      },
      humanOnlyActions: ["manage_financial_profile"],
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
          policy: "preview",
          summary: "Capture durable preferences.",
          unavailableReason: null,
        },
      ],
    });
    mocks.getFinanceOverview.mockResolvedValue({
      accounts: [],
      budgets: [],
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    mocks.getFinanceProfile.mockResolvedValue(null);
    mocks.updateFinanceProfile.mockResolvedValue(null);
    mocks.upsertDomainProfile.mockResolvedValue({ ...draft, status: "active", version: 2 });
  });

  it("reviews and activates draft guidance without claiming a scheduled automation", async () => {
    renderSettings();

    expect(await screen.findByText("Keep financial review trustworthy.")).toBeVisible();
    expect(screen.getByText("monthly_review: true")).toBeVisible();
    expect(screen.getByText("Monthly review guidance")).toBeVisible();
    expect(screen.getByText(/No recurring schedule has been created\./)).toBeVisible();
    expect(screen.queryByText("Scheduled automation")).not.toBeInTheDocument();

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
    const draft = await mocks.getDomainProfile();
    const active = {
      ...draft,
      categories: [],
      instructions: [],
      preferences: {},
      sourceContexts: [],
      status: "active" as const,
      version: 2,
    };
    const setup = await mocks.getFinanceGuidedSetup();
    mocks.getDomainProfile.mockResolvedValue(active);
    mocks.getFinanceGuidedSetup.mockResolvedValue({
      ...setup,
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
});
