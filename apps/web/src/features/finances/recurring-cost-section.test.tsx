// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceRecurringObligation } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecurringCostSection } from "./recurring-cost-section";

const api = vi.hoisted(() => ({ getMe: vi.fn(), manageFinanceRecurringItem: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
const owner = "00000000-0000-4000-8000-000000000001";
const obligation: FinanceRecurringObligation = {
  id: "00000000-0000-4000-8000-000000000002",
  accountId: null,
  revision: 2,
  displayName: "Music",
  merchant: "Music",
  expectedAmount: 1,
  cadence: "monthly",
  status: "active",
  source: "user",
  confidence: 1,
  kind: "subscription",
  nextExpectedDate: null,
  lastObservedDate: null,
};
function show(item = obligation) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecurringCostSection obligations={[item]} accounts={[]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => vi.resetAllMocks());
it("loads actual identity/timezone and offers a missing-statement confirmation", async () => {
  api.getMe.mockResolvedValue({ id: owner, planningTimezone: "Pacific/Kiritimati" });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Confirm cost for Music" }));
  expect(screen.getByRole("dialog", { name: "Confirm cost for Music" })).toBeVisible();
  expect(screen.getByLabelText("Currency code")).toHaveValue("");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Kiritimati",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  expect(screen.getByLabelText("Statement as of")).toHaveValue(date);
});
it("keeps confirmation and equivalents unavailable when identity cannot load", async () => {
  api.getMe.mockRejectedValue(new Error("Offline"));
  show();
  expect(
    await screen.findByText(/Account identity or planning timezone unavailable/),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirm cost for Music" })).not.toBeInTheDocument();
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
});
it("does not fall back from an invalid planning timezone", async () => {
  api.getMe.mockResolvedValue({ id: owner, planningTimezone: "Mars/Olympus" });
  show();
  expect(
    await screen.findByText(/Account identity or planning timezone unavailable/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm cost for Music" })).not.toBeInTheDocument();
});
it("uses applicable evidence without asking for redundant confirmation", async () => {
  api.getMe.mockResolvedValue({ id: owner, planningTimezone: "UTC" });
  show({
    ...obligation,
    planningEvidence: {
      evidenceId: "00000000-0000-4000-8000-000000000004",
      ownerUserId: owner,
      actor: { type: "user", userId: owner },
      provenance: "explicit_user",
      kind: "obligation",
      sourceId: obligation.id,
      sourceRevision: 2,
      expectedAmountCents: 100,
      cadence: "monthly",
      accountId: null,
      currencyCode: "EUR",
      fixedness: "fixed",
      asOf: "2026-01-01",
      recordedAt: "2026-01-01T00:00:00Z",
    },
  });
  expect(await screen.findByRole("button", { name: "Edit statement for Music" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirm cost for Music" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Annual equivalents (EUR)"));
  expect(screen.getAllByText("€12.00")[0]).toBeVisible();
});

it.each([
  401, 403,
])("suppresses cached private rows and dismisses an open form after same-owner me denial %s", async (status) => {
  api.getMe.mockResolvedValue({ id: owner, planningTimezone: "UTC" });
  const client = show();
  fireEvent.click(await screen.findByRole("button", { name: "Confirm cost for Music" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  api.getMe.mockRejectedValue(
    new ApiClientError({ status, code: "forbidden", message: "Access denied" }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["me"] });
  });
  expect(await screen.findByText(/Recurring cost access unavailable/)).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("listitem", { name: "Music" })).not.toBeInTheDocument();
  expect(client.getQueryData(["me"])).toMatchObject({ id: owner });
});
it("retains usable cached evidence on a transient identity refresh failure", async () => {
  api.getMe.mockResolvedValue({ id: owner, planningTimezone: "UTC" });
  const client = show();
  expect(await screen.findByRole("button", { name: "Confirm cost for Music" })).toBeVisible();
  api.getMe.mockRejectedValue(new Error("Network unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["me"] });
  });
  expect(screen.getByRole("button", { name: "Confirm cost for Music" })).toBeVisible();
});
