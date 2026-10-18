// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type {
  FinanceBudgetBaselineReview,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import {
  SpendingBudgetQualification,
  SpendingMonthlyBudgetContext,
} from "./spending-budget-qualification";

const accountId = "00000000-0000-4000-8000-000000000123";
const versionId = "00000000-0000-4000-8000-000000000124";
const reviewId = "00000000-0000-4000-8000-000000000125";
const snapshot = {
  accountIds: [accountId],
  allocations: [
    {
      key: "food",
      categoryId: null,
      legacyCategory: "Food",
      label: "Groceries",
      amountCents: 12500,
    },
  ],
  budgetVersionId: versionId,
  budgetVersion: 2,
  planId: "00000000-0000-4000-8000-000000000126",
  sourceBaselineId: null,
  currency: "USD",
  month: "2026-09",
  period: { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" },
  originalApproval: {
    approvedAt: "2026-09-01T12:00:00Z",
    actorId: "original-agent",
    actorType: "agent" as const,
  },
};
const review = {
  id: reviewId,
  fingerprint: "a".repeat(64),
  snapshot,
} as FinanceBudgetBaselineReview;
beforeEach(() => {
  vi.spyOn(api, "getFinanceBudgetBaselineQualification").mockResolvedValue({
    state: "unavailable",
    reason: "qualification_required",
    qualificationRequired: true,
    candidates: [
      {
        budgetVersionId: versionId,
        planId: snapshot.planId,
        budgetVersion: 2,
        approvedAt: "2026-09-01T12:00:00Z",
        originalActorType: "agent",
        period: snapshot.period,
      },
    ],
  });
  vi.spyOn(api, "listFinanceAccounts").mockResolvedValue({
    accounts: [
      {
        id: accountId,
        name: "Everyday account",
        currencyCode: "USD",
        updatedAt: "2026-10-01T00:00:00Z",
        ownershipType: "individual",
        ownershipShare: 1,
      },
    ],
  } as Awaited<ReturnType<typeof api.listFinanceAccounts>>);
  vi.spyOn(api, "prepareFinanceBudgetBaselineQualification").mockResolvedValue(review);
  vi.spyOn(api, "confirmFinanceBudgetBaselineQualification").mockResolvedValue({
    state: "qualified",
    qualification: {
      ...snapshot,
      id: reviewId,
      revision: 1,
      confirmedAt: "2026-10-18T12:00:00Z",
      confirmedByActorId: "owner",
      qualificationKind: "retrospective",
    },
  } as Awaited<ReturnType<typeof api.confirmFinanceBudgetBaselineQualification>>);
  vi.spyOn(toast, "loading");
  vi.spyOn(toast, "success");
  vi.spyOn(toast, "error");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(sourceRevision = "source-one") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  const node = (revision: string) => (
    <QueryClientProvider client={cache}>
      <SpendingBudgetQualification
        ownerId="owner"
        month="2026-09"
        timezone="America/New_York"
        sourceRevision={revision}
      />
    </QueryClientProvider>
  );
  const view = render(node(sourceRevision));
  return { ...view, cache, node };
}
async function chooseScope() {
  fireEvent.click(screen.getByText("Confirm this month's budget scope"));
  const version = await screen.findByRole("button", { name: /Version 2/ });
  expect(version).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Preview exact monthly scope" })).toBeDisabled();
  fireEvent.click(version);
  fireEvent.click(screen.getByRole("checkbox", { name: /Everyday account/ }));
  fireEvent.click(screen.getByRole("button", { name: "USD · US dollars" }));
}
it("requires explicit choices, previews exact server snapshot, and confirms only its review and fingerprint", async () => {
  const { cache } = mount();
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  await chooseScope();
  expect(api.prepareFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
  expect(api.confirmFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview exact monthly scope" }));
  const preview = await screen.findByRole("region", { name: "Monthly budget scope preview" });
  expect(preview).toHaveTextContent("2026-09-01 – 2026-09-30 · America/New_York · USD");
  expect(preview).toHaveTextContent(accountId);
  expect(preview).toHaveTextContent("Everyday account");
  expect(preview).toHaveTextContent("Groceries · $125.00 · 12500 cents");
  expect(preview).toHaveTextContent("original-agent");
  expect(preview).toHaveTextContent("does not establish that a human approved the original budget");
  expect(api.prepareFinanceBudgetBaselineQualification).toHaveBeenCalledWith({
    accountIds: [accountId],
    budgetVersionId: versionId,
    currency: "USD",
    idempotencyKey: expect.any(String),
    month: "2026-09",
    timezone: "America/New_York",
  });
  expect(api.confirmFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm this exact monthly scope" }));
  await waitFor(() =>
    expect(api.confirmFinanceBudgetBaselineQualification).toHaveBeenCalledWith({
      reviewId,
      expectedFingerprint: "a".repeat(64),
      idempotencyKey: expect.any(String),
    }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Monthly budget scope confirmed", expect.anything()),
  );
  expect(toast.loading).toHaveBeenCalledWith("Confirming monthly budget scope", expect.anything());
  expect(invalidate).toHaveBeenCalled();
  expect(screen.queryByText("Monthly budget scope confirmed")).not.toBeInTheDocument();
});
it("invalidates a prepared preview when source evidence changes", async () => {
  const { rerender, node } = mount();
  await chooseScope();
  fireEvent.click(screen.getByRole("button", { name: "Preview exact monthly scope" }));
  await screen.findByRole("region", { name: "Monthly budget scope preview" });
  rerender(node("source-two"));
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Monthly budget scope preview" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "Confirm this exact monthly scope" }),
  ).not.toBeInTheDocument();
  expect(api.confirmFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
});
it("reuses prepare idempotency on a failed attempt and reports failures only through Sonner", async () => {
  vi.mocked(api.prepareFinanceBudgetBaselineQualification).mockRejectedValueOnce(
    new Error("Unavailable"),
  );
  mount();
  await chooseScope();
  fireEvent.click(screen.getByRole("button", { name: "Preview exact monthly scope" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t prepare/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Preview exact monthly scope" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview exact monthly scope" }));
  await screen.findByRole("region", { name: "Monthly budget scope preview" });
  const calls = vi.mocked(api.prepareFinanceBudgetBaselineQualification).mock.calls;
  expect(calls[0]?.[0].idempotencyKey).toBe(calls[1]?.[0].idempotencyKey);
});
it("labels unavailable and observed retrospective monthly scopes without asserting original approval", () => {
  const { rerender } = render(
    <SpendingMonthlyBudgetContext
      budget={{
        state: "unavailable",
        reason: "multi_month_selection",
        qualificationRequired: false,
      }}
    />,
  );
  expect(screen.getByText(/selection spans multiple months/)).toBeVisible();
  const qualified = {
    state: "qualified",
    month: "2026-09",
    period: snapshot.period,
    currency: "USD",
    accountIds: [accountId],
    qualificationId: reviewId,
    confirmedAt: "2026-10-18T12:00:00Z",
    qualificationKind: "retrospective",
    coverage: "partial",
    includesPending: true,
    basis: "personal_cost",
    subtractsRefunds: true,
    groups: [],
  } as FinanceSpendingMonthlyBudget;
  rerender(<SpendingMonthlyBudgetContext budget={qualified} />);
  expect(
    screen.getByText("Monthly budget used · all budget accounts · includes pending"),
  ).toBeVisible();
  expect(screen.getByText("Observed usage · incomplete history")).toBeVisible();
  expect(screen.getByText(/Confirmed later/)).toHaveTextContent("2026-10-18T12:00:00Z");
  expect(screen.getByText(/America\/New_York/)).toBeVisible();
});
it("keeps confirm idempotency stable after a failed confirmation and never posts snapshot approval fields", async () => {
  vi.mocked(api.confirmFinanceBudgetBaselineQualification).mockRejectedValueOnce(
    new Error("Unavailable"),
  );
  mount();
  await chooseScope();
  fireEvent.click(screen.getByRole("button", { name: "Preview exact monthly scope" }));
  await screen.findByRole("region", { name: "Monthly budget scope preview" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm this exact monthly scope" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm this exact monthly scope" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm this exact monthly scope" }));
  await waitFor(() =>
    expect(api.confirmFinanceBudgetBaselineQualification).toHaveBeenCalledTimes(2),
  );
  const calls = vi.mocked(api.confirmFinanceBudgetBaselineQualification).mock.calls;
  expect(calls[0]?.[0].idempotencyKey).toBe(calls[1]?.[0].idempotencyKey);
  expect(Object.keys(calls[0]?.[0] ?? {}).sort()).toEqual([
    "expectedFingerprint",
    "idempotencyKey",
    "reviewId",
  ]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
