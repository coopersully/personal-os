// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceTransaction } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TransactionContextEditor,
  TransactionContextMenu,
  TransactionDateEditor,
} from "./transaction-interactions";

const api = vi.hoisted(() => ({ updateFinanceTransaction: vi.fn() }));
vi.mock("@/api", () => ({ api }));
const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
beforeEach(() => {
  vi.clearAllMocks();
  api.updateFinanceTransaction.mockReset();
});
const transaction = {
  id: "meal",
  merchant: "Cafe",
  notes: "Lunch",
  category: "Dining",
  date: "2026-09-29",
  updatedAt: "2026-09-30T00:00:00.000Z",
} as FinanceTransaction;
it("offers split, edit context, and recategorize on right click", async () => {
  const onSplit = vi.fn();
  const onContext = vi.fn();
  const onCategorize = vi.fn();
  render(
    <TransactionContextMenu
      transaction={transaction}
      onSplit={onSplit}
      onContext={onContext}
      onCategorize={onCategorize}
    >
      <button type="button">Cafe</button>
    </TransactionContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Cafe" }));
  expect(screen.getByRole("menuitem", { name: "Split purchase" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Recategorize" })).toBeVisible();
  await userEvent.click(screen.getByRole("menuitem", { name: "Edit context" }));
  expect(onContext).toHaveBeenCalledOnce();
});
it("preserves edited context after failure and saves with the observed version", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  api.updateFinanceTransaction
    .mockRejectedValueOnce(new Error("Could not save"))
    .mockResolvedValueOnce(transaction);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TransactionContextEditor transaction={transaction} onClose={onClose} />
    </QueryClientProvider>,
  );
  await user.clear(screen.getByLabelText("Context for Cafe"));
  await user.type(screen.getByLabelText("Context for Cafe"), "Team lunch");
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() => expect(api.updateFinanceTransaction).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Context for Cafe")).toHaveValue("Team lunch");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.updateFinanceTransaction).toHaveBeenLastCalledWith("meal", {
    notes: "Team lunch",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
});

it.each([
  "pending_review",
  "needs_information",
])("keeps context open for a %s response", async (status) => {
  api.updateFinanceTransaction.mockResolvedValue({ status });
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TransactionContextEditor transaction={{ ...transaction, notes: null }} onClose={onClose} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() =>
    expect(api.updateFinanceTransaction).toHaveBeenCalledWith(
      "meal",
      expect.objectContaining({ notes: null }),
    ),
  );
  expect(onClose).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

function mountDateEditor(manual: boolean, onSaved = vi.fn()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <TransactionDateEditor transaction={transaction} manual={manual} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const mock of [toast.loading, toast.success, toast.error])
    for (const [message] of mock.mock.calls)
      expect(screen.queryByText(String(message))).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
}

it("corrects a manual transaction's date with the observed version and one toast", async () => {
  api.updateFinanceTransaction.mockResolvedValue({ ...transaction, date: "2026-09-27" });
  const onSaved = mountDateEditor(true);
  const input = screen.getByLabelText("Date");
  expect(input).toHaveValue("2026-09-29");
  expect(screen.getByRole("button", { name: "Save date" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "2026-09-27" } });
  await userEvent.click(screen.getByRole("button", { name: "Save date" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api.updateFinanceTransaction).toHaveBeenCalledExactlyOnceWith("meal", {
    date: "2026-09-27",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
  expect(toast.loading).toHaveBeenCalledExactlyOnceWith("Saving date…", {
    id: expect.any(String),
  });
  expect(toast.success).toHaveBeenCalledExactlyOnceWith("Date updated", {
    id: toast.loading.mock.calls[0]?.[1].id,
  });
  expect(toast.error).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it.each([
  [
    new ApiClientError({ code: "conflict", message: "changed", status: 409 }),
    "Couldn’t save the transaction date. This item changed or is no longer available. Check the latest version before trying again.",
  ],
  [
    new Error("network"),
    "Couldn’t confirm whether we could save the transaction date. Check the latest state before trying again to avoid making the change twice.",
  ],
])("reports a failed date change through Sonner only and keeps the draft: %s", async (error, message) => {
  api.updateFinanceTransaction.mockRejectedValue(error);
  const onSaved = mountDateEditor(true);
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-27" } });
  await userEvent.click(screen.getByRole("button", { name: "Save date" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      message,
      expect.objectContaining({ id: toast.loading.mock.calls[0]?.[1].id }),
    ),
  );
  expect(api.updateFinanceTransaction).toHaveBeenCalledOnce();
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Date")).toHaveValue("2026-09-27");
  expectNoInlineResult();
});

it("reports a date change that is awaiting review instead of claiming it was saved", async () => {
  api.updateFinanceTransaction.mockResolvedValue({ status: "pending_review" });
  const onSaved = mountDateEditor(true);
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-27" } });
  await userEvent.click(screen.getByRole("button", { name: "Save date" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(onSaved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("offers no date input for a synced transaction", () => {
  mountDateEditor(false);
  expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save date" })).not.toBeInTheDocument();
});
