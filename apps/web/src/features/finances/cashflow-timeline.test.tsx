// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceCashflowTimeline } from "./cashflow-timeline";

const api = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (e: Error) => e.message }));
const sourceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const income = [
  {
    id: sourceId,
    accountId,
    cadence: "monthly" as const,
    confidence: 1,
    displayName: "Payroll",
    expectedAmount: 1000,
    lastObservedDate: "2026-01-15",
    nextExpectedDate: "2026-01-31",
    payer: "Employer",
    source: "user" as const,
    status: "active" as const,
  },
] as const;
function show(query = "", knownCurrency = true) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter
        initialEntries={[
          `/finances/cashflow?cashflowFrom=2026-01-01&cashflowTo=2026-02-28${query}`,
        ]}
      >
        <FinanceCashflowTimeline
          income={[...income]}
          obligations={[
            {
              ...income[0],
              id: accountId,
              kind: "subscription",
              merchant: "Service",
              displayName: "Undated service",
              nextExpectedDate: null,
            },
          ]}
          accounts={knownCurrency ? [{ id: accountId, name: "Checking", currencyCode: "EUR" }] : []}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getMe.mockResolvedValue({ planningTimezone: "America/New_York" });
});
it("shows one exact source with account currency and honest timing and balance limits", async () => {
  show();
  const link = await screen.findByRole("link", { name: "Payroll" });
  expect(link).toHaveAttribute("href", `/finances/cashflow?view=income&record=${sourceId}`);
  expect(screen.getAllByText("Expected €1,000.00")[0]).toBeVisible();
  expect(
    screen.getByText("Past expected date · matching unavailable · User-provided record"),
  ).toBeVisible();
  expect(screen.getByText(/Projected balance unavailable/)).toBeVisible();
  expect(screen.getAllByText("Last observed Jan 15, 2026")[0]).toBeVisible();
  expect(screen.getByRole("region", { name: "Date unknown" })).toHaveTextContent("Undated service");
});
it("does not invent USD when the account cannot be resolved", async () => {
  show("", false);
  expect(await screen.findByRole("link", { name: "Payroll" })).toBeVisible();
  expect(screen.getAllByText(/Currency not recorded/)).toHaveLength(2);
  expect(screen.queryByText(/\$1,000/)).not.toBeInTheDocument();
});
it("honors explicit empty account scope in both dated and undated sections", async () => {
  show("&cashflowAccounts=none");
  expect(
    await screen.findByText("No next expected items recorded in this date range."),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: "Payroll" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Undated service" })).not.toBeInTheDocument();
});
it("keeps undated records when switching to calendar", async () => {
  show();
  await screen.findByRole("link", { name: "Payroll" });
  await userEvent.setup().selectOptions(screen.getByLabelText("Timeline view"), "calendar");
  expect(screen.getByRole("region", { name: "Date unknown" })).toHaveTextContent("Undated service");
  expect(screen.getByRole("grid")).toBeVisible();
});
it("offers recovery for invalid URL scope without hiding date controls", async () => {
  show("&cashflowAccounts=invalid");
  expect(await screen.findByRole("button", { name: "Reset timeline filters" })).toBeVisible();
  expect(screen.getByLabelText("From")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Reset timeline filters" }));
  expect(screen.queryByRole("button", { name: "Reset timeline filters" })).not.toBeInTheDocument();
});
it("does not silently substitute a timezone when user settings cannot load", async () => {
  api.getMe.mockRejectedValue(new Error("Settings unavailable"));
  show();
  expect(await screen.findByText("Couldn’t load this material.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Payroll" })).not.toBeInTheDocument();
});
