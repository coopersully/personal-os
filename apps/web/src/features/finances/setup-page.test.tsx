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
  client.setQueryData(["me"], { planningTimezone: "America/New_York" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <FinanceSetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it("dates first payroll settings in the account's planning timezone", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T01:00:00Z"));
  try {
    api.updateFinanceProfile.mockImplementation(async (input) => ({
      profile: { ...input, updatedAt: "2026-10-07T01:00:00Z" },
    }));
    show();
    const user = userEvent.setup();
    const employer = await screen.findByLabelText("Employer");
    await user.type(employer, "New employer");
    await user.tab();
    await waitFor(() =>
      expect(api.updateFinanceProfile).toHaveBeenCalledWith(
        expect.objectContaining({ effectiveDate: "2026-10-06" }),
      ),
    );
  } finally {
    vi.useRealTimers();
  }
});

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

it("saves reserve and income settings without overwriting sibling preferences", async () => {
  let current = profile;
  api.updateFinancialProfile.mockImplementation(async (input) => {
    current = { ...current, ...input.changes, version: input.expectedVersion + 1 };
    return { outcome: "completed", data: current };
  });
  show();
  const user = userEvent.setup();
  await screen.findByLabelText("Household size");
  for (const [label, value, changes] of [
    ["Expected monthly take-home", "4200", { expectedMonthlyTakeHome: 4200 }],
    [
      "Reliable monthly income",
      "4000",
      {
        planning: expect.objectContaining({
          recurringIncome: expect.objectContaining({ amountCents: 400000 }),
        }),
      },
    ],
    ["Liquid reserves", "12000", { liquidReserves: 12000 }],
    ["Monthly buffer", "250", { preferences: expect.objectContaining({ bufferTarget: 250 }) }],
    [
      "Reserve target (months)",
      "6",
      { preferences: expect.objectContaining({ bufferTarget: 250, emergencyReserveMonths: 6 }) },
    ],
    [
      "Planning notes",
      "Keep a buffer",
      {
        preferences: expect.objectContaining({
          notes: ["Keep a buffer"],
          emergencyReserveMonths: 6,
        }),
      },
    ],
  ] as const) {
    await user.type(screen.getByLabelText(label), value);
    await user.tab();
    await waitFor(() =>
      expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
        expect.objectContaining({ changes }),
      ),
    );
  }
  await user.selectOptions(screen.getByLabelText("Income stability"), "variable");
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ changes: { incomeStability: "variable" } }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Debt priority"), "avalanche");
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: {
          preferences: expect.objectContaining({ debtPriority: "avalanche", bufferTarget: 250 }),
        },
      }),
    ),
  );
});
it("creates and removes debt rows while retaining recorded debt metadata", async () => {
  const saved = {
    ...profile,
    debts: [
      { name: "Loan", balance: 500, minimumMonthlyPayment: 20, interestRate: 4, accountId: null },
    ],
  };
  api.getFinanceConfiguration.mockResolvedValue({
    ...configuration(),
    profile: { state: "loaded", value: saved },
  });
  api.listFinanceAccounts.mockResolvedValue({ accounts: [{ id, name: "Credit card" }] });
  show();
  const user = userEvent.setup();
  const row = await screen.findByRole("group", { name: "debts entry" });
  await user.clear(within(row).getByLabelText("Balance"));
  await user.type(within(row).getByLabelText("Balance"), "600");
  await user.selectOptions(within(row).getByLabelText("Debt account"), id);
  await user.click(screen.getByLabelText("Planning notes"));
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: {
          debts: [
            expect.objectContaining({ name: "Loan", balance: 600, interestRate: 4, accountId: id }),
          ],
        },
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Remove Loan" }));
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ changes: { debts: [] } }),
    ),
  );
});
it.each([
  ["Bills and minimum payments", "obligations"],
  ["Other possible income", "uncertainIncome"],
  ["One-time resources", "exceptionalResources"],
  ["Spending priorities", "priorities"],
] as const)("saves and removes %s rows", async (title, kind) => {
  show();
  const user = userEvent.setup();
  await screen.findByLabelText("Household size");
  await user.click(screen.getByRole("button", { name: `Add ${title.toLowerCase()}` }));
  const row = screen.getByRole("group", { name: `${kind} entry` });
  await user.type(within(row).getByLabelText("Name"), "Planned item");
  await user.type(within(row).getByLabelText(/^(Expected|Monthly) amount$/), "125");
  const day = within(row).queryByLabelText("Due day of month");
  if (day) await user.type(day, "15");
  if (kind === "priorities") await user.click(within(row).getByRole("checkbox"));
  await user.click(screen.getByLabelText("Planning notes"));
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: {
          planning: expect.objectContaining({
            [kind]: [
              expect.objectContaining({
                name: "Planned item",
                amountCents: 12500,
                ...(kind === "priorities" ? { protected: true } : {}),
              }),
            ],
          }),
        },
      }),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Remove Planned item" }));
  await waitFor(() =>
    expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ changes: { planning: expect.objectContaining({ [kind]: [] }) } }),
    ),
  );
});
it("requires a goal before saving contributions and preserves a failed collection draft for retry", async () => {
  api.listFinanceGoals.mockResolvedValue({ outcome: "completed", data: [{ id, name: "Reserve" }] });
  show();
  const user = userEvent.setup();
  await screen.findByLabelText("Household size");
  await user.click(screen.getByRole("button", { name: "Add goal contributions" }));
  const row = screen.getByRole("group", { name: "contributions entry" });
  await user.type(within(row).getByLabelText("Name"), "Emergency savings");
  await user.type(within(row).getByLabelText("Monthly amount"), "100");
  await user.click(screen.getByLabelText("Planning notes"));
  expect(api.updateFinancialProfile).not.toHaveBeenCalled();
  await user.selectOptions(within(row).getByLabelText("Goal"), id);
  api.updateFinancialProfile.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByLabelText("Planning notes"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("edits are preserved");
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinancialProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({
      changes: {
        planning: expect.objectContaining({
          contributions: [expect.objectContaining({ goalId: id, amountCents: 10000 })],
        }),
      },
    }),
  );
});

it("prepares a budget only after an explicit action and refreshes saved configuration", async () => {
  api.setupFinances.mockResolvedValue({
    outcome: "completed",
    data: {},
    communication: {
      headline: "Prepared",
      requiredDisclosures: [{ message: "Review before approval" }],
      optionalDetails: [],
    },
  });
  show("/finances/setup?section=budget");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Prepare budget" }));
  await waitFor(() =>
    expect(api.setupFinances).toHaveBeenCalledWith({ operation: "prepare_budget" }),
  );
  expect(await screen.findByText("Review before approval")).toBeVisible();
  await waitFor(() => expect(api.getFinanceConfiguration).toHaveBeenCalledTimes(2));
});
it.each([
  "all",
  "profile",
  "income",
  "accounts",
  "execution",
  "budget",
] as const)("retries unavailable %s configuration without creating a budget", async (part) => {
  if (part === "all") api.getFinanceConfiguration.mockRejectedValueOnce(new Error("Offline"));
  else
    api.getFinanceConfiguration.mockResolvedValueOnce({
      ...configuration(),
      [part]: { state: "unavailable" },
    });
  const section =
    part === "accounts" || part === "execution"
      ? "accounts"
      : part === "budget"
        ? "budget"
        : "profile";
  show(`/finances/setup?section=${section}`);
  const user = userEvent.setup();
  const retry = (await screen.findAllByRole("button", { name: "Retry" }))[0];
  if (!retry) throw new Error("Missing recovery action");
  await user.click(retry);
  await waitFor(() =>
    expect(api.getFinanceConfiguration.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  expect(api.setupFinances).not.toHaveBeenCalled();
});
it("renders account connection states and links an existing budget", async () => {
  const config = configuration();
  if (config.accounts.state !== "loaded") throw new Error("Missing fixture");
  api.getFinanceConfiguration.mockResolvedValue({
    ...config,
    accounts: {
      state: "loaded",
      value: {
        ...config.accounts.value,
        accounts: [
          { id: "a", name: "Savings", status: "needs_reauth" },
          { id: "b", name: "Cash", status: "manual" },
          { id: "c", name: "Card", status: "connected" },
        ],
      },
    },
    budget: { state: "loaded", value: { id } },
  });
  show("/finances/setup?section=accounts&returnTo=https%3A%2F%2Fevil.test");
  expect(await screen.findByText("Reconnect required")).toBeVisible();
  expect(screen.getByText("Manual account")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Return to previous page" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Budget Draft/ }));
  expect(screen.getByRole("link", { name: "Open budget" })).toHaveAttribute(
    "href",
    "/finances/plan",
  );
});
it("retries a rejected payroll change without losing the draft", async () => {
  api.updateFinanceProfile
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementation(async (input) => ({ ...input, updatedAt: "2026-10-06T12:00:00Z" }));
  show();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Expected net paycheck"), "2000");
  await user.tab();
  const alert = await screen.findByRole("alert");
  expect(screen.getByLabelText("Expected net paycheck")).toHaveValue("2,000.00");
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.updateFinanceProfile).toHaveBeenCalledTimes(2));
  expect(api.updateFinanceProfile).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedNetPay: 2000 }),
  );
});
it.each([
  "Country and state or region",
  "Expected net paycheck",
])("discards the failed %s draft when reloading saved information", async (label) => {
  api.updateFinancialProfile.mockRejectedValue(new Error("Offline"));
  api.updateFinanceProfile.mockRejectedValue(new Error("Offline"));
  show();
  const user = userEvent.setup();
  const field = await screen.findByLabelText(label);
  await user.type(field, label === "Expected net paycheck" ? "2000" : "US-NY");
  await user.tab();
  const alert = await screen.findByRole("alert");
  await user.click(within(alert).getByRole("button", { name: "Reload saved information" }));
  await waitFor(() => expect(field).toHaveValue(""));
  await user.click(field);
  await user.tab();
  expect(
    api.updateFinancialProfile.mock.calls.length + api.updateFinanceProfile.mock.calls.length,
  ).toBe(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
