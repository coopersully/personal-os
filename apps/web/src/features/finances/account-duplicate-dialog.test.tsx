// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceAccount } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { AccountDuplicateDialog } from "./account-duplicate-dialog";

const api = vi.hoisted(() => ({
  getFinanceAccountDuplicatePreview: vi.fn(),
  resolveFinanceAccountDuplicate: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
const errorToast = vi.spyOn(toast, "error");
const loadingToast = vi.spyOn(toast, "loading");
const successToast = vi.spyOn(toast, "success");
const redundant: FinanceAccount = {
  id: "old-account",
  name: "Old checking",
  accountMask: "1234",
  institution: "Example Bank",
  balance: 100,
  currencyCode: "USD",
  includeInPlanning: true,
  kind: "cash",
  kindSource: "provider",
  ownershipType: "individual",
  ownershipShare: 1,
  provider: "plaid",
  status: "needs_reauth",
  providerType: "depository",
  providerSubtype: "checking",
  lastSyncedAt: null,
  updatedAt: "2026-10-01T12:00:00Z",
  createdAt: "2026-09-01T12:00:00Z",
  synchronization: {
    state: "blocked",
    message: null,
    lastSuccessAt: null,
    nextRetryAt: null,
    failureCode: null,
    failureCount: 0,
    lastAttemptAt: null,
    recovery: null,
  },
};
const kept: FinanceAccount = {
  ...redundant,
  id: "new-account",
  name: "Current checking",
  status: "connected",
  lastSyncedAt: "2026-10-29T12:00:00Z",
  synchronization: { ...redundant.synchronization, state: "current" },
};
const preview = {
  keptAccount: kept,
  redundantAccount: redundant,
  keptTransactionCount: 10,
  redundantTransactionCount: 7,
  overlappingTransactionCount: 5,
  uniqueRedundantTransactionCount: 2,
  match: "possible",
  revision: "a".repeat(64),
};
const envelope = (data: unknown) => ({
  outcome: "completed",
  data,
  communication: { headline: "Ready", optionalDetails: [], requiredDisclosures: [] },
});
const close = vi.fn();
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  api.getFinanceAccountDuplicatePreview.mockResolvedValue(envelope(preview));
  api.resolveFinanceAccountDuplicate.mockResolvedValue(envelope(redundant));
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  client.clear();
});
function mount(candidates = [kept]) {
  return render(
    <QueryClientProvider client={client}>
      <AccountDuplicateDialog account={redundant} candidates={candidates} onClose={close} />
    </QueryClientProvider>,
  );
}
async function compare() {
  fireEvent.change(screen.getByLabelText("Account to keep tracking"), {
    target: { value: kept.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview comparison" }));
  await screen.findByRole("button", { name: "Stop tracking duplicate" });
}
it("requires an explicit healthy keep choice and review, preserves history, then refreshes finance views", async () => {
  client.setQueryData(["finance-accounts"], { accounts: [redundant, kept] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  mount([
    redundant,
    kept,
    {
      ...kept,
      id: "blocked",
      name: "Blocked checking",
      synchronization: redundant.synchronization,
    },
    { ...kept, id: "manual", name: "Manual cash", provider: "manual" },
  ]);
  expect(screen.getByRole("button", { name: "Preview comparison" })).toBeDisabled();
  expect(
    screen.queryByRole("option", { name: /Blocked checking|Manual cash|Old checking/ }),
  ).not.toBeInTheDocument();
  expect(api.getFinanceAccountDuplicatePreview).not.toHaveBeenCalled();
  await compare();
  expect(api.getFinanceAccountDuplicatePreview).toHaveBeenCalledWith(redundant.id, kept.id);
  expect(screen.getByRole("region", { name: "Keep tracking" })).toHaveTextContent("Ending in 1234");
  expect(screen.getByRole("region", { name: "Stop tracking" })).toHaveTextContent(
    "Last synced never",
  );
  expect(screen.getByText("Overlapping transactions").nextElementSibling).toHaveTextContent("5");
  expect(
    screen.getByText("Unique transactions on the redundant account").nextElementSibling,
  ).toHaveTextContent("2");
  expect(screen.getByText(/All transaction history stays/)).toBeVisible();
  expect(
    screen.getByText(
      /Unique transactions remain visible.*excluded from planning.*past spending totals/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/does not revoke provider access or cancel any billing/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(api.resolveFinanceAccountDuplicate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop tracking duplicate" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.resolveFinanceAccountDuplicate).toHaveBeenCalledWith(redundant.id, {
    keepAccountId: kept.id,
    revision: preview.revision,
    idempotencyKey: expect.any(String),
  });
  expect(invalidate).toHaveBeenCalled();
  expect(loadingToast).toHaveBeenCalledWith("Stopping duplicate tracking…", expect.anything());
  expect(successToast).toHaveBeenCalledWith(
    "Duplicate tracking stopped. Transaction history preserved.",
    expect.objectContaining({ id: loadingToast.mock.calls.at(-1)?.[1]?.id }),
  );
});
it("preserves the reviewed comparison and idempotency key for an uncertain retry, with Sonner only", async () => {
  api.resolveFinanceAccountDuplicate.mockRejectedValueOnce(new Error("connection lost"));
  mount();
  await compare();
  fireEvent.click(screen.getByRole("button", { name: "Stop tracking duplicate" }));
  await waitFor(() => expect(errorToast).toHaveBeenCalled());
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByText(/couldn’t|connection lost|may have/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Account to keep tracking")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Stop tracking duplicate" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.resolveFinanceAccountDuplicate.mock.calls[1]).toEqual(
    api.resolveFinanceAccountDuplicate.mock.calls[0],
  );
});
it("invalidates stale confirmation and requires a new preview and a fresh key", async () => {
  api.resolveFinanceAccountDuplicate.mockRejectedValueOnce(
    new ApiClientError({ code: "conflict", status: 409, message: "Comparison changed" }),
  );
  mount();
  await compare();
  fireEvent.click(screen.getByRole("button", { name: "Stop tracking duplicate" }));
  const reload = await screen.findByRole("button", { name: "Reload comparison" });
  expect(errorToast).toHaveBeenCalled();
  expect(
    within(screen.getByRole("dialog")).queryByText(/This item changed/),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Stop tracking duplicate" })).not.toBeInTheDocument();
  api.getFinanceAccountDuplicatePreview.mockResolvedValue(
    envelope({ ...preview, revision: "b".repeat(64) }),
  );
  fireEvent.click(reload);
  fireEvent.click(await screen.findByRole("button", { name: "Stop tracking duplicate" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.resolveFinanceAccountDuplicate.mock.calls[1]?.[1]).toEqual({
    keepAccountId: kept.id,
    revision: "b".repeat(64),
    idempotencyKey: expect.any(String),
  });
  expect(api.resolveFinanceAccountDuplicate.mock.calls[1]?.[1].idempotencyKey).not.toBe(
    api.resolveFinanceAccountDuplicate.mock.calls[0]?.[1].idempotencyKey,
  );
});
it("reports failed previews through Sonner and allows read retry without a write", async () => {
  api.getFinanceAccountDuplicatePreview.mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.change(screen.getByLabelText("Account to keep tracking"), {
    target: { value: kept.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview comparison" }));
  await waitFor(() => expect(errorToast).toHaveBeenCalled());
  expect(
    within(screen.getByRole("dialog")).queryByText(/offline|couldn’t/i),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview comparison" }));
  await screen.findByRole("button", { name: "Stop tracking duplicate" });
  expect(api.resolveFinanceAccountDuplicate).not.toHaveBeenCalled();
});
it("offers safe cancellation when no healthy keep account exists", () => {
  mount([]);
  expect(screen.getByText(/Reconnect or sync/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Preview comparison" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalled();
});

it("asks for confirmation when provider details match without claiming verified identity", async () => {
  api.getFinanceAccountDuplicatePreview.mockResolvedValue(
    envelope({ ...preview, match: "provider_identity" }),
  );
  mount();
  await compare();
  expect(
    screen.getByText(
      "These accounts have matching provider details. Confirm they represent the same account.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/provider identifies these as the same/)).not.toBeInTheDocument();
});
