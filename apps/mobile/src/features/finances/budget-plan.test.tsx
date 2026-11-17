// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BudgetPace } from "./budget-pace";
import { BudgetPlanDestinations, FinanceBudgetPlanScreen } from "./budget-plan";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  replace: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  platform: "ios",
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    getFinanceBudget: vi.fn(),
    reviseFinanceBudget: vi.fn(),
    createFinanceBudget: vi.fn(),
    getFinanceCategories: vi.fn(),
    listFinanceAccounts: vi.fn(),
    listFinanceGoals: vi.fn(),
    listFinanceBudgetBuckets: vi.fn(),
    createFinanceBudgetBucket: vi.fn(),
    updateFinanceBudgetBucket: vi.fn(),
    getFinanceBudgetBaselineQualification: vi.fn(),
    prepareFinanceBudgetBaselineQualification: vi.fn(),
    confirmFinanceBudgetBaselineQualification: vi.fn(),
    getFinanceBudgetPace: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({
    children,
    testID,
    accessibilityLabel,
  }: PropsWithChildren<{ testID?: string; accessibilityLabel?: string }>) => (
    <div data-testid={testID} title={accessibilityLabel}>
      {children}
    </div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children, visible }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: {
      get OS() {
        return h.platform;
      },
    },
    useColorScheme: () => "light",
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
      disabled,
    }: {
      accessibilityLabel?: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean; checked?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected ?? accessibilityState?.checked}
        disabled={disabled}
        onClick={onPress}
      >
        {typeof children === "function" ? null : children}
      </button>
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        disabled={!editable}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ),
  };
});
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/glass-surface", () => ({
  GlassSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.owner },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-router", () => ({
  router: h,
  useLocalSearchParams: () => h.params,
  useFocusEffect: () => undefined,
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => {
      h.screen(options);
      return (
        <>
          {options.headerLeft?.() ?? null}
          {options.headerRight?.() ?? null}
        </>
      );
    },
  },
}));

const PLAN = "10000000-0000-4000-8000-000000000001";
const V2 = "20000000-0000-4000-8000-000000000002";
const V3 = "20000000-0000-4000-8000-000000000003";
const GROCERIES = "30000000-0000-4000-8000-000000000001";
const DINING = "30000000-0000-4000-8000-000000000002";
const CHECKING = "40000000-0000-4000-8000-000000000001";
const CARD = "40000000-0000-4000-8000-000000000002";
const GOAL = "50000000-0000-4000-8000-000000000001";
const ESSENTIALS = "60000000-0000-4000-8000-000000000001";
const FUN = "60000000-0000-4000-8000-000000000002";
const REVIEW = "70000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);
const CONFIRMED = expect.stringContaining("scope confirmed for");

const plan = {
  id: V2,
  planId: PLAN,
  version: 2,
  status: "active",
  effectiveFrom: "2026-11",
  rationale: "Covers the month.",
  assumptions: ["Income is steady."],
  resources: [{ key: "Paycheck", kind: "income", amount: 3000 }],
  allocations: [
    { key: "Groceries", kind: "spending", amount: 600, categoryId: GROCERIES },
    { key: "Reserve", kind: "buffer", amount: 2400 },
  ],
  expectedResources: 3000,
  allocatedTotal: 3000,
  balanceDelta: 0,
  profileVersionId: null,
  approvedAt: "2026-11-01T12:00:00Z",
  createdAt: "2026-11-01T12:00:00Z",
};
const completed = <T,>(data: T, outcome = "completed", headline = "") => ({
  outcome,
  data,
  communication: { headline },
});
const read = (data: unknown) => ({
  ...completed(data),
  approvalReadiness: { ready: false, code: "not_proposed", recovery: "none", message: "" },
});
const categories = [
  {
    id: GROCERIES,
    name: "Groceries",
    group: "Food",
    slug: "groceries",
    isSystem: true,
    color: null,
  },
  { id: DINING, name: "Dining", group: "Food", slug: "dining", isSystem: true, color: null },
];
const accounts = {
  accounts: [
    { id: CHECKING, name: "Checking", currencyCode: "USD" },
    { id: CARD, name: "Visa card", currencyCode: "USD" },
  ],
};
const goals = completed([{ id: GOAL, name: "Emergency reserve", status: "active" }]);
const bucket = (id: string, name: string, ids: string[], version = 4) => ({
  id,
  name,
  description: null,
  categories: ids,
  position: 0,
  version,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
});
const taxonomy = (buckets: unknown[]) => ({
  taxonomy: {
    id: "taxonomy-1",
    name: "Budget buckets",
    description: null,
    isActive: true,
    version: 1,
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    buckets,
    rollups: [
      {
        bucketId: ESSENTIALS,
        label: "Essentials",
        budgeted: 600,
        spent: 200,
        remaining: 400,
        categoryIds: [GROCERIES],
      },
      {
        bucketId: null,
        label: "Unmapped categories",
        budgeted: 100,
        spent: 20,
        remaining: 80,
        categoryIds: [DINING],
      },
    ],
  },
});
const period = { from: "2026-11-01", through: "2026-11-30", timezone: "America/New_York" };
const unavailable = {
  state: "unavailable",
  reason: "qualification_required",
  qualificationRequired: true,
  candidates: [
    {
      budgetVersionId: V2,
      planId: PLAN,
      budgetVersion: 2,
      approvedAt: "2026-11-01T12:00:00Z",
      originalActorType: "user",
      period,
    },
  ],
};
const snapshot = {
  accountIds: [CHECKING],
  allocations: [
    {
      key: "Groceries",
      categoryId: GROCERIES,
      legacyCategory: null,
      label: "Groceries",
      amountCents: 60_000,
    },
  ],
  budgetVersionId: V2,
  budgetVersion: 2,
  planId: PLAN,
  sourceBaselineId: null,
  currency: "USD",
  month: "2026-11",
  period,
  originalApproval: { approvedAt: "2026-11-01T12:00:00Z", actorId: "owner-a", actorType: "user" },
};
const review = { id: REVIEW, fingerprint: FINGERPRINT, snapshot };
const qualified = {
  state: "qualified",
  qualification: {
    ...snapshot,
    id: "80000000-0000-4000-8000-000000000001",
    revision: 1,
    confirmedAt: "2026-11-02T12:00:00Z",
    confirmedByActorId: "owner-a",
    qualificationKind: "current",
  },
};
const rejection = (status: number, message = "rejected") =>
  new ApiClientError({ code: "error", message, status });
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function open(params: Record<string, string>) {
  h.params = params;
  return mount(<FinanceBudgetPlanScreen />);
}
/** Presses a button of the most recent native confirmation. */
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** Opens a choice row and picks one of its options. */
function pick(row: RegExp, option: string | RegExp) {
  press(row);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: option }));
}
const saveButton = (name = "Save proposal") => screen.getByRole("button", { name });
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}

beforeEach(() => {
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = {};
  h.platform = "ios";
  h.api.getFinanceBudget.mockResolvedValue(read(plan));
  h.api.getFinanceCategories.mockResolvedValue(categories);
  h.api.listFinanceAccounts.mockResolvedValue(accounts);
  h.api.listFinanceGoals.mockResolvedValue(goals);
  h.api.listFinanceBudgetBuckets.mockResolvedValue(
    taxonomy([bucket(ESSENTIALS, "Essentials", [GROCERIES]), bucket(FUN, "Fun", [DINING], 2)]),
  );
  h.api.getFinanceBudgetBaselineQualification.mockResolvedValue(unavailable);
  h.api.getFinanceBudgetPace.mockResolvedValue({
    period: "week",
    asOf: "2026-11-17",
    cells: [
      { date: "2026-11-16", planned: 50, spent: 40, status: "ahead" },
      { date: "2026-11-17", planned: 100, spent: 130, status: "behind" },
      { date: "2026-11-18", planned: 0, spent: 0, status: "blank" },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
});

// Plan destinations

it("links the Budget tab to revising the plan, its buckets and the month's scope", async () => {
  mount(<BudgetPlanDestinations />);
  press(await screen.findByRole("button", { name: /Revise plan/ }).then(() => /Revise plan/));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-plan",
    params: { view: "edit" },
  });
  press(/Budget buckets/);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-plan",
    params: { view: "buckets", month: expect.stringMatching(/^\d{4}-\d{2}$/) },
  });
  press(/Confirm budget scope/);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-plan",
    params: { view: "scope", month: expect.stringMatching(/^\d{4}-\d{2}$/) },
  });
  expect(screen.queryByRole("button", { name: /Review proposal/ })).toBeNull();
});

it("opens a proposed version for review and approval", async () => {
  h.api.getFinanceBudget.mockResolvedValue(
    read({ ...plan, id: V3, version: 3, status: "proposed", approvedAt: null }),
  );
  mount(<BudgetPlanDestinations />);
  fireEvent.click(await screen.findByRole("button", { name: /Review proposal/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-chat-reference",
    params: { kind: "budget_plan", id: PLAN, versionId: V3 },
  });
});

it("offers to create a plan when none exists", async () => {
  h.api.getFinanceBudget.mockResolvedValue(read(null));
  mount(<BudgetPlanDestinations />);
  expect(await screen.findByRole("button", { name: /Create plan/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Revise plan/ })).toBeNull();
});

// Plan revision

async function editor() {
  open({ view: "edit" });
  await screen.findByLabelText("Allocation 1 amount");
}

it("closes an untouched plan without a prompt and keeps Save disabled", async () => {
  await editor();
  expect(screen.getByText(/Revising version 2 · the approved budget\./)).toBeTruthy();
  expect(field("Allocation 1 amount").value).toBe("600.00");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  press("Close");
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalled();
});

it("saves a revision as a proposal against the version on screen", async () => {
  h.api.reviseFinanceBudget.mockResolvedValue(
    completed({ ...plan, id: V3, version: 3, status: "proposed", approvedAt: null }),
  );
  await editor();
  type("Allocation 1 amount", "700");
  type("Allocation 2 amount", "2300");
  expect(screen.getByText("Every cent assigned")).toBeTruthy();
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.reviseFinanceBudget).toHaveBeenCalledTimes(1);
  expect(h.api.reviseFinanceBudget.mock.calls[0]?.[0]).toMatchObject({
    planId: PLAN,
    expectedVersion: 2,
    effectiveFrom: "2026-11",
    rationale: "Covers the month.",
    assumptions: ["Income is steady."],
    resources: [{ key: "Paycheck", kind: "income", amount: 3000 }],
    allocations: [
      { key: "Groceries", kind: "spending", amount: 700, categoryId: GROCERIES },
      { key: "Reserve", kind: "buffer", amount: 2300 },
    ],
    idempotencyKey: expect.any(String),
  });
  expect(h.success).toHaveBeenCalledWith(
    "Version 3 saved as a proposal. Approve it to make it active.",
    { id: "feedback" },
  );
  expect(h.replace).toHaveBeenCalledWith({
    pathname: "/finance-chat-reference",
    params: { kind: "budget_plan", id: PLAN, versionId: V3 },
  });
  expectNoInlineResult();
});

it("does not save a plan whose resources and allocations differ", async () => {
  await editor();
  type("Allocation 1 amount", "650");
  expect(screen.getByText("$50.00 over-assigned")).toBeTruthy();
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  type("Allocation 1 amount", "550");
  expect(screen.getByText("$50.00 left to assign")).toBeTruthy();
  type("Allocation 1 amount", "5.555");
  expect(screen.getByText("Enter amounts with up to two decimal places")).toBeTruthy();
  fireEvent.click(saveButton());
  expect(h.api.reviseFinanceBudget).not.toHaveBeenCalled();
});

it("keeps the draft after a stale revision and reloads the latest on request", async () => {
  h.api.reviseFinanceBudget.mockRejectedValueOnce(rejection(409, "A newer budget version exists."));
  await editor();
  type("Allocation 1 amount", "700");
  type("Allocation 2 amount", "2300");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"), {
    id: "feedback",
  });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
  expect(field("Allocation 1 amount").value).toBe("700");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  expectNoInlineResult();

  h.api.getFinanceBudget.mockResolvedValue(
    read({
      ...plan,
      id: V3,
      version: 3,
      allocations: [
        { key: "Groceries", kind: "spending", amount: 650, categoryId: GROCERIES },
        { key: "Reserve", kind: "buffer", amount: 2350 },
      ],
    }),
  );
  press("Reload latest version");
  expect(field("Allocation 1 amount").value).toBe("700");
  confirm("Reload");
  await waitFor(() => expect(field("Allocation 1 amount").value).toBe("650.00"));
  h.api.reviseFinanceBudget.mockResolvedValue(
    completed({
      ...plan,
      id: "20000000-0000-4000-8000-000000000004",
      version: 4,
      status: "proposed",
    }),
  );
  type("Allocation 1 amount", "600");
  type("Allocation 2 amount", "2400");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.replace).toHaveBeenCalled());
  expect(h.api.reviseFinanceBudget.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 3 });
});

it("resends the same request after an unknown outcome and a new one after an edit", async () => {
  h.api.reviseFinanceBudget.mockRejectedValue(new Error("Network request failed"));
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining("Couldn’t confirm"), {
    id: "feedback",
  });
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  const [first, second] = h.api.reviseFinanceBudget.mock.calls.map(
    ([input]) => input.idempotencyKey,
  );
  expect(second).toBe(first);
  type("Rationale", "Different reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(3));
  expect(h.api.reviseFinanceBudget.mock.calls[2]?.[0].idempotencyKey).not.toBe(first);
  expect(h.success).not.toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
});

it("retries under a new key once the server recorded the earlier save as failed", async () => {
  h.api.reviseFinanceBudget
    .mockRejectedValueOnce(new Error("timeout"))
    .mockRejectedValueOnce(
      rejection(
        409,
        "That Finance mutation previously failed; use a new idempotency key to retry.",
      ),
    )
    .mockResolvedValue(completed({ ...plan, id: V3, version: 3, status: "proposed" }));
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining("nothing was saved"), {
    id: "feedback",
  });
  expect(screen.queryByRole("button", { name: "Reload latest version" })).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const keys = h.api.reviseFinanceBudget.mock.calls.map(([input]) => input.idempotencyKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

it("reports a save the server answered without completing as not saved", async () => {
  h.api.reviseFinanceBudget.mockResolvedValue(
    completed(null, "failed", "Resources must cover allocations."),
  );
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith("Resources must cover allocations.", { id: "feedback" });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
  expect(field("Rationale").value).toBe("Updated reasoning.");
  expectNoInlineResult();
});

it("says when the version being revised is an unapproved proposal", async () => {
  h.api.getFinanceBudget.mockResolvedValue(
    read({ ...plan, id: V3, version: 3, status: "proposed", approvedAt: null }),
  );
  await editor();
  expect(screen.getByText(/Revising version 3 · a proposal that is not approved\./)).toBeTruthy();
});

it("asks before discarding an edited plan", async () => {
  await editor();
  type("Rationale", "Updated reasoning.");
  press("Cancel");
  expect(h.back).not.toHaveBeenCalled();
  confirm("Discard");
  expect(h.back).toHaveBeenCalled();
  expect(h.api.reviseFinanceBudget).not.toHaveBeenCalled();
});

it("adds a debt allocation only with its account and removes rows", async () => {
  h.api.reviseFinanceBudget.mockResolvedValue(
    completed({ ...plan, id: V3, version: 3, status: "proposed" }),
  );
  await editor();
  press("Add allocation");
  type("Allocation 3 name", "Card payment");
  type("Allocation 3 amount", "400");
  type("Allocation 2 amount", "2000");
  pick(/^Allocation 3 kind,/, "Debt payment");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  pick(/^Allocation 3 account,/, "Visa card");
  press("Add assumption");
  type("Assumption 2", "Card balance is paid down.");
  press("Remove assumption 1");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.reviseFinanceBudget.mock.calls[0]?.[0]).toMatchObject({
    assumptions: ["Card balance is paid down."],
    allocations: [
      { key: "Groceries", kind: "spending", amount: 600, categoryId: GROCERIES },
      { key: "Reserve", kind: "buffer", amount: 2000 },
      { key: "Card payment", kind: "debt", amount: 400, accountId: CARD },
    ],
  });
});

it("requires a real month and unique names", async () => {
  await editor();
  type("Effective month", "2026-13");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  type("Effective month", "2026-12");
  expect(saveButton().hasAttribute("disabled")).toBe(false);
  type("Allocation 2 name", "Groceries");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  expect(h.api.reviseFinanceBudget).not.toHaveBeenCalled();
});

it("creates the first plan as a proposal", async () => {
  h.api.getFinanceBudget.mockResolvedValue(read(null));
  h.api.createFinanceBudget.mockResolvedValue(
    completed({ ...plan, id: V2, version: 1, status: "proposed", approvedAt: null }),
  );
  open({ view: "edit" });
  await screen.findByLabelText("Resource 1 amount");
  type("Resource 1 amount", "3000");
  type("Allocation 1 amount", "3000");
  type("Rationale", "First plan.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.createFinanceBudget.mock.calls[0]?.[0]).toMatchObject({
    name: "Monthly plan",
    effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}$/),
    resources: [{ key: "Income", kind: "income", amount: 3000 }],
    allocations: [{ key: "Spending", kind: "spending", amount: 3000 }],
    rationale: "First plan.",
    idempotencyKey: expect.any(String),
  });
  expect(h.api.createFinanceBudget.mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
  expect(h.api.reviseFinanceBudget).not.toHaveBeenCalled();
});

// Buckets

it("lists this month's bucket totals and the buckets", async () => {
  open({ view: "buckets", month: "2026-11" });
  expect(await screen.findByText("$200.00 of $600.00")).toBeTruthy();
  expect(screen.getByText("Unmapped categories")).toBeTruthy();
  expect(h.api.listFinanceBudgetBuckets).toHaveBeenCalledWith("2026-11");
  press(/^Fun/);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-plan",
    params: { view: "bucket", id: FUN, month: "2026-11" },
  });
  press("Add bucket");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-plan",
    params: { view: "bucket", month: "2026-11" },
  });
});

it("says when there are no buckets yet", async () => {
  h.api.listFinanceBudgetBuckets.mockResolvedValue({ taxonomy: null });
  open({ view: "buckets", month: "2026-11" });
  expect(await screen.findByText(/No buckets yet/)).toBeTruthy();
});

it("adds a bucket once and reports it only when applied", async () => {
  h.api.createFinanceBudgetBucket
    .mockRejectedValueOnce(new Error("Network request failed"))
    .mockResolvedValue(taxonomy([]).taxonomy);
  open({ view: "bucket", month: "2026-11" });
  type(await screen.findByLabelText("Name").then(() => "Name"), "Travel");
  type("Description", "Trips and transit");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Bucket added", { id: "feedback" }));
  const [first, second] = h.api.createFinanceBudgetBucket.mock.calls.map(([input]) => input);
  expect(first).toEqual({
    name: "Travel",
    description: "Trips and transit",
    idempotencyKey: expect.any(String),
  });
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(h.back).toHaveBeenCalled();
  expectNoInlineResult();
});

async function bucketEditor() {
  open({ view: "bucket", id: ESSENTIALS, month: "2026-11" });
  await screen.findByLabelText("Dining");
}

it("saves only a bucket's changed fields against its version", async () => {
  h.api.updateFinanceBudgetBucket.mockResolvedValue(taxonomy([]).taxonomy);
  await bucketEditor();
  expect(field("Groceries").checked).toBe(true);
  expect(screen.getByText("In Fun. Turning this on moves it here.")).toBeTruthy();
  fireEvent.click(field("Dining"));
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Bucket saved", { id: "feedback" }));
  expect(h.api.updateFinanceBudgetBucket).toHaveBeenCalledWith(ESSENTIALS, {
    categoryIds: [GROCERIES, DINING],
    expectedVersion: 4,
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalled();
});

it("recovers from a bucket that changed elsewhere", async () => {
  h.api.updateFinanceBudgetBucket.mockRejectedValueOnce(
    rejection(409, "The budget bucket changed; refresh and try again."),
  );
  await bucketEditor();
  type("Name", "Needs");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"), {
    id: "feedback",
  });
  expect(field("Name").value).toBe("Needs");
  expect(saveButton("Save changes").hasAttribute("disabled")).toBe(true);
  expect(h.back).not.toHaveBeenCalled();
  h.api.listFinanceBudgetBuckets.mockResolvedValue(
    taxonomy([bucket(ESSENTIALS, "Must-haves", [GROCERIES], 5), bucket(FUN, "Fun", [DINING], 2)]),
  );
  press("Reload latest version");
  confirm("Reload");
  await waitFor(() => expect(field("Name").value).toBe("Must-haves"));
  h.api.updateFinanceBudgetBucket.mockResolvedValue(taxonomy([]).taxonomy);
  type("Name", "Needs");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Bucket saved", { id: "feedback" }));
  expect(h.api.updateFinanceBudgetBucket.mock.calls[1]?.[1]).toMatchObject({
    name: "Needs",
    expectedVersion: 5,
  });
});

it("treats a taken bucket name as a correction, not a stale bucket", async () => {
  h.api.updateFinanceBudgetBucket.mockRejectedValue(
    rejection(409, "A budget bucket with that name already exists."),
  );
  await bucketEditor();
  type("Name", "Fun");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("already exists"), {
    id: "feedback",
  });
  expect(screen.queryByRole("button", { name: "Reload latest version" })).toBeNull();
  expect(saveButton("Save changes").hasAttribute("disabled")).toBe(false);
});

it("does not call a bucket change saved while it waits for approval", async () => {
  h.api.updateFinanceBudgetBucket.mockResolvedValue({ status: "pending_review" });
  await bucketEditor();
  type("Description", "Fixed costs");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.info).toHaveBeenCalled());
  expect(h.info).toHaveBeenCalledWith("Submitted for approval. The bucket has not changed.", {
    id: "feedback",
  });
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("says a missing bucket is unavailable", async () => {
  open({ view: "bucket", id: "60000000-0000-4000-8000-000000000009", month: "2026-11" });
  expect(await screen.findByText("This bucket is unavailable.")).toBeTruthy();
});

// Baseline qualification

async function scope() {
  open({ view: "scope", month: "2026-11" });
  await screen.findByLabelText("Checking");
}
function chooseScope() {
  pick(/^Budget version,/, /Version 2/);
  fireEvent.click(field("Checking"));
  fireEvent.click(field("US dollars (USD)"));
}

it("previews then confirms the exact scope chosen", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  h.api.confirmFinanceBudgetBaselineQualification.mockResolvedValue(qualified);
  await scope();
  expect(screen.getByRole("button", { name: "Preview scope" }).hasAttribute("disabled")).toBe(true);
  chooseScope();
  press("Preview scope");
  await screen.findByRole("button", { name: "Confirm this scope" });
  expect(h.api.prepareFinanceBudgetBaselineQualification).toHaveBeenCalledWith({
    accountIds: [CHECKING],
    budgetVersionId: V2,
    currency: "USD",
    idempotencyKey: expect.any(String),
    month: "2026-11",
    timezone: "America/New_York",
  });
  expect(screen.getByText("$600.00")).toBeTruthy();
  h.api.getFinanceBudgetBaselineQualification.mockResolvedValue(qualified);
  press("Confirm this scope");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith(CONFIRMED, { id: "feedback" }));
  expect(h.api.confirmFinanceBudgetBaselineQualification).toHaveBeenCalledWith({
    reviewId: REVIEW,
    expectedFingerprint: FINGERPRINT,
    idempotencyKey: expect.any(String),
  });
  expect(await screen.findByText(/Scope confirmed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Preview scope" })).toBeNull();
  expectNoInlineResult();
});

it("drops the preview when the selection changes", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  await scope();
  chooseScope();
  press("Preview scope");
  await screen.findByRole("button", { name: "Confirm this scope" });
  fireEvent.click(field("Visa card"));
  expect(screen.queryByRole("button", { name: "Confirm this scope" })).toBeNull();
  expect(h.api.confirmFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
});

it("rejects a preview that does not match the selection", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue({
    ...review,
    snapshot: { ...snapshot, accountIds: [CARD] },
  });
  await scope();
  chooseScope();
  press("Preview scope");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Confirm this scope" })).toBeNull();
});

it("asks for a new preview when the scope changed before confirming", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  h.api.confirmFinanceBudgetBaselineQualification.mockRejectedValue(
    rejection(409, "Confirm the exact displayed baseline review."),
  );
  await scope();
  chooseScope();
  press("Preview scope");
  press(
    await screen
      .findByRole("button", { name: "Confirm this scope" })
      .then(() => "Confirm this scope"),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Preview it again"), {
    id: "feedback",
  });
  expect(h.success).not.toHaveBeenCalledWith(CONFIRMED, expect.anything());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Confirm this scope" })).toBeNull(),
  );
  expectNoInlineResult();
});

it("confirms again under the same key after an unknown outcome", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  h.api.confirmFinanceBudgetBaselineQualification
    .mockRejectedValueOnce(new Error("Network request failed"))
    .mockResolvedValue(qualified);
  await scope();
  chooseScope();
  press("Preview scope");
  press(
    await screen
      .findByRole("button", { name: "Confirm this scope" })
      .then(() => "Confirm this scope"),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm"), {
    id: "feedback",
  });
  press("Confirm this scope");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith(CONFIRMED, { id: "feedback" }));
  const keys = h.api.confirmFinanceBudgetBaselineQualification.mock.calls.map(
    ([input]) => input.idempotencyKey,
  );
  expect(keys[1]).toBe(keys[0]);
});

it("does not call the scope confirmed when the server did not qualify it", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  h.api.confirmFinanceBudgetBaselineQualification.mockResolvedValue(unavailable);
  await scope();
  chooseScope();
  press("Preview scope");
  press(
    await screen
      .findByRole("button", { name: "Confirm this scope" })
      .then(() => "Confirm this scope"),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalledWith(CONFIRMED, expect.anything());
});

it("shows a month that is already confirmed without the form", async () => {
  h.api.getFinanceBudgetBaselineQualification.mockResolvedValue(qualified);
  open({ view: "scope", month: "2026-11" });
  expect(await screen.findByText(/Scope confirmed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Preview scope" })).toBeNull();
});

it("says when no approved version can be confirmed for the month", async () => {
  h.api.getFinanceBudgetBaselineQualification.mockResolvedValue({ ...unavailable, candidates: [] });
  open({ view: "scope", month: "2026-11" });
  expect(await screen.findByText(/No approved budget version/)).toBeTruthy();
});

it("needs the account timezone to confirm a scope", async () => {
  h.timezone = undefined;
  open({ view: "scope", month: "2026-11" });
  expect(await screen.findByText(/Set your account timezone/)).toBeTruthy();
  expect(h.api.prepareFinanceBudgetBaselineQualification).not.toHaveBeenCalled();
});

// Budget pace

it("draws one cell per day and summarises the latest day", async () => {
  mount(<BudgetPace />);
  expect(
    await screen.findByTitle(/Over pace\. \$130\.00 spent against \$100\.00 paced/),
  ).toBeTruthy();
  expect(screen.getByTitle(/Ahead of pace\. \$40\.00 spent against \$50\.00 paced/)).toBeTruthy();
  expect(screen.getByTitle(/No activity/)).toBeTruthy();
  expect(screen.getByText("Over pace")).toBeTruthy();
  expect(screen.getByText("$130.00 spent against $100.00 paced")).toBeTruthy();
  expect(h.api.getFinanceBudgetPace).toHaveBeenCalledWith("week");
});

it("reads the month and the year on request", async () => {
  mount(<BudgetPace />);
  await screen.findByText("Over pace");
  h.api.getFinanceBudgetPace.mockResolvedValue({
    period: "month",
    asOf: "2026-11-17",
    cells: [{ date: "2026-11-01", planned: 20, spent: 20, status: "neutral" }],
  });
  press("Month");
  expect(await screen.findByTitle(/On pace\. \$20\.00 spent against \$20\.00 paced/)).toBeTruthy();
  expect(h.api.getFinanceBudgetPace).toHaveBeenCalledWith("month");
  press("Year");
  await waitFor(() => expect(h.api.getFinanceBudgetPace).toHaveBeenCalledWith("year"));
});

it("explains an empty pace graph when no limits are set", async () => {
  h.api.getFinanceBudgetPace.mockResolvedValue({
    period: "week",
    asOf: "2026-11-17",
    cells: [{ date: "2026-11-17", planned: 0, spent: 12, status: "blank" }],
  });
  mount(<BudgetPace />);
  expect(await screen.findByText(/Set monthly category limits/)).toBeTruthy();
});

it("opens nothing for an unknown view", () => {
  open({ view: "other" });
  expect(screen.getByText("This page is unavailable.")).toBeTruthy();
});

// Remaining edit and failure paths

it("edits resources, links and kinds and sends only each kind's own link", async () => {
  h.api.reviseFinanceBudget.mockResolvedValue(completed({ ...plan, id: V3, version: 3 }));
  await editor();
  type("Resource 1 name", "Salary");
  type("Resource 1 description", "After tax");
  pick(/^Resource 1 kind,/, "Other resource");
  pick(/^Resource 1 source,/, "Checking");
  press("Add resource");
  type("Resource 2 name", "Bonus");
  type("Resource 2 amount", "500");
  press("Add resource");
  press("Remove resource 3");
  pick(/^Allocation 1 category,/, "Dining");
  type("Allocation 1 category label", "Food out");
  type("Allocation 1 description", "Meals");
  pick(/^Allocation 2 kind,/, "Goal contribution");
  expect(saveButton().hasAttribute("disabled")).toBe(true);
  pick(/^Allocation 2 goal,/, "Emergency reserve");
  press("Add allocation");
  type("Allocation 3 name", "Rainy day");
  type("Allocation 3 amount", "500");
  pick(/^Allocation 3 kind,/, "Savings");
  press("Add allocation");
  press("Remove allocation 4");
  fireEvent.click(saveButton());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Version 3 saved.", { id: "feedback" }),
  );
  expect(h.back).toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
  const sent = h.api.reviseFinanceBudget.mock.calls[0]?.[0];
  expect(sent.resources).toEqual([
    { key: "Salary", kind: "other", amount: 3000, description: "After tax", sourceId: CHECKING },
    { key: "Bonus", kind: "income", amount: 500 },
  ]);
  expect(sent.allocations).toEqual([
    {
      key: "Groceries",
      kind: "spending",
      amount: 600,
      description: "Meals",
      categoryId: DINING,
      legacyCategory: "Food out",
    },
    { key: "Reserve", kind: "goal", amount: 2400, goalId: GOAL },
    { key: "Rainy day", kind: "savings", amount: 500 },
  ]);
});

it("keeps a saved link whose record is no longer listed", async () => {
  h.api.getFinanceBudget.mockResolvedValue(
    read({
      ...plan,
      resources: [{ key: "Paycheck", kind: "income", amount: 3000, sourceId: REVIEW }],
    }),
  );
  h.api.reviseFinanceBudget.mockResolvedValue(
    completed({ ...plan, id: V3, version: 3, status: "proposed" }),
  );
  await editor();
  expect(screen.getByRole("button", { name: "Resource 1 source, Saved record" })).toBeTruthy();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.replace).toHaveBeenCalled());
  expect(h.api.reviseFinanceBudget.mock.calls[0]?.[0].resources[0].sourceId).toBe(REVIEW);
});

it.each([
  [rejection(400), "Couldn’t save this proposal"],
  [rejection(409, "That Finance mutation is already in progress."), "still in progress"],
])("keeps the plan draft after a save the server refused", async (error, message) => {
  h.api.reviseFinanceBudget.mockRejectedValue(error);
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining(message), { id: "feedback" });
  expect(field("Rationale").value).toBe("Updated reasoning.");
  expect(screen.queryByRole("button", { name: "Reload latest version" })).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
});

it("reports a plan answer that needs more input without calling it saved", async () => {
  h.api.reviseFinanceBudget.mockResolvedValue(completed(null, "user_input_required", ""));
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("The plan was not saved.", { id: "feedback" }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
});

it("keeps the draft when the latest plan cannot be loaded", async () => {
  h.api.reviseFinanceBudget.mockRejectedValueOnce(rejection(409, "A newer budget version exists."));
  await editor();
  type("Rationale", "Updated reasoning.");
  fireEvent.click(saveButton());
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  h.api.getFinanceBudget.mockRejectedValue(new Error("offline"));
  press("Reload latest version");
  confirm("Reload");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t load the latest plan"), {
      id: "feedback",
    }),
  );
  expect(field("Rationale").value).toBe("Updated reasoning.");
});

it("flags blank reasoning before saving", async () => {
  await editor();
  type("Rationale", " ");
  expect(screen.getByText("Add a rationale for this plan.")).toBeTruthy();
  type("Rationale", "Back.");
  press("Add assumption");
  expect(screen.getByText("Fill in or remove empty assumptions.")).toBeTruthy();
  expect(saveButton().hasAttribute("disabled")).toBe(true);
});

it("asks before discarding an edited bucket and closes an untouched one", async () => {
  await bucketEditor();
  press("Close");
  expect(h.back).toHaveBeenCalledTimes(1);
  fireEvent.click(field("Groceries"));
  press("Cancel");
  expect(h.back).toHaveBeenCalledTimes(1);
  confirm("Discard");
  expect(h.back).toHaveBeenCalledTimes(2);
});

it("sends nothing when a bucket edit ends where it began", async () => {
  await bucketEditor();
  fireEvent.click(field("Groceries"));
  fireEvent.click(field("Groceries"));
  fireEvent.click(saveButton("Save changes"));
  expect(h.info).toHaveBeenCalledWith("No changes to save");
  expect(h.api.updateFinanceBudgetBucket).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalled();
});

it("says when a bucket change needs more information", async () => {
  h.api.updateFinanceBudgetBucket.mockResolvedValue({ status: "needs_input" });
  await bucketEditor();
  fireEvent.click(field("Groceries"));
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.info).toHaveBeenCalled());
  expect(h.info).toHaveBeenCalledWith("More information is needed. The bucket has not changed.", {
    id: "feedback",
  });
  expect(h.api.updateFinanceBudgetBucket.mock.calls[0]?.[1]).toMatchObject({ categoryIds: [] });
  expect(h.success).not.toHaveBeenCalled();
});

it.each([
  [rejection(400), "Couldn’t save this bucket"],
  [rejection(409, "That Finance mutation is already in progress."), "still in progress"],
  [
    rejection(409, "That Finance mutation previously failed; use a new idempotency key to retry."),
    "nothing was saved",
  ],
])("keeps the bucket draft after a save the server refused", async (error, message) => {
  h.api.updateFinanceBudgetBucket.mockRejectedValue(error);
  await bucketEditor();
  type("Name", "Needs");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining(message), { id: "feedback" });
  expect(field("Name").value).toBe("Needs");
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Reload latest version" })).toBeNull();
});

it("keeps the bucket draft when the latest bucket cannot be loaded", async () => {
  h.api.updateFinanceBudgetBucket.mockRejectedValueOnce(
    rejection(409, "The budget bucket changed; refresh and try again."),
  );
  await bucketEditor();
  type("Name", "Needs");
  fireEvent.click(saveButton("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  h.api.listFinanceBudgetBuckets.mockRejectedValue(new Error("offline"));
  press("Reload latest version");
  confirm("Reload");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t load the latest bucket"),
      {
        id: "feedback",
      },
    ),
  );
  expect(field("Name").value).toBe("Needs");
});

it.each([
  [
    rejection(409, "Choose a complete previously approved budget for this month."),
    "Check your selection",
  ],
  [rejection(400), "Couldn’t prepare the preview"],
  [new Error("Network request failed"), "won’t be prepared twice"],
])("shows no preview when preparing it fails", async (error, message) => {
  h.api.prepareFinanceBudgetBaselineQualification.mockRejectedValue(error);
  await scope();
  chooseScope();
  fireEvent.click(field("Visa card"));
  fireEvent.click(field("Visa card"));
  press("Preview scope");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining(message), { id: "feedback" });
  expect(screen.queryByRole("button", { name: "Confirm this scope" })).toBeNull();
  expectNoInlineResult();
});

it("reports a scope the server refused to confirm as not recorded", async () => {
  h.api.prepareFinanceBudgetBaselineQualification.mockResolvedValue(review);
  h.api.confirmFinanceBudgetBaselineQualification.mockRejectedValue(rejection(403));
  await scope();
  chooseScope();
  press("Preview scope");
  press(
    await screen
      .findByRole("button", { name: "Confirm this scope" })
      .then(() => "Confirm this scope"),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Nothing was recorded"), {
    id: "feedback",
  });
  expect(h.success).not.toHaveBeenCalledWith(CONFIRMED, expect.anything());
});

it("marks a month whose scope was confirmed after the fact", async () => {
  h.api.getFinanceBudgetBaselineQualification.mockResolvedValue({
    state: "qualified",
    qualification: {
      ...qualified.qualification,
      qualificationKind: "retrospective",
      accountIds: [CARD, REVIEW],
      originalApproval: { approvedAt: null, actorId: null, actorType: null },
    },
  });
  open({ view: "scope", month: "2026-11" });
  expect(await screen.findByText(/Scope confirmed later/)).toBeTruthy();
  expect(await screen.findByText("Visa card")).toBeTruthy();
  expect(screen.getByText("Unavailable account")).toBeTruthy();
  expect(screen.getByText("Actor unknown")).toBeTruthy();
});

it("lays out the year from its first weekday", async () => {
  h.api.getFinanceBudgetPace.mockResolvedValue({
    period: "year",
    asOf: "2026-01-02",
    cells: [
      { date: "2026-01-01", planned: 10, spent: 5, status: "ahead" },
      { date: "2026-01-02", planned: 20, spent: 20, status: "neutral" },
      ...Array.from({ length: 9 }, (_, index) => ({
        date: `2026-01-${String(index + 3).padStart(2, "0")}`,
        planned: 20,
        spent: 0,
        status: "blank",
      })),
    ],
  });
  mount(<BudgetPace />);
  press("Year");
  expect(await screen.findByTitle(/January 1, 2026: Ahead of pace/)).toBeTruthy();
  // 1 January 2026 is a Thursday: four leading days, then eleven cells, in weeks of seven.
  const weeks = screen.getAllByTestId("pace-week");
  expect(weeks.map((week) => week.children.length)).toEqual([7, 7, 1]);
  expect(screen.getByText("On pace")).toBeTruthy();
});
