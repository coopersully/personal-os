// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  type FinanceConfiguration,
  financeConfigurationCapabilities,
  financeProfileVersionSchema,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { financeStatementSource } from "./configuration-values.js";
import { FinanceSetupPage } from "./setup-page.js";

const api = vi.hoisted(() => ({
  getFinanceConfiguration: vi.fn(),
  updateFinancialProfile: vi.fn(),
  updateFinanceProfile: vi.fn(),
  setupFinances: vi.fn(),
  maintainFinances: vi.fn(),
  listFinanceGoals: vi.fn(),
  listFinanceAccounts: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api, errorMessage: (e: Error) => e.message }));
const id = "11111111-1111-4111-8111-111111111111";
const profile = financeProfileVersionSchema.parse({
  id,
  userId: id,
  version: 1,
  createdAt: "2026-10-06T12:00:00Z",
  debts: [],
  dependents: null,
  expectedMonthlyTakeHome: null,
  householdSize: null,
  incomeStability: "unknown",
  insurance: [],
  jurisdiction: null,
  liquidReserves: null,
  preferences: { bufferTarget: null, debtPriority: null, emergencyReserveMonths: null, notes: [] },
  provenance: {},
});
function configuration(): FinanceConfiguration {
  return {
    profile: { state: "loaded", value: profile },
    income: { state: "loaded", value: null },
    accounts: {
      state: "loaded",
      value: {
        accounts: [],
        accountSemantics: {
          excludedAccountIds: [],
          possibleDuplicateGroups: [],
          trustworthy: true,
          unresolvedOwnershipAccountIds: [],
        },
        totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
      },
    },
    budget: { state: "loaded", value: null },
    guidance: { state: "loaded", value: null },
    execution: { state: "loaded", value: null },
    preferences: { state: "unavailable" },
    capabilities: financeConfigurationCapabilities({ state: "loaded", value: null }),
  };
}
function show(url = "/finances/setup") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <FinanceSetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceConfiguration.mockResolvedValue(configuration());
  api.listFinanceGoals.mockResolvedValue({ outcome: "completed", data: [] });
  api.listFinanceAccounts.mockResolvedValue({ accounts: [] });
  api.updateFinancialProfile.mockImplementation(async (input) => ({
    outcome: "completed",
    data: { ...profile, ...input.changes, version: input.expectedVersion + 1 },
  }));
});
it("loads every profile question without starting setup, approval, or maintenance", async () => {
  show();
  expect(await screen.findByLabelText("Household size")).toBeVisible();
  expect(screen.getByLabelText("Reliable monthly income")).toBeVisible();
  expect(screen.getByLabelText("Expected net paycheck")).toBeVisible();
  expect(screen.getByText("Spending priorities")).toBeVisible();
  expect(screen.queryByText("Start or resume setup")).not.toBeInTheDocument();
  expect(api.setupFinances).not.toHaveBeenCalled();
  expect(api.maintainFinances).not.toHaveBeenCalled();
});
it("saves independent scalar edits using the latest version, preserving zero", async () => {
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Dependents"), "0");
  await user.tab();
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1, changes: { dependents: 0 } }),
    ),
  );
  await user.type(screen.getByLabelText("Household size"), "2");
  await user.tab();
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 2, changes: { householdSize: 2 } }),
    ),
  );
});
it("keeps a newer draft while a prior save completes and serializes the next save", async () => {
  let resolve!: (value: unknown) => void;
  api.updateFinancialProfile.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  show();
  const user = userEvent.setup();
  const field = await screen.findByLabelText("Country and state or region");
  await user.type(field, "US");
  await user.tab();
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1));
  await user.type(field, "-NY");
  await user.tab();
  expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({ outcome: "completed", data: { ...profile, jurisdiction: "US", version: 2 } }),
  );
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedVersion: 2, changes: { jurisdiction: "US-NY" } }),
  );
  expect(field).toHaveValue("US-NY");
});
it("keeps invalid drafts and makes absent collections explicitly None", async () => {
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Household size"), "0");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edit is preserved");
  expect(screen.getByLabelText("Household size")).toHaveValue(0);
  expect(api.updateFinancialProfile).not.toHaveBeenCalled();
  const none = screen.getAllByRole("button", { name: "None" })[0];
  if (!none) throw new Error("Missing None action");
  await user.click(none);
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { debts: [] } }),
    ),
  );
});
it("keeps incomplete collection rows local across section navigation", async () => {
  show();
  const user = userEvent.setup();
  await screen.findByLabelText("Household size");
  await user.click(screen.getByRole("button", { name: "Add debts" }));
  await user.type(screen.getByLabelText("Name"), "Loan");
  await user.click(screen.getByRole("button", { name: /Accounts and records/ }));
  expect(api.updateFinancialProfile).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Profile Editable/ }));
  expect(screen.getByLabelText("Name")).toHaveValue("Loan");
});
it("opens independent sections without mutations and retains a safe return link", async () => {
  show("/finances/setup?section=budget&returnTo=%2Ffinances%2Fplan");
  expect(await screen.findByRole("button", { name: "Prepare budget" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Return to previous page" })).toHaveAttribute(
    "href",
    "/finances/plan",
  );
  expect(api.setupFinances).not.toHaveBeenCalled();
});
it("keeps successful sections editable when a sibling read fails", async () => {
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    income: { state: "unavailable" },
  });
  show();
  expect(await screen.findByLabelText("Household size")).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Payroll details could not load");
});
it("does not show failed budget reads as missing setup", async () => {
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    budget: { state: "unavailable" },
  });
  show("/finances/setup?section=budget");
  expect(await screen.findByRole("alert")).toHaveTextContent("Your budget could not load");
  expect(screen.queryByRole("button", { name: "Prepare budget" })).not.toBeInTheDocument();
});

it("persists a return to the original value while its earlier save is pending", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    profile: { state: "loaded", value: { ...profile, jurisdiction: "US" } },
  });
  api.updateFinancialProfile.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  show();
  const user = userEvent.setup();
  const field = await screen.findByLabelText("Country and state or region");
  await user.type(field, "-NY");
  await user.tab();
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1));
  await user.clear(field);
  await user.type(field, "US");
  await user.tab();
  await act(async () =>
    resolve?.({ outcome: "completed", data: { ...profile, jurisdiction: "US-NY", version: 2 } }),
  );
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ changes: { jurisdiction: "US" } }),
  );
});
it("saves calendar selections without requiring a subsequent input blur", async () => {
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    profile: {
      state: "loaded",
      value: {
        ...profile,
        planning: {
          recurringIncome: {
            amountCents: null,
            nextDate: "2026-10-01",
            provenance: financeStatementSource,
          },
        },
      },
    },
  });
  show();
  const user = userEvent.setup();
  await screen.findByLabelText("Next reliable payment");
  const field = screen.getByLabelText("Next reliable payment").closest('[data-slot="field"]');
  if (!field) throw new Error("Missing date field");
  await user.click(within(field as HTMLElement).getByRole("button", { name: "Choose date" }));
  await user.click(screen.getByRole("button", { name: /Saturday, October 3rd, 2026/ }));
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          planning: expect.objectContaining({
            recurringIncome: expect.objectContaining({ nextDate: "2026-10-03" }),
          }),
        }),
      }),
    ),
  );
});

it("serializes payroll changes and preserves a revert during the first save", async () => {
  const income = {
    effectiveDate: "2026-10-06",
    updatedAt: "2026-10-06T12:00:00.000Z",
    employer: "Original",
    role: null,
    employmentType: null,
    expectedNetPay: null,
    grossAnnualIncome: null,
    nextPayday: null,
    payAccountId: null,
    payFrequency: null,
  };
  let current = { ...configuration(), income: { state: "loaded" as const, value: income } };
  api.getFinanceConfiguration.mockImplementation(async () => current);
  let resolve: ((value: unknown) => void) | undefined;
  api.updateFinanceProfile
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockImplementation(async (input) => {
      current = {
        ...current,
        income: {
          state: "loaded",
          value: { ...income, ...input, updatedAt: "2026-10-06T12:00:02.000Z" },
        },
      };
      return current.income.value;
    });
  show();
  const user = userEvent.setup();
  const field = await screen.findByLabelText("Employer");
  await user.clear(field);
  await user.type(field, "Changed");
  await user.tab();
  await waitFor(() => expect(api.updateFinanceProfile).toHaveBeenCalledTimes(1));
  await user.clear(field);
  await user.type(field, "Original");
  await user.tab();
  current = {
    ...current,
    income: {
      state: "loaded",
      value: { ...income, employer: "Changed", updatedAt: "2026-10-06T12:00:01.000Z" },
    },
  };
  await act(async () => resolve?.(current.income.value));
  await waitFor(() => expect(api.updateFinanceProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinanceProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      employer: "Original",
      expectedUpdatedAt: "2026-10-06T12:00:01.000Z",
    }),
  );
});

it("retains in-flight field ordering across section remounts", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    profile: { state: "loaded", value: { ...profile, jurisdiction: "US" } },
  });
  api.updateFinancialProfile.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Country and state or region"), "-NY");
  await user.tab();
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: /Accounts and records/ }));
  await user.click(screen.getByRole("button", { name: /Profile Editable/ }));
  const field = screen.getByLabelText("Country and state or region");
  await user.clear(field);
  await user.type(field, "US");
  await user.tab();
  await act(async () =>
    resolve?.({ outcome: "completed", data: { ...profile, jurisdiction: "US-NY", version: 2 } }),
  );
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ changes: { jurisdiction: "US" }, expectedVersion: 2 }),
  );
});
it("preserves sub-cent currency drafts without silently rounding or saving", async () => {
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Reliable monthly income"), "1.234");
  await user.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edit is preserved");
  expect(api.updateFinancialProfile).not.toHaveBeenCalled();
});
