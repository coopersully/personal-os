// @vitest-environment jsdom

import { workspacePreferenceSchemas } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FinanceConfigurationSettings,
  FinancialProfileSettingsScreen,
  financeNumber,
  PayrollSettingsScreen,
} from "./finance-settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  timezone: "America/New_York" as string | undefined,
  confirm: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  save: vi.fn(),
  resources: {} as Record<string, unknown>,
  api: {} as Record<string, unknown>,
  loadProfile: vi.fn(),
  payroll: vi.fn(),
  reloadConfiguration: vi.fn(),
  refetch: vi.fn(),
  errors: new Set<string>(),
  pending: new Set<string>(),
  uuid: 0,
  writeWorkspace: vi.fn(),
  loadWorkspace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  allowDismiss: vi.fn(),
  session: {} as { epoch: () => number; api: () => Record<string, unknown> },
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++h.uuid).padStart(12, "0")}`,
}));
vi.mock("expo-router", () => ({
  router: { back: h.back, push: h.push },
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) =>
      options?.headerLeft?.() ?? null,
  },
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => ({
    headerLeft: () => (
      <button type="button" disabled={disabled} onClick={onPress}>
        {label}
      </button>
    ),
  }),
}));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({
  useDirtyDismiss: () => h.allowDismiss,
}));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button type="button" aria-label="Save changes" disabled={disabled} onClick={onPress} />
  ),
}));
vi.mock("../../components/forms/planning-picker", () => ({
  PlanningPicker: ({
    label,
    value,
    timeZone,
    mode,
    onChange,
  }: {
    label: string;
    value: string;
    timeZone: string;
    mode: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      data-native-mode={mode}
      data-timezone={timeZone}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "fixture", planningTimezone: h.timezone } },
    session: h.session,
  }),
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => ({
    data: h.resources[key],
    isPending: h.pending.has(key),
    isError: h.errors.has(key),
    refetch: () => h.refetch(key),
  }),
  useSettingsAction: () => ({
    pending: false,
    run: async (action: (api: unknown) => Promise<unknown>, success?: string) => {
      try {
        const value = await action(h.api);
        if (success) h.success(success);
        return { ok: true, value };
      } catch (error) {
        h.error(error);
        return { ok: false };
      }
    },
  }),
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  FormBody: ({ children }: PropsWithChildren) => <div data-scroll>{children}</div>,
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) =>
    loading ? (
      <span role="progressbar" />
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry loading
      </button>
    ) : (
      <span>{empty}</span>
    ),
  Choice: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  confirm: h.confirm,
  Field: ({
    label,
    value,
    onChangeText,
    editable,
    multiline,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
    multiline?: boolean;
  }) =>
    multiline ? (
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        disabled={!editable}
      />
    ) : (
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        disabled={!editable}
      />
    ),
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.uuid = 0;
  h.timezone = "America/New_York";
  h.session = { epoch: () => 1, api: () => h.api };
  h.writeWorkspace.mockReset();
  h.loadWorkspace.mockReset();
  h.errors.clear();
  h.pending.clear();
  h.api = {
    updateWorkspaceSettings: h.writeWorkspace,
    getWorkspaceSettings: h.loadWorkspace,
    updateFinancialProfile: h.save,
    getFinancialProfile: h.loadProfile,
    updateFinanceProfile: h.payroll,
    getFinanceConfiguration: h.reloadConfiguration,
  };
  h.save.mockReset();
  h.payroll.mockReset();
  h.loadProfile.mockReset();
  h.reloadConfiguration.mockReset();
  h.resources = {
    "financial-profile": null,
    "finance-accounts": { accounts: [] },
    "finance-goals": [],
  };
});
it("keeps profile Save outside long collections and uses account-timezone date controls", async () => {
  render(<FinancialProfileSettingsScreen />);
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save.closest("[data-scroll]")).toBeNull();
  expect(save).toBeDisabled();
  expect(screen.getByLabelText("Next reliable payment")).toHaveAttribute(
    "data-native-mode",
    "date",
  );
  expect(screen.getByLabelText("Next reliable payment")).toHaveAttribute(
    "data-timezone",
    "America/New_York",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add other possible income" }));
  expect(screen.getByLabelText("Expected date")).toHaveAttribute("data-native-mode", "date");
  expect(save).toBeEnabled();
});
it("retains a profile draft and blocks resubmission for an unconfirmed Finance outcome", async () => {
  h.save.mockResolvedValue({
    outcome: "user_input_required",
    communication: { headline: "Need more information" },
    data: null,
  });
  render(<FinancialProfileSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Country and state or region"), {
    target: { value: "US, NY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.save).toHaveBeenCalledWith({
    changes: { jurisdiction: "US, NY" },
    expectedVersion: 0,
    idempotencyKey: expect.any(String),
  });
  expect(screen.getByLabelText("Country and state or region")).toHaveValue("US, NY");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Need more information")).not.toBeInTheDocument();
});
it("uses the same floating Save and native date picker for payroll", () => {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "loaded", value: { accounts: [] } },
  };
  render(<PayrollSettingsScreen />);
  expect(screen.getByLabelText("Next payday")).toHaveAttribute("data-native-mode", "date");
  expect(screen.getByLabelText("Next payday")).toHaveAttribute("data-timezone", "America/New_York");
  expect(screen.getByRole("button", { name: "Save changes" }).closest("[data-scroll]")).toBeNull();
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Engineer" } });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

const id = (number: number) => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`;
const provenance = {
  actorId: null,
  actorType: "user",
  confidence: null,
  evidence: {},
  maintenanceRunId: null,
  observedAt: "2026-11-10T00:00:00.000Z",
  requestId: null,
  sourceId: null,
};
const profileFixture = () => ({
  id: id(1),
  userId: id(2),
  createdAt: "2026-11-10T00:00:00.000Z",
  version: 7,
  jurisdiction: "US, NY",
  householdSize: 2,
  dependents: 0,
  expectedMonthlyTakeHome: 3000,
  incomeStability: "stable",
  liquidReserves: 1000,
  preferences: {
    bufferTarget: 100,
    debtPriority: null,
    emergencyReserveMonths: 3,
    notes: ["Preserved note"],
  },
  debts: [
    { name: "Loan", accountId: id(8), balance: 500, interestRate: 5, minimumMonthlyPayment: 20 },
  ],
  insurance: [
    {
      name: "Life policy",
      kind: "life",
      status: "active",
      annualPremium: 100,
      coverageAmount: 10000,
    },
  ],
  provenance: {},
  planning: {
    recurringIncome: { amountCents: 300000, nextDate: "2026-12-01", provenance },
    uncertainIncome: [
      {
        id: id(11),
        name: "Consulting",
        amountCents: 10000,
        expectedDate: "2026-12-10",
        provenance,
      },
    ],
    exceptionalResources: [
      { id: id(12), name: "Gift", amountCents: 10000, expectedDate: "2026-12-10", provenance },
    ],
    obligations: [
      {
        id: id(13),
        name: "Internet",
        amountCents: 10000,
        dueDay: 5,
        debtAccountId: null,
        provenance,
      },
    ],
    contributions: [
      { id: id(14), name: "Retirement", amountCents: 10000, dueDay: 5, goalId: id(20), provenance },
    ],
    priorities: [
      {
        id: id(15),
        name: "Groceries",
        amountCents: 10000,
        dueDay: 5,
        categoryId: id(30),
        protected: false,
        provenance,
      },
    ],
  },
});
const change = (label: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });
const accept = async () => {
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
};
function loadPopulatedProfile() {
  const profile = profileFixture();
  h.resources["financial-profile"] = profile;
  h.resources["finance-accounts"] = {
    accounts: [{ id: id(9), institution: "Fixture bank", name: "Checking" }],
  };
  h.resources["finance-goals"] = [
    { id: id(20), name: "Retirement goal" },
    { id: id(21), name: "Emergency goal" },
  ];
  h.save.mockImplementation(async (input) => ({
    outcome: "completed",
    data: { ...profile, ...input.changes, version: input.expectedVersion + 1 },
  }));
  return profile;
}
it("saves reviewed household, reserves, linked debts, insurance and planning edits in one versioned profile change", async () => {
  loadPopulatedProfile();
  render(<FinancialProfileSettingsScreen />);
  for (const [label, value] of [
    ["Country and state or region", "US, CA"],
    ["Household size", "3"],
    ["Dependents", "1"],
    ["Expected monthly take-home", "4000"],
    ["Income stability", "variable"],
    ["Reliable monthly income", "3500"],
    ["Next reliable payment", "2026-12-05"],
    ["Liquid reserves", "2000"],
    ["Monthly buffer", "250"],
    ["Reserve target (months)", "4"],
    ["Debt priority", "avalanche"],
    ["Planning notes (one per line)", "Review monthly"],
  ])
    change(label ?? "", value ?? "");
  const loan = screen.getByRole("region", { name: "Loan" });
  for (const [label, value] of [
    ["Debt name", "Student loan"],
    ["Balance", "800"],
    ["Monthly minimum", "40"],
    ["Interest rate (%)", "4"],
    ["Debt account", id(9)],
  ])
    change(label ?? "", value ?? "", loan);
  const insurance = screen.getByRole("region", { name: "Life policy" });
  for (const [label, value] of [
    ["Policy name", "Life cover"],
    ["Kind", "disability"],
    ["Status", "lapsed"],
    ["Annual premium", "120"],
    ["Coverage amount", "20000"],
  ])
    change(label ?? "", value ?? "", insurance);
  for (const name of ["Consulting", "Gift", "Internet", "Retirement", "Groceries"]) {
    const row = screen.getByRole("region", { name });
    change("Name", `${name} reviewed`, row);
    change(
      name === "Consulting" || name === "Gift" ? "Expected amount" : "Monthly amount",
      "150",
      row,
    );
    change(
      name === "Consulting" || name === "Gift" ? "Expected date" : "Due day of month",
      name === "Consulting" || name === "Gift" ? "2026-12-15" : "12",
      row,
    );
    if (name === "Internet") change("Debt account", id(9), row);
    if (name === "Retirement") change("Goal", id(21), row);
    if (name === "Groceries") fireEvent.click(within(row).getByLabelText("Protect this priority"));
  }
  expect(h.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  const input = h.save.mock.calls[0]?.[0];
  expect(input).toMatchObject({
    expectedVersion: 7,
    changes: {
      jurisdiction: "US, CA",
      householdSize: 3,
      dependents: 1,
      expectedMonthlyTakeHome: 4000,
      incomeStability: "variable",
      liquidReserves: 2000,
      preferences: {
        bufferTarget: 250,
        emergencyReserveMonths: 4,
        debtPriority: "avalanche",
        notes: ["Review monthly"],
      },
      debts: [
        {
          name: "Student loan",
          accountId: id(9),
          balance: 800,
          interestRate: 4,
          minimumMonthlyPayment: 40,
        },
      ],
      insurance: [
        {
          name: "Life cover",
          kind: "disability",
          status: "lapsed",
          annualPremium: 120,
          coverageAmount: 20000,
        },
      ],
      planning: {
        recurringIncome: { amountCents: 350000, nextDate: "2026-12-05" },
        obligations: [
          { name: "Internet reviewed", amountCents: 15000, dueDay: 12, debtAccountId: id(9) },
        ],
        contributions: [{ goalId: id(21) }],
        priorities: [{ categoryId: id(30), protected: true }],
      },
    },
  });
  expect(h.success).toHaveBeenCalledWith("Financial profile saved");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});
it("adds new stated debt, insurance and all planning collection kinds without treating unknown fields as zero", async () => {
  h.resources["finance-goals"] = [{ id: id(20), name: "Goal" }];
  h.save.mockImplementation(async (input) => ({
    outcome: "completed",
    data: { ...profileFixture(), ...input.changes, version: 1 },
  }));
  render(<FinancialProfileSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
  change("Debt name", "New loan");
  change("Balance", "100");
  change("Monthly minimum", "10");
  fireEvent.click(screen.getByRole("button", { name: "Add insurance" }));
  change("Policy name", "New insurance");
  for (const [title, dated] of [
    ["Bills and minimum payments", false],
    ["Other possible income", true],
    ["One-time resources", true],
    ["Goal contributions", false],
    ["Spending priorities", false],
  ] as const) {
    const region = screen.getByRole("region", { name: title });
    fireEvent.click(within(region).getByRole("button", { name: `Add ${title.toLowerCase()}` }));
    change("Name", title, region);
    change(dated ? "Expected amount" : "Monthly amount", "25", region);
    change(dated ? "Expected date" : "Due day of month", dated ? "2026-12-15" : "15", region);
    if (title === "Goal contributions") {
      change("Goal", id(20), region);
    }
  }
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save).toHaveBeenCalledOnce();
  expect(h.save.mock.calls[0]?.[0]).toMatchObject({
    expectedVersion: 0,
    changes: {
      debts: [{ name: "New loan", balance: 100, minimumMonthlyPayment: 10 }],
      insurance: [{ name: "New insurance", kind: "other", status: "unknown" }],
      planning: {
        obligations: [{ amountCents: 2500, dueDay: 15 }],
        uncertainIncome: [{ amountCents: 2500, expectedDate: "2026-12-15" }],
        exceptionalResources: [{ amountCents: 2500 }],
        contributions: [{ goalId: id(20) }],
        priorities: [{ protected: false }],
      },
    },
  });
});
it("requires named confirmation before removing stated records and commits removals explicitly", async () => {
  loadPopulatedProfile();
  render(<FinancialProfileSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Remove debt 1" }));
  expect(screen.getByLabelText("Debt name")).toHaveValue("Loan");
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Remove Loan?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await accept();
  expect(screen.queryByLabelText("Debt name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove insurance 1" }));
  await accept();
  fireEvent.click(screen.getByRole("button", { name: "Remove bills and minimum payments item 1" }));
  await accept();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save.mock.calls[0]?.[0]).toMatchObject({
    changes: { debts: [], insurance: [], planning: { obligations: [] } },
  });
});
it("distinguishes explicitly absent planning collections from unanswered collections", async () => {
  h.save.mockResolvedValue({
    outcome: "completed",
    data: {
      ...profileFixture(),
      planning: {
        ...profileFixture().planning,
        uncertainIncome: [],
        exceptionalResources: [],
        obligations: [],
        contributions: [],
        priorities: [],
      },
    },
  });
  render(<FinancialProfileSettingsScreen />);
  for (const name of [
    "bills and minimum payments",
    "other possible income",
    "one-time resources",
    "goal contributions",
    "spending priorities",
  ])
    fireEvent.click(screen.getByRole("button", { name: `Confirm no ${name}` }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save.mock.calls[0]?.[0].changes.planning).toMatchObject({
    recurringIncome: null,
    uncertainIncome: [],
    exceptionalResources: [],
    obligations: [],
    contributions: [],
    priorities: [],
  });
});
it("retains a rejected profile until explicit authoritative reload and then writes against the reviewed revision", async () => {
  loadPopulatedProfile();
  h.save.mockRejectedValueOnce(new Error("Conflict"));
  h.loadProfile.mockResolvedValue({
    outcome: "completed",
    data: { ...profileFixture(), version: 9, jurisdiction: "CA" },
  });
  render(<FinancialProfileSettingsScreen />);
  change("Country and state or region", "US, TX");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(screen.getByLabelText("Country and state or region")).toHaveValue("US, TX");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved profile" }));
  await accept();
  expect(screen.getByLabelText("Country and state or region")).toHaveValue("CA");
  expect(h.save).toHaveBeenCalledOnce();
  change("Country and state or region", "NZ");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save.mock.calls[1]?.[0]).toMatchObject({
    expectedVersion: 9,
    changes: { jurisdiction: "NZ" },
  });
  expect(h.save.mock.calls[1]?.[0].idempotencyKey).not.toBe(
    h.save.mock.calls[0]?.[0].idempotencyKey,
  );
});
const payrollFixture = () => ({
  id: id(40),
  employer: "Original",
  role: "Engineer",
  employmentType: "full_time",
  grossAnnualIncome: 90000,
  expectedNetPay: 2500,
  payFrequency: "monthly",
  nextPayday: "2026-12-01",
  payAccountId: id(8),
  effectiveDate: "2026-10-01",
  updatedAt: "2026-11-10T00:00:00.000Z",
  householdSize: 2,
});
function loadPayroll() {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: payrollFixture() },
    accounts: {
      state: "loaded",
      value: { accounts: [{ id: id(9), institution: "Bank", name: "Checking" }] },
    },
  };
}
it.each([
  "legacy",
  "applied",
])("saves payroll through the supported %s outcome with its reviewed revision and unrelated facts", async (mode) => {
  loadPayroll();
  h.payroll.mockImplementation(async (input) => {
    const result = { ...payrollFixture(), ...input, updatedAt: "2026-11-11T00:00:00.000Z" };
    return mode === "applied" ? { status: "applied", result } : result;
  });
  render(<PayrollSettingsScreen />);
  for (const [label, value] of [
    ["Employer", "New employer"],
    ["Role", "Lead"],
    ["Employment type", "contract"],
    ["Gross annual income", "100000.50"],
    ["Expected net paycheck", "3000.25"],
    ["Pay frequency", "biweekly"],
    ["Next payday", "2026-12-15"],
    ["Pay account", id(9)],
  ])
    change(label ?? "", value ?? "");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.payroll).toHaveBeenCalledOnce());
  expect(h.payroll.mock.calls[0]?.[0]).toMatchObject({
    expectedUpdatedAt: payrollFixture().updatedAt,
    effectiveDate: "2026-10-01",
    householdSize: 2,
    employer: "New employer",
    role: "Lead",
    employmentType: "contract",
    grossAnnualIncome: 100000.5,
    expectedNetPay: 3000.25,
    payFrequency: "biweekly",
    nextPayday: "2026-12-15",
    payAccountId: id(9),
  });
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Payroll details saved"));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});
it.each([
  "pending_review",
  "needs_input",
])("does not call payroll %s a completed save and requires review before another attempt", async (status) => {
  loadPayroll();
  h.payroll.mockResolvedValue({ status });
  h.reloadConfiguration
    .mockResolvedValueOnce({ income: { state: "unavailable" } })
    .mockResolvedValueOnce({
      income: {
        state: "loaded",
        value: {
          ...payrollFixture(),
          role: "Reviewed remote role",
          updatedAt: "2026-11-12T00:00:00.000Z",
        },
      },
    });
  render(<PayrollSettingsScreen />);
  change("Role", "Local draft");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Role")).toHaveValue("Local draft");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload payroll details" }));
  await accept();
  expect(screen.getByLabelText("Role")).toHaveValue("Local draft");
  fireEvent.click(screen.getByRole("button", { name: "Reload payroll details" }));
  await accept();
  expect(screen.getByLabelText("Role")).toHaveValue("Reviewed remote role");
  expect(h.payroll).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

it("preserves unknown numeric facts, rejects nonfinite values and avoids coercing blanks to zero", () => {
  expect(financeNumber("")).toBeNull();
  expect(financeNumber("3")).toBe(3);
  expect(() => financeNumber("Infinity")).toThrow("valid number");
});
function financeConfiguration(preferences = workspacePreferenceSchemas.finances.parse({})) {
  return {
    capabilities: {
      budget: { state: "needs_input", reason: "Create a budget" },
      cashflow: { state: "ready", reason: null },
    },
    preferences: { state: "loaded", value: { workspace: "finances", revision: 8, preferences } },
    accounts: {
      state: "loaded",
      value: { accounts: [{ id: id(9), institution: "Bank", name: "Checking" }] },
    },
  };
}
it("keeps independent account selections partial and revisioned while distinguishing follow-all from an explicit empty set", async () => {
  h.resources["finance-configuration"] = financeConfiguration();
  h.writeWorkspace.mockImplementation(async (_workspace, input) => ({
    workspace: "finances",
    revision: input.expectedRevision + 1,
    preferences: { ...workspacePreferenceSchemas.finances.parse({}), ...input.preferences },
  }));
  render(<FinanceConfigurationSettings />);
  const spending = within(screen.getByRole("region", { name: "Spending" }));
  await act(async () => fireEvent.click(spending.getByLabelText("Follow all eligible accounts")));
  await waitFor(() => expect(spending.getByLabelText("Bank · Checking")).toBeEnabled());
  expect(h.writeWorkspace.mock.calls[0]).toEqual([
    "finances",
    { expectedRevision: 8, preferences: { spendAccountIds: [] } },
  ]);
  await act(async () => fireEvent.click(spending.getByLabelText("Bank · Checking")));
  await act(async () => fireEvent.click(spending.getByLabelText("Bank · Checking")));
  await act(async () => fireEvent.click(spending.getByLabelText("Follow all eligible accounts")));
  expect(h.writeWorkspace.mock.calls.map((call) => call[1].preferences)).toEqual([
    { spendAccountIds: [] },
    { spendAccountIds: [id(9)] },
    { spendAccountIds: [] },
    { spendAccountIds: null },
  ]);
  expect(h.writeWorkspace.mock.calls.map((call) => call[1].expectedRevision)).toEqual([
    8, 9, 10, 11,
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: "Household, planning and financial profile" }),
  );
  expect(h.push).toHaveBeenCalledWith("/settings/finances/profile");
  fireEvent.click(screen.getByRole("button", { name: "Payroll details" }));
  expect(h.push).toHaveBeenCalledWith("/settings/finances/payroll");
});
it("retains unavailable selected accounts and removes them only after named review", async () => {
  h.resources["finance-configuration"] = financeConfiguration(
    workspacePreferenceSchemas.finances.parse({ spendAccountIds: [id(99)] }),
  );
  h.writeWorkspace.mockImplementation(async (_workspace, input) => ({
    workspace: "finances",
    revision: 9,
    preferences: { ...workspacePreferenceSchemas.finances.parse({}), ...input.preferences },
  }));
  render(<FinanceConfigurationSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Remove unavailable selected account" }));
  expect(h.writeWorkspace).not.toHaveBeenCalled();
  await accept();
  expect(h.writeWorkspace).toHaveBeenCalledWith("finances", {
    expectedRevision: 8,
    preferences: { spendAccountIds: [] },
  });
});
it("blocks rejected account-set writes until authoritative reload/review, then uses the reviewed revision", async () => {
  h.resources["finance-configuration"] = financeConfiguration();
  h.writeWorkspace
    .mockRejectedValueOnce(new Error("Stale revision"))
    .mockImplementation(async (_workspace, input) => ({
      workspace: "finances",
      revision: input.expectedRevision + 1,
      preferences: { ...workspacePreferenceSchemas.finances.parse({}), ...input.preferences },
    }));
  h.loadWorkspace.mockResolvedValue({
    workspace: "finances",
    revision: 12,
    preferences: workspacePreferenceSchemas.finances.parse({}),
  });
  render(<FinanceConfigurationSettings />);
  const cash = within(screen.getByRole("region", { name: "Cash" }));
  await act(async () => fireEvent.click(cash.getByLabelText("Follow all eligible accounts")));
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(cash.getByLabelText("Follow all eligible accounts")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reload and review account selections" }));
  expect(h.loadWorkspace).not.toHaveBeenCalled();
  await accept();
  expect(cash.getByLabelText("Follow all eligible accounts")).toBeChecked();
  await act(async () => fireEvent.click(cash.getByLabelText("Follow all eligible accounts")));
  expect(h.writeWorkspace.mock.calls[1]?.[1]).toMatchObject({
    expectedRevision: 12,
    preferences: { cashAccountIds: [] },
  });
});
it("keeps unavailable configuration honest and retries the actual failed read", () => {
  h.errors.add("finance-configuration");
  const { rerender } = render(<FinanceConfigurationSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledWith("finance-configuration");
  h.resources["finance-configuration"] = {
    ...financeConfiguration(),
    accounts: { state: "unavailable" },
  };
  rerender(<FinanceConfigurationSettings />);
  expect(screen.getByText("budget: needs input · Create a budget")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading account preferences" }));
  expect(h.refetch).toHaveBeenCalledTimes(2);
});
it("offers initial profile and payroll loading recovery without rendering empty-success editors", () => {
  h.resources["financial-profile"] = undefined;
  h.errors.add("financial-profile");
  const { rerender } = render(<FinancialProfileSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledWith("financial-profile");
  h.resources["finance-configuration"] = { income: { state: "unavailable" } };
  rerender(<PayrollSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledWith("finance-configuration");
  expect(screen.queryByLabelText("Employer")).not.toBeInTheDocument();
});

it.each([
  "financial",
  "payroll",
] as const)("retains an unsaved %s draft until discard is explicitly accepted", async (kind) => {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "loaded", value: { accounts: [] } },
  };
  render(kind === "financial" ? <FinancialProfileSettingsScreen /> : <PayrollSettingsScreen />);
  const label = kind === "financial" ? "Country and state or region" : "Employer";
  const value = kind === "financial" ? "US, NY" : "Fixture employer";
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.confirm).toHaveBeenCalledWith(
    kind === "financial" ? "Discard financial changes?" : "Discard payroll changes?",
    "Unsaved changes will be lost.",
    expect.any(Function),
    true,
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(h.allowDismiss).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label)).toHaveValue(value);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await accept();
  expect(h.allowDismiss).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.save).not.toHaveBeenCalled();
  expect(h.payroll).not.toHaveBeenCalled();
});

it.each([
  "financial",
  "payroll",
] as const)("leaves a pristine %s editor without a discard prompt or write", (kind) => {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "loaded", value: { accounts: [] } },
  };
  render(kind === "financial" ? <FinancialProfileSettingsScreen /> : <PayrollSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.confirm).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
  expect(h.payroll).not.toHaveBeenCalled();
});

it("retries missing related Finance reads while retaining an entered planning draft", () => {
  h.errors.add("finance-accounts");
  h.errors.add("finance-goals");
  render(<FinancialProfileSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Country and state or region"), {
    target: { value: "US, NY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry loading related accounts" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry loading financial goals" }));
  expect(h.refetch.mock.calls).toEqual([["finance-accounts"], ["finance-goals"]]);
  expect(screen.getByLabelText("Country and state or region")).toHaveValue("US, NY");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  expect(h.save).not.toHaveBeenCalled();
});

it("clears optional stated facts without zero coercion while preserving other debt, insurance and planning rows", async () => {
  const profile = loadPopulatedProfile();
  const secondDebt = { ...profile.debts[0], name: "Second loan" };
  const secondInsurance = { ...profile.insurance[0], name: "Second cover" };
  const secondIncome = {
    ...profile.planning.uncertainIncome[0],
    id: id(98),
    name: "Second income",
  };
  h.resources["financial-profile"] = {
    ...profile,
    debts: [...profile.debts, secondDebt],
    insurance: [...profile.insurance, secondInsurance],
    planning: {
      ...profile.planning,
      uncertainIncome: [...profile.planning.uncertainIncome, secondIncome],
    },
  };
  render(<FinancialProfileSettingsScreen />);
  for (const label of [
    "Country and state or region",
    "Reliable monthly income",
    "Next reliable payment",
    "Debt priority",
  ])
    change(label, "");
  const debt = screen.getByRole("region", { name: "Loan" });
  change("Balance", "", debt);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save).not.toHaveBeenCalled();
  change("Balance", "500", debt);
  change("Monthly minimum", "", debt);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save).not.toHaveBeenCalled();
  change("Monthly minimum", "20", debt);
  change("Debt account", "", debt);
  change("Interest rate (%)", "", debt);
  const insurance = screen.getByRole("region", { name: "Life policy" });
  change("Annual premium", "", insurance);
  change("Coverage amount", "", insurance);
  const income = screen.getByRole("region", { name: "Consulting" });
  change("Expected amount", "", income);
  change("Expected date", "", income);
  const bill = screen.getByRole("region", { name: "Internet" });
  change("Debt account", "", bill);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await accept();
  expect(h.save).toHaveBeenCalledOnce();
  expect(h.save.mock.calls[0]?.[0].changes).toMatchObject({
    jurisdiction: null,
    debts: [
      {
        name: "Loan",
        accountId: null,
        balance: 500,
        minimumMonthlyPayment: 20,
        interestRate: null,
      },
      secondDebt,
    ],
    insurance: [
      { name: "Life policy", annualPremium: null, coverageAmount: null },
      secondInsurance,
    ],
    planning: {
      recurringIncome: { amountCents: null, nextDate: null },
      uncertainIncome: [
        { name: "Consulting", amountCents: null, expectedDate: null },
        secondIncome,
      ],
    },
  });
});
it("requires confirmation to remove unnamed new stated records instead of treating deletion as cancelling a policy", async () => {
  render(<FinancialProfileSettingsScreen />);
  fireEvent.click(screen.getByText("Add debt"));
  fireEvent.click(screen.getByText("Remove debt 1"));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Remove debt?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await accept();
  expect(screen.queryByLabelText("Debt name")).toBeNull();
  fireEvent.click(screen.getByText("Add insurance"));
  fireEvent.click(screen.getByText("Remove insurance 1"));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Remove insurance?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await accept();
  expect(screen.queryByLabelText("Policy name")).toBeNull();
  fireEvent.click(screen.getByText("Add other possible income"));
  fireEvent.click(screen.getByText("Remove other possible income item 1"));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Remove item?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await accept();
  expect(h.save).not.toHaveBeenCalled();
});
it("creates a partial payroll statement with unknown optional values and an account-timezone effective date", async () => {
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "unavailable", reason: "not_connected" },
  };
  h.payroll.mockImplementation(async (input) => ({ ...payrollFixture(), ...input }));
  render(<PayrollSettingsScreen />);
  expect(screen.getByLabelText("Pay account")).toBeDisabled();
  change("Employer", "Part-time role");
  change("Gross annual income", "");
  change("Expected net paycheck", "");
  change("Next payday", "");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.payroll).toHaveBeenCalledOnce());
  expect(h.payroll.mock.calls[0]?.[0]).toMatchObject({
    employer: "Part-time role",
    expectedUpdatedAt: null,
    grossAnnualIncome: null,
    expectedNetPay: null,
    nextPayday: null,
    effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

it("keeps payroll account selection unavailable while related account data is missing and uses explicit optional facts", async () => {
  h.timezone = undefined;
  h.resources["finance-configuration"] = {
    income: { state: "loaded", value: null },
    accounts: { state: "unavailable", reason: "not_connected" },
  };
  render(<PayrollSettingsScreen />);
  expect(screen.getByLabelText("Next payday")).toHaveAttribute("data-timezone", "UTC");
  expect(screen.getByLabelText("Pay account")).toBeDisabled();
  change("Employer", "New employer");
  change("Next payday", "2026-12-15");
  expect(h.payroll).not.toHaveBeenCalled();
});
it("renders an unanswered planning profile honestly while related accounts and goals are unavailable", () => {
  h.timezone = undefined;
  delete h.resources["finance-accounts"];
  delete h.resources["finance-goals"];
  render(<FinancialProfileSettingsScreen />);
  expect(screen.getByLabelText("Next reliable payment")).toHaveAttribute("data-timezone", "UTC");
  change("Reliable monthly income", "1200");
  fireEvent.click(screen.getByText("Add other possible income"));
  expect(screen.getByLabelText("Expected date")).toHaveAttribute("data-timezone", "UTC");
  fireEvent.click(screen.getByText("Add goal contributions"));
  expect(screen.getByLabelText("Goal")).toBeDisabled();
  expect(h.save).not.toHaveBeenCalled();
});
it("shows initial pending configuration/profile reads rather than a retry error or blank editor", () => {
  delete h.resources["finance-configuration"];
  h.pending.add("finance-configuration");
  const view = render(<FinanceConfigurationSettings />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(screen.queryByText("Retry loading")).toBeNull();
  view.unmount();
  delete h.resources["financial-profile"];
  h.pending.add("financial-profile");
  render(<FinancialProfileSettingsScreen />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(screen.queryByLabelText("Country and state or region")).toBeNull();
});
