// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceRecurringObligation } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, type ToastT, toast } from "sonner";
import { RecurringCostConfirmation } from "./recurring-cost-confirmation";

const api = vi.hoisted(() => ({ manageFinanceRecurringItem: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
const item: FinanceRecurringObligation = {
  id: "00000000-0000-4000-8000-000000000002",
  accountId: "00000000-0000-4000-8000-000000000003",
  revision: 2,
  merchant: "Music",
  displayName: "Music",
  kind: "subscription",
  cadence: "monthly",
  source: "user",
  confidence: 1,
  expectedAmount: 19.99,
  status: "active",
  nextExpectedDate: null,
  lastObservedDate: null,
};
function show(
  changes: Partial<FinanceRecurringObligation> = {},
  currencyCode: string | null = "USD",
  omitRevision = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const close = vi.fn();
  const current = { ...item, ...changes };
  if (omitRevision) delete current.revision;
  render(
    <>
      <Toaster />
      <QueryClientProvider client={client}>
        <RecurringCostConfirmation
          item={current}
          {...(currencyCode
            ? { account: { id: item.accountId as string, name: "Checking", currencyCode } }
            : {})}
          today="2026-10-18"
          open
          onClose={close}
        />
      </QueryClientProvider>
    </>,
  );
  return { client, close };
}
function activeToasts() {
  return toast.getToasts().filter((entry): entry is ToastT => "title" in entry);
}
function fill() {
  fireEvent.change(screen.getByLabelText("Amount behavior"), { target: { value: "fixed" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => {
  vi.resetAllMocks();
  toast.dismiss();
});
afterEach(() => toast.dismiss());
it("requires explicit fixedness and statement, binding exact current source revision/content", async () => {
  api.manageFinanceRecurringItem.mockResolvedValue({ outcome: "completed" });
  const { close } = show();
  expect(screen.getByRole("button", { name: "Save cost statement" })).toBeDisabled();
  expect(screen.getByLabelText("Amount behavior")).toHaveValue("");
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.manageFinanceRecurringItem).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "confirm_cost",
      itemType: "obligation",
      itemId: item.id,
      expectedRevision: 2,
      expectedAmountCents: 1999,
      cadence: "monthly",
      accountId: item.accountId,
      currencyCode: "USD",
      fixedness: "fixed",
      asOf: "2026-10-18",
      idempotencyKey: expect.any(String),
    }),
  );
});
it("retains the exact request and sticky key after an unknown result", async () => {
  api.manageFinanceRecurringItem
    .mockRejectedValueOnce(new Error("Network lost"))
    .mockResolvedValueOnce({ outcome: "completed" });
  const { close } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  const retry = await screen.findByRole("button", { name: "Retry same statement" });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Amount behavior")).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.manageFinanceRecurringItem.mock.calls[1]?.[0]).toEqual(
    api.manageFinanceRecurringItem.mock.calls[0]?.[0],
  );
});
it("does not treat a failed result as a saved statement", async () => {
  api.manageFinanceRecurringItem.mockResolvedValue({
    outcome: "failed",
    communication: { headline: "Source changed" },
  });
  const { close } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  await waitFor(() => expect(api.manageFinanceRecurringItem).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save cost statement" })).toBeEnabled(),
  );
  expect(close).not.toHaveBeenCalled();
});
it("rejects missing source revision", () => {
  show({}, "USD", true);
  fill();
  expect(screen.getByRole("button", { name: "Save cost statement" })).toBeDisabled();
});
it("rejects non-cent content", () => {
  show({ expectedAmount: 1.234 });
  fill();
  expect(screen.getByRole("button", { name: "Save cost statement" })).toBeDisabled();
});
it("requires declared currency without a fallback and rejects future dates", () => {
  show({}, null);
  expect(screen.getByLabelText("Currency code")).toHaveValue("");
  fill();
  fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: "JPY" } });
  expect(screen.getByRole("button", { name: "Save cost statement" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Currency code"), { target: { value: "EUR" } });
  fireEvent.change(screen.getByLabelText("Statement as of"), { target: { value: "2026-10-19" } });
  expect(screen.getByRole("button", { name: "Save cost statement" })).toBeDisabled();
});
it("saves explicit variable evidence without implying precise totals", async () => {
  api.manageFinanceRecurringItem.mockResolvedValue({ outcome: "completed" });
  show();
  fireEvent.change(screen.getByLabelText("Amount behavior"), { target: { value: "variable" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText(/Variable payments remain outside/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  await waitFor(() =>
    expect(api.manageFinanceRecurringItem).toHaveBeenCalledWith(
      expect.objectContaining({ fixedness: "variable" }),
    ),
  );
});

it("updates an actual Sonner loading toast to confirmed success under the same ID", async () => {
  let complete!: (value: { outcome: "completed" }) => void;
  api.manageFinanceRecurringItem.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  expect(await screen.findByText("Saving cost statement…")).toBeInTheDocument();
  const pending = activeToasts().at(-1);
  expect(pending?.type).toBe("loading");
  await act(async () => complete({ outcome: "completed" }));
  expect(await screen.findByText("Cost statement saved.")).toBeInTheDocument();
  const success = activeToasts().find((entry) => entry.id === pending?.id);
  expect(success?.type).toBe("success");
  expect(within(screen.getByRole("dialog")).queryByRole("status")).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
});
it.each([
  400,
  401,
  403,
  409,
  429,
  500,
  "network",
  "failed_result",
  "pending_result",
])("uses actual Sonner without inline action results for %s", async (failure) => {
  if (failure === "failed_result")
    api.manageFinanceRecurringItem.mockResolvedValue({
      outcome: "failed",
      communication: { headline: "Rejected" },
    });
  else if (failure === "pending_result")
    api.manageFinanceRecurringItem.mockResolvedValue({
      outcome: "work_remaining",
      communication: { headline: "Not complete" },
    });
  else
    api.manageFinanceRecurringItem.mockRejectedValue(
      typeof failure === "number"
        ? new ApiClientError({
            status: failure,
            code: failure === 400 ? "invalid_request" : "failure",
            message: "Rejected",
          })
        : new Error("Connection lost"),
    );
  const { close } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save cost statement" }));
  await waitFor(() => expect(activeToasts().at(-1)?.type).toBe("error"));
  const current = activeToasts().at(-1);
  expect(current?.title).toEqual(expect.any(String));
  expect(screen.getAllByText(current?.title as string)[0]).toBeInTheDocument();
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  expect(dialog.queryByRole("status")).not.toBeInTheDocument();
  expect(dialog.queryByText(/The result is unknown/)).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});
