// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceBulkCategorization, useFinanceBulkSelection } from "./bulk-categorization";

const api = vi.hoisted(() => ({ applyFinanceCategorizations: vi.fn() }));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "bulk-toast"),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/api", () => ({ api }));
vi.mock("sonner", () => ({ toast }));
const records = ["Cafe", "Market"].map((merchant, index) => ({
  id: `transaction-${index}`,
  merchant,
  date: "2026-10-18",
  amount: 12 + index,
  currencyCode: "USD",
  category: null,
  categoryId: null,
  updatedAt: "2026-10-18T12:00:00.000Z",
})) as [FinanceTransaction, FinanceTransaction];
const categories = [{ id: "food", name: "Food" }] as FinanceCategory[];
function Harness({
  transactions = records,
  disabled = false,
}: {
  transactions?: FinanceTransaction[];
  disabled?: boolean;
}) {
  const selection = useFinanceBulkSelection(transactions, disabled);
  return (
    <>
      {transactions.map((item) => (
        <div key={item.id}>{selection.control(item)}</div>
      ))}
      <FinanceBulkCategorization selection={selection} categories={categories} />
    </>
  );
}
function setup(transactions: FinanceTransaction[] = records) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (items: FinanceTransaction[], disabled = false) => (
    <QueryClientProvider client={client}>
      <Harness transactions={items} disabled={disabled} />
    </QueryClientProvider>
  );
  return { ...render(wrap(transactions)), wrap, client, user: userEvent.setup() };
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Categorize selected" }));
  await user.selectOptions(screen.getByLabelText("Category for selected transactions"), "food");
  await user.click(screen.getByRole("button", { name: "Apply category" }));
}
beforeEach(() => vi.clearAllMocks());
it("confirms only selected IDs and observed revisions and announces confirmed per-item outcomes in Sonner", async () => {
  const { user } = setup();
  api.applyFinanceCategorizations.mockResolvedValue([
    { transactionId: records[1].id, applied: true, status: "applied", error: null },
  ]);
  await user.click(screen.getByRole("checkbox", { name: "Select Market, 2026-10-18" }));
  await confirm(user);
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(api.applyFinanceCategorizations).toHaveBeenCalledWith({
    decisions: [
      {
        transactionId: records[1].id,
        expectedTransactionUpdatedAt: records[1].updatedAt,
        categoryId: "food",
        confidence: 1,
        learnMerchant: "never",
        rationale: "Categorized by the user in Transactions.",
      },
    ],
  });
  expect(toast.loading).toHaveBeenCalledOnce();
  expect(toast.success.mock.calls[0]?.[1]).toMatchObject({ id: "bulk-toast" });
  expect(screen.queryByText(/1 transaction categorized/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "Bulk transaction categorization" })).toHaveFocus(),
  );
  expect(screen.getByRole("checkbox", { name: "Select Market, 2026-10-18" })).not.toBeChecked();
});
it("reports mixed results per item and requires reloading before another attempt", async () => {
  const { user } = setup();
  api.applyFinanceCategorizations.mockResolvedValue([
    { transactionId: records[0].id, applied: false, status: "failed", error: { code: "conflict" } },
    { transactionId: records[1].id, applied: false, status: "review_required", error: null },
  ]);
  await user.click(screen.getByRole("checkbox", { name: "Select this page" }));
  await confirm(user);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  const description = toast.error.mock.calls[0]?.[1].description;
  render(description);
  expect(screen.getByText(/Cafe.*Changed.*reload/)).toBeInTheDocument();
  expect(screen.getByText(/Market.*Review required/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select this page" })).toBeDisabled();
  expect(api.applyFinanceCategorizations).toHaveBeenCalledOnce();
});
it.each([
  new Error("Disconnected"),
  { status: "pending_review" },
  [],
])("never claims success for unconfirmed results and does not retry automatically: %s", async (response) => {
  const { user } = setup();
  if (response instanceof Error) api.applyFinanceCategorizations.mockRejectedValue(response);
  else api.applyFinanceCategorizations.mockResolvedValue(response);
  await user.click(screen.getByRole("checkbox", { name: "Select this page" }));
  await confirm(user);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(api.applyFinanceCategorizations).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("invalidates selection and confirmation when records or revisions change", async () => {
  const { user, rerender, wrap } = setup();
  await user.click(screen.getByRole("checkbox", { name: "Select this page" }));
  await user.click(screen.getByRole("button", { name: "Categorize selected" }));
  rerender(wrap([{ ...records[0], updatedAt: "2026-10-18T13:00:00.000Z" }]));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Categorize selected" })).toBeDisabled();
});
it("bounds selection at 100 without selecting hidden records", async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({
    ...records[0],
    id: `t-${i}`,
    merchant: `Merchant ${i}`,
  }));
  const { user } = setup(many);
  expect(screen.getByLabelText("Select this page")).toBeDisabled();
  // Keyboard and pointer use the same real checkbox controls.
  const first = screen.getByLabelText("Select Merchant 0, 2026-10-18");
  first.focus();
  await user.keyboard(" ");
  const boxes = screen.getAllByLabelText(/^Select Merchant/);
  act(() => {
    for (let i = 1; i <= 100; i++) fireEvent.click(boxes[i] as HTMLElement);
  });
  expect(screen.getByLabelText("Select Merchant 100, 2026-10-18")).toBeDisabled();
  expect(screen.getByText("100 selected · this page only")).toBeInTheDocument();
});

it("accepts an applied action envelope while preserving individual outcomes", async () => {
  const { user } = setup();
  api.applyFinanceCategorizations.mockResolvedValue({
    status: "applied",
    result: [{ transactionId: records[0].id, status: "applied", applied: true }],
  });
  await user.click(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" }));
  await confirm(user);
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
});
it("requires a successful explicit reload and reselects the newly observed revision", async () => {
  const { user, client, rerender, wrap } = setup();
  api.applyFinanceCategorizations.mockResolvedValue([
    { transactionId: records[0].id, status: "failed", applied: false, error: { code: "conflict" } },
  ]);
  await user.click(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" }));
  await confirm(user);
  await screen.findByRole("button", { name: "Reload transactions" });
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Reload transactions" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("could not reload"),
      expect.anything(),
    ),
  );
  expect(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" })).toBeDisabled();
  invalidate.mockResolvedValueOnce();
  const updated = { ...records[0], updatedAt: "2026-10-18T14:00:00.000Z" };
  rerender(wrap([updated]));
  await user.click(screen.getByRole("button", { name: "Reload transactions" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" })).toBeEnabled(),
  );
  expect(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Select Cafe, 2026-10-18" }));
  await confirm(user);
  await waitFor(() => expect(api.applyFinanceCategorizations).toHaveBeenCalledTimes(2));
  expect(
    api.applyFinanceCategorizations.mock.lastCall?.[0].decisions[0].expectedTransactionUpdatedAt,
  ).toBe(updated.updatedAt);
});
it("blocks duplicate submissions while a response is pending", async () => {
  const { user } = setup();
  let finish!: (value: unknown) => void;
  api.applyFinanceCategorizations.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await user.click(screen.getByRole("checkbox", { name: "Select this page" }));
  await confirm(user);
  expect(screen.getByRole("checkbox", { name: "Select this page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload transactions" })).toBeDisabled();
  expect(api.applyFinanceCategorizations).toHaveBeenCalledOnce();
  finish([]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reload transactions" })).toBeEnabled(),
  );
});
