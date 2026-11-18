// @vitest-environment jsdom

import type { FinanceProfileVersion, FinanceToolResult } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FinanceConfigurationSettings,
  financeAmount,
  financialProfileInput,
  payrollInput,
  requireCompletedFinanceResult,
} from "./finance-settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  resource: undefined as unknown,
  update: vi.fn(),
  run: vi.fn(),
  confirm: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() }, Stack: { Screen: () => null } }));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "fixture" } },
    session: { epoch: () => 1, api: () => ({ updateWorkspaceSettings: h.update }) },
  }),
}));
vi.mock("./data", () => ({
  useSettingsResource: () => ({ data: h.resource }),
  useSettingsAction: () => ({ pending: false, run: h.run }),
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <div>{children}</div>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: () => null,
  Field: () => null,
  Choice: () => null,
  confirm: h.confirm,
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    disabled: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <input
      aria-label={label}
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={() => onChange(!value)}
    />
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.run.mockImplementation(async (action) => ({
    ok: true,
    value: await action({ updateWorkspaceSettings: h.update }),
  }));
});
const profile: FinanceProfileVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-11-10T00:00:00.000Z",
  version: 7,
  debts: [
    { name: "Loan", accountId: null, balance: 500, interestRate: 3, minimumMonthlyPayment: 25 },
  ],
  dependents: 1,
  expectedMonthlyTakeHome: 3000,
  householdSize: 2,
  incomeStability: "stable",
  insurance: [],
  jurisdiction: "US, NY",
  liquidReserves: 1500,
  preferences: {
    bufferTarget: 200,
    debtPriority: "avalanche",
    emergencyReserveMonths: 3,
    notes: ["Preserve"],
  },
  planning: null,
  provenance: {},
};
const draft = () => {
  const {
    id: _id,
    userId: _user,
    createdAt: _created,
    version: _version,
    provenance: _provenance,
    ...fields
  } = profile;
  return fields;
};
it("sends only changed profile fields with the reviewed version and retry identity", () => {
  const input = financialProfileInput(profile, { ...draft(), householdSize: 3 }, "stable-attempt");
  expect(input).toEqual({
    changes: { householdSize: 3 },
    expectedVersion: 7,
    idempotencyKey: "stable-attempt",
  });
  expect(profile.debts[0]?.interestRate).toBe(3);
  expect(() =>
    financialProfileInput(profile, { ...draft(), dependents: Number.NaN }, "attempt"),
  ).toThrow();
  expect(() => financialProfileInput(profile, draft(), "attempt")).toThrow();
  expect(() =>
    financialProfileInput(profile, { ...draft(), householdSize: 0 }, "attempt"),
  ).toThrow();
});
it("keeps full nested preference facts while changing one preference", () => {
  expect(
    financialProfileInput(
      profile,
      { ...draft(), preferences: { ...profile.preferences, bufferTarget: 400 } },
      "attempt",
    ).changes,
  ).toEqual({ preferences: { ...profile.preferences, bufferTarget: 400 } });
});
it("rejects pending, input-required, external, work-remaining and failed tool results as saved data", () => {
  for (const outcome of [
    "failed",
    "work_remaining",
    "user_input_required",
    "external_action_required",
  ] as const)
    expect(() =>
      requireCompletedFinanceResult({
        outcome,
        communication: { headline: "Still pending" },
        data: profile,
      } as FinanceToolResult<FinanceProfileVersion>),
    ).toThrow("Still pending");
  expect(
    requireCompletedFinanceResult({
      outcome: "completed",
      data: profile,
    } as FinanceToolResult<FinanceProfileVersion>),
  ).toBe(profile);
});
it("validates currency without coercing blank to known zero", () => {
  expect(financeAmount("")).toBeNull();
  expect(financeAmount("12.50")).toBe(12.5);
  expect(() => financeAmount("1.234")).toThrow();
  expect(() => financeAmount("-1")).toThrow();
});
it("preserves payroll revision and unrelated fields", () => {
  const initial = {
    employer: "Existing",
    role: "Engineer",
    employmentType: "full_time",
    grossAnnualIncome: 90000,
    expectedNetPay: 2500,
    payFrequency: "biweekly",
    nextPayday: null,
    payAccountId: null,
    effectiveDate: "2026-10-01",
    updatedAt: "2026-11-01T00:00:00.000Z",
    householdSize: 2,
  } as Parameters<typeof payrollInput>[0];
  expect(payrollInput(initial, { role: "Senior engineer" }, "America/New_York")).toMatchObject({
    employer: "Existing",
    role: "Senior engineer",
    householdSize: 2,
    expectedUpdatedAt: "2026-11-01T00:00:00.000Z",
    effectiveDate: "2026-10-01",
  });
});
it("keeps follow-all null distinct from an explicit empty selection and writes partial revisions", async () => {
  const preferences = { spendAccountIds: null, cashAccountIds: null, investmentAccountIds: null };
  h.resource = {
    capabilities: {},
    preferences: { state: "loaded", value: { workspace: "finances", revision: 8, preferences } },
    accounts: {
      state: "loaded",
      value: { accounts: [{ id: "account", institution: "Fixture bank", name: "Checking" }] },
    },
  };
  h.update.mockResolvedValue({
    workspace: "finances",
    revision: 9,
    preferences: { ...preferences, spendAccountIds: [] },
  });
  render(<FinanceConfigurationSettings />);
  const followAll = screen.getAllByLabelText("Follow all eligible accounts")[0];
  if (!followAll) throw new Error("Missing spending selection");
  await act(async () => fireEvent.click(followAll));
  expect(h.update).toHaveBeenCalledWith("finances", {
    expectedRevision: 8,
    preferences: { spendAccountIds: [] },
  });
  expect(screen.getByLabelText("Fixture bank · Checking")).not.toBeChecked();
});

vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button
      type="button"
      aria-label="Save changes"
      data-floating-save
      disabled={disabled}
      onClick={onPress}
    />
  ),
}));

vi.mock("../../components/forms/planning-picker", () => ({
  PlanningPicker: ({
    label,
    value,
    timeZone,
    onChange,
  }: {
    label: string;
    value: string;
    timeZone: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      data-native-date
      data-timezone={timeZone}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
