// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinanceConversationBudgetStart } from "./conversation-budget-start";

const api = vi.hoisted(() => ({
  getFinanceBudgetStartPreview: vi.fn(),
  applyFinanceBudgetStart: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({ toast }));
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinanceConversationBudgetStart id="preview" sessionKey="owner" isCurrent={() => true} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceBudgetStartPreview.mockResolvedValue({
    id: "preview",
    fingerprint: "exact",
    proposedMonth: "2026-11",
    expectedPolicyRevision: 0,
    attention: { activeDecisionCount: 2000 },
    projectedAttention: {
      activeDecisionCount: 2,
      historicalRecordCount: 1998,
      readiness: { openingPositionQualified: false },
    },
  });
});
it("shows the impact and saves only the exact reviewed starting month", async () => {
  api.applyFinanceBudgetStart.mockResolvedValue({ firstMonth: "2026-11", revision: 1 });
  mount();
  await screen.findByText("2,000 → 2");
  fireEvent.click(screen.getByRole("button", { name: "Confirm starting month" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(api.applyFinanceBudgetStart).toHaveBeenCalledWith({
    previewId: "preview",
    fingerprint: "exact",
  });
  expect(screen.getByRole("button", { name: "Confirm starting month" })).toBeDisabled();
});
it("reports a changed preview only through Sonner", async () => {
  api.applyFinanceBudgetStart.mockRejectedValue(new Error("Conflict"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Confirm starting month" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(
    screen.queryByText(
      "Could not confirm this preview. Ask nohmi for an updated starting-month proposal.",
    ),
  ).toBeNull();
});
