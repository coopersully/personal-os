// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinanceOpeningPositionPanel } from "./opening-position";

const api = vi.hoisted(() => ({
  getFinanceAttention: vi.fn(),
  getFinanceOpeningPosition: vi.fn(),
  confirmFinanceOpeningStatement: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("sonner", () => ({ toast }));
it("records only a manually entered exact opening statement, never a current balance", async () => {
  api.getFinanceAttention.mockResolvedValue({ period: "2026-11" });
  api.getFinanceOpeningPosition.mockResolvedValue({
    month: "2026-11",
    accounts: [
      {
        accountId: "cash",
        name: "Checking",
        accountRevision: "7",
        currencyCode: "USD",
        openingBalanceCents: null,
        reasons: ["statement_required"],
      },
    ],
    statements: [],
  });
  api.confirmFinanceOpeningStatement.mockResolvedValue({
    accountId: "cash",
    month: "2026-11",
    signedOpeningBalanceCents: 12345,
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinanceOpeningPositionPanel sessionKey="owner" isCurrent={() => true} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Checking/ }));
  expect(screen.getByLabelText("Opening balance in USD")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Confirm opening balance" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Opening balance in USD"), {
    target: { value: "123.45" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm opening balance" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(api.confirmFinanceOpeningStatement).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: "cash",
      month: "2026-11",
      expectedAccountRevision: "7",
      expectedStatementRevision: 0,
      signedOpeningBalanceCents: 12345,
    }),
  );
});
