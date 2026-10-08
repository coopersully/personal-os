// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceBudgetVersion, FinanceToolResult } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancePlanPage } from "./plan-page.js";

const api = vi.hoisted(() => ({
  getFinanceBudget: vi.fn(),
  getCanonicalFinanceBudgetStatus: vi.fn(),
  listFinanceAccounts: vi.fn(),
  listFinanceGoals: vi.fn(),
  getFinanceCategories: vi.fn(),
  listFinanceBudgetBuckets: vi.fn(),
  createFinanceBudget: vi.fn(),
  reviseFinanceBudget: vi.fn(),
  approveFinanceBudget: vi.fn(),
  createFinanceBudgetBucket: vi.fn(),
  updateFinanceBudgetBucket: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const id = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const goalId = "55555555-5555-4555-8555-555555555555";
const now = "2026-09-03T12:00:00.000Z";
const plan: FinanceBudgetVersion = {
  id,
  planId,
  version: 3,
  status: "proposed",
  effectiveFrom: "2026-09",
  createdAt: now,
  approvedAt: null,
  expectedResources: 6000,
  allocatedTotal: 6000,
  balanceDelta: 0,
  rationale: "Build a cushion while paying down the card.",
  assumptions: ["Salary arrives twice each month.", "The reserve draw is temporary."],
  resources: [
    { key: "Salary", kind: "income", amount: 5000, sourceId: accountId, description: "Net pay" },
    { key: "Cash reserve", kind: "reserve_draw", amount: 700, sourceId: accountId },
    { key: "Short-term borrowing", kind: "borrowing", amount: 200 },
    { key: "Other funds", kind: "other", amount: 100 },
  ],
  allocations: [
    {
      key: "Household",
      kind: "spending",
      amount: 3000,
      categoryId,
      legacyCategory: "Essentials",
      description: "Food and housing",
    },
    { key: "Emergency savings", kind: "savings", amount: 1000, goalId },
    { key: "Card payoff", kind: "debt", amount: 1000, accountId },
    { key: "Summer trip", kind: "goal", amount: 500, goalId },
    { key: "Monthly cushion", kind: "buffer", amount: 500 },
  ],
};
function result<T>(data: T): FinanceToolResult<T> {
  return {
    data,
    changes: [],
    communication: { headline: "Budget ready.", optionalDetails: [], requiredDisclosures: [] },
    outcome: "completed",
    remainingWork: { count: 0, categories: [] },
    schemaVersion: 1,
  };
}
function mount(route = "/finances/plan") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <FinancePlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceBudget.mockResolvedValue(result(plan));
  api.getCanonicalFinanceBudgetStatus.mockResolvedValue(result(null));
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [{ id: accountId, name: "Everyday account" }],
  });
  api.getFinanceCategories.mockResolvedValue([{ id: categoryId, name: "Household category" }]);
  api.listFinanceGoals.mockResolvedValue(result([{ id: goalId, name: "Travel fund" }]));
  api.listFinanceBudgetBuckets.mockResolvedValue({
    taxonomy: { buckets: [{ id: "bucket", name: "Needs", categories: [categoryId] }] },
  });
  api.reviseFinanceBudget.mockResolvedValue(result({ ...plan, version: 4 }));
  api.createFinanceBudget.mockResolvedValue(result(plan));
  api.approveFinanceBudget.mockResolvedValue(
    result({ ...plan, status: "active", approvedAt: now }),
  );
});

describe("complete finance plan", () => {
  it.each([
    "prior failed key",
    "failed envelope",
  ])("renews the approval key after a confirmed %s", async (failure) => {
    if (failure === "prior failed key")
      api.approveFinanceBudget.mockRejectedValueOnce(
        Object.assign(
          new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
          { status: 409 },
        ),
      );
    else api.approveFinanceBudget.mockResolvedValueOnce({ ...result(plan), outcome: "failed" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Approve version 3" }));
    await screen.findByText("Approval did not complete");
    expect(screen.getByRole("button", { name: "Approve version 3" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve version 3" }));
    await waitFor(() => expect(api.approveFinanceBudget).toHaveBeenCalledTimes(2));
    const first = api.approveFinanceBudget.mock.calls[0]?.[0];
    const second = api.approveFinanceBudget.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it.each([
    "prior failed key",
    "failed envelope",
  ])("preserves the plan draft and renews its key after a confirmed %s", async (failure) => {
    if (failure === "prior failed key")
      api.reviseFinanceBudget.mockRejectedValueOnce(
        Object.assign(
          new Error("That Finance mutation previously failed; use a new idempotency key to retry."),
          { status: 409 },
        ),
      );
    else api.reviseFinanceBudget.mockResolvedValueOnce({ ...result(plan), outcome: "failed" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    fireEvent.change(screen.getByLabelText("Rationale"), {
      target: { value: "Keep this revised rationale." },
    });
    fireEvent.click(screen.getByText("Save proposal", { selector: "button" }));
    await screen.findByText("Proposal could not be saved");
    expect(screen.getByLabelText("Rationale")).toHaveValue("Keep this revised rationale.");
    expect(screen.getByText("Save proposal", { selector: "button" })).toBeEnabled();
    fireEvent.click(screen.getByText("Save proposal", { selector: "button" }));
    await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalledTimes(2));
    const first = api.reviseFinanceBudget.mock.calls[0]?.[0];
    const second = api.reviseFinanceBudget.mock.calls[1]?.[0];
    expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  }, 15_000);

  it("renders all agent-created resources, allocations, relations and assumptions, and approves the displayed exact version", async () => {
    const client = mount();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await screen.findByRole("button", { name: "Approve version 3" });
    for (const row of [...plan.resources, ...plan.allocations])
      expect(screen.getByText(row.key)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /assumptions · Show details/ }));
    await userEvent.click(screen.getByRole("button", { name: "Why this budget?" }));
    for (const assumption of plan.assumptions)
      expect(screen.getByText(assumption)).toBeInTheDocument();
    expect(screen.getByText(plan.rationale)).toBeInTheDocument();
    expect(screen.getByText("Bucket · Needs")).toBeInTheDocument();
    expect(screen.getByText("Category label · Essentials")).toBeInTheDocument();
    expect(screen.getByText("Household category")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve version 3" }));
    await waitFor(() =>
      expect(api.approveFinanceBudget).toHaveBeenCalledWith({
        budgetVersionId: id,
        expectedVersion: 3,
        approvalSource: "user_instruction",
        expectedProfileVersionId: null,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Version 3 approved.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("keeps a failed approval visible and retries the same exact operation with its idempotency key", async () => {
    api.approveFinanceBudget.mockRejectedValueOnce(new Error("Connection interrupted"));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Approve version 3" }));
    expect(await screen.findByText("Approval did not complete")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve version 3" }));
    await waitFor(() => expect(api.approveFinanceBudget).toHaveBeenCalledTimes(2));
    expect(api.approveFinanceBudget.mock.calls[1]?.[0]).toEqual(
      api.approveFinanceBudget.mock.calls[0]?.[0],
    );
  });

  it("blocks duplicate approval while pending and reloads after a conflict", async () => {
    let reject: (error: Error) => void = () => {};
    api.approveFinanceBudget.mockImplementationOnce(
      () =>
        new Promise((_resolve, onReject) => {
          reject = onReject;
        }),
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Approve version 3" }));
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    await act(async () => reject(Object.assign(new Error("Version changed"), { status: 409 })));
    expect(await screen.findByText("The plan changed before approval")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve version 3" })).toBeDisabled();
    api.getFinanceBudget.mockResolvedValue(result({ ...plan, version: 4 }));
    await userEvent.click(screen.getByRole("button", { name: "Reload latest plan" }));
    expect(await screen.findByRole("button", { name: "Approve version 4" })).toBeEnabled();
  });

  it("revises all kinds without dropping linked identities or multiline assumptions", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Rationale"), {
      target: { value: "Keep the same allocation this month." },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save proposal" }));
    await waitFor(() =>
      expect(api.reviseFinanceBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          allocations: plan.allocations,
          resources: plan.resources,
          assumptions: plan.assumptions,
          effectiveFrom: plan.effectiveFrom,
          rationale: "Keep the same allocation this month.",
          expectedVersion: 3,
          planId,
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(api.createFinanceBudget).not.toHaveBeenCalled();
  });

  it("rejects unbalanced amounts and sub-cent input without making a mutation", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    fireEvent.change(screen.getByLabelText("Allocation 1 amount"), {
      target: { value: "3000.01" },
    });
    expect(screen.getByText("$0.01 over-assigned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save proposal" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Allocation 1 amount"), {
      target: { value: "3000.001" },
    });
    expect(screen.getByLabelText("Allocation 1 amount")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.blur(screen.getByLabelText("Allocation 1 amount"));
    expect(screen.getByLabelText("Allocation 1 amount")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save proposal" })).toBeDisabled();
    expect(api.reviseFinanceBudget).not.toHaveBeenCalled();
  });

  it("preserves failed revision edits and its retry key; changing the payload starts a new operation", async () => {
    api.reviseFinanceBudget.mockRejectedValue(new Error("Service unavailable"));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    fireEvent.change(screen.getByLabelText("Rationale"), {
      target: { value: "A revised rationale" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    expect(await screen.findByText("Proposal could not be saved")).toBeInTheDocument();
    expect(screen.getByLabelText("Rationale")).toHaveValue("A revised rationale");
    await userEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalledTimes(2));
    expect(api.reviseFinanceBudget.mock.calls[0]?.[0]).toEqual(
      api.reviseFinanceBudget.mock.calls[1]?.[0],
    );
    fireEvent.change(screen.getByLabelText("Rationale"), {
      target: { value: "Another rationale" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalledTimes(3));
    expect(api.reviseFinanceBudget.mock.calls[2]?.[0].idempotencyKey).not.toBe(
      api.reviseFinanceBudget.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it("routes a missing budget to its prerequisite section without creating a proposal", async () => {
    api.getFinanceBudget.mockResolvedValue(result(null));
    mount();
    expect(await screen.findByRole("link", { name: "Set up your budget" })).toHaveAttribute(
      "href",
      "/finances/setup?section=budget&returnTo=%2Ffinances%2Fplan",
    );
    expect(api.createFinanceBudget).not.toHaveBeenCalled();
  });

  it("shows a distinct active plan only from the status response, with no synthesized actual spending", async () => {
    const active = {
      ...plan,
      id: "66666666-6666-4666-8666-666666666666",
      version: 2,
      status: "active" as const,
      rationale: "Previously approved allocation.",
    };
    api.getCanonicalFinanceBudgetStatus.mockResolvedValue(result(active));
    mount();
    const button = await screen.findByRole("button", { name: "View active version 2 · 2026-09" });
    expect(screen.queryByText(active.rationale)).not.toBeInTheDocument();
    await userEvent.click(button);
    await userEvent.click(screen.getAllByRole("button", { name: "Why this budget?" }).at(-1)!);
    expect(screen.getByText(active.rationale)).toBeInTheDocument();
    expect(screen.queryByText(/Spent.*\$0/)).not.toBeInTheDocument();
  });

  it("keeps a proposal inspectable when related records and active status fail", async () => {
    api.listFinanceAccounts.mockRejectedValue(new Error("Accounts unavailable"));
    api.getCanonicalFinanceBudgetStatus.mockRejectedValue(new Error("Status unavailable"));
    mount();
    expect(await screen.findByText("Some linked records are unavailable")).toBeInTheDocument();
    expect(screen.getByText("Active plan status unavailable")).toBeInTheDocument();
    expect(screen.getByText("Account unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve version 3" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Revise plan" }));
    expect(screen.getByLabelText("Allocation 3 account")).toHaveValue(accountId);
  });

  it("does not interpret a failed tool result as a saved or empty plan", async () => {
    api.getFinanceBudget.mockResolvedValue({
      ...result(null),
      outcome: "failed",
      communication: {
        headline: "Plan retrieval failed",
        requiredDisclosures: [],
        optionalDetails: [],
      },
    });
    mount();
    expect(await screen.findByText("Plan unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create plan" })).not.toBeInTheDocument();
  });

  it("allows explicit changes to allocation kind and relations without carrying the old relation into the new kind", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    await userEvent.selectOptions(screen.getByLabelText("Allocation 3 kind"), "goal");
    expect(screen.queryByLabelText("Allocation 3 account")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Allocation 3 goal"), goalId);
    await userEvent.selectOptions(screen.getByLabelText("Resource 1 kind"), "other");
    await userEvent.selectOptions(screen.getByLabelText("Resource 1 source"), "");
    await userEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalled());
    const input = api.reviseFinanceBudget.mock.calls[0]?.[0];
    expect(input.allocations[2]).toEqual({
      amount: 1000,
      key: "Card payoff",
      kind: "goal",
      goalId,
    });
    expect(input.resources[0]).toEqual({
      amount: 5000,
      key: "Salary",
      kind: "other",
      description: "Net pay",
    });
  }, 15_000);

  it("adds and removes rows and saves explicit assumptions", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    fireEvent.click(screen.getByText("Add resource", { selector: "button" }));
    fireEvent.change(screen.getByLabelText("Resource 5 name"), { target: { value: "Refund" } });
    fireEvent.change(screen.getByLabelText("Resource 5 amount"), { target: { value: "10.25" } });
    fireEvent.click(screen.getByText("Add allocation", { selector: "button" }));
    fireEvent.change(screen.getByLabelText("Allocation 6 name"), {
      target: { value: "Extra buffer" },
    });
    fireEvent.change(screen.getByLabelText("Allocation 6 amount"), { target: { value: "10.25" } });
    fireEvent.change(screen.getByLabelText("Allocation 6 kind"), { target: { value: "buffer" } });
    fireEvent.click(screen.getByText("Add assumption", { selector: "button" }));
    fireEvent.change(screen.getByLabelText("Assumption 3"), {
      target: { value: "Refund has been confirmed." },
    });
    fireEvent.click(screen.getByText("Remove assumption 2", { selector: "button" }));
    fireEvent.click(screen.getByText("Save proposal", { selector: "button" }));
    await waitFor(() =>
      expect(api.reviseFinanceBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          assumptions: [plan.assumptions[0], "Refund has been confirmed."],
          resources: [...plan.resources, { amount: 10.25, key: "Refund", kind: "income" }],
          allocations: [
            ...plan.allocations,
            { amount: 10.25, key: "Extra buffer", kind: "buffer" },
          ],
        }),
      ),
    );
  }, 20_000);

  it("keeps revision conflicts in the editor until the person reloads the latest version", async () => {
    api.reviseFinanceBudget.mockRejectedValue(
      Object.assign(new Error("The budget is at version 4"), { code: "conflict" }),
    );
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Save proposal" }));
    expect(await screen.findByText("A newer version needs review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save proposal" })).toBeDisabled();
    expect(screen.getByLabelText("Rationale")).toHaveValue(plan.rationale);
    api.getFinanceBudget.mockResolvedValue(result({ ...plan, version: 4 }));
    await userEvent.click(screen.getByRole("button", { name: "Close editor and reload latest" }));
    expect(await screen.findByRole("button", { name: "Approve version 4" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the extracted budget bucket manager without replacing the complete plan", async () => {
    mount();
    await screen.findByRole("button", { name: "Approve version 3" });
    await userEvent.click(screen.getByRole("button", { name: "Budget buckets" }));
    expect(screen.getByRole("dialog", { name: "Organize budget categories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs" })).toBeInTheDocument();
  });
});

it("opens the specific plan requested by workspace search", async () => {
  mount(`/finances/plan?planId=${planId}`);
  await waitFor(() => expect(api.getFinanceBudget).toHaveBeenCalledWith(planId));
  await userEvent.click(await screen.findByRole("button", { name: "Why this budget?" }));
  expect(
    await screen.findByText("Build a cushion while paying down the card."),
  ).toBeInTheDocument();
});

it("edits linked proposal records and removes optional rows without losing descriptions", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
  const editor = within(screen.getByRole("dialog", { name: "Revise version 3" }));
  // Avoid scanning every control's accessible name for each action in this large form.
  const clickEditorButton = (name: string) => {
    const button = editor.getByText(name, { exact: true });
    expect(button).toHaveRole("button");
    expect(button).toHaveAccessibleName(name);
    expect(button).toBeVisible();
    expect(button).toBeEnabled();
    fireEvent.click(button);
  };
  fireEvent.change(screen.getByLabelText("Effective month"), { target: { value: "2026-10" } });
  fireEvent.change(screen.getByLabelText("Resource 1 description"), {
    target: { value: "Updated pay" },
  });
  fireEvent.blur(screen.getByLabelText("Resource 1 amount"));
  fireEvent.change(screen.getByLabelText("Allocation 1 category"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Allocation 1 category label"), {
    target: { value: "Household basics" },
  });
  fireEvent.change(screen.getByLabelText("Allocation 1 description"), {
    target: { value: "Revised food and housing" },
  });
  fireEvent.change(screen.getByLabelText("Allocation 3 account"), { target: { value: accountId } });
  clickEditorButton("Remove resource 4");
  clickEditorButton("Remove allocation 5");
  fireEvent.change(screen.getByLabelText("Allocation 1 amount"), { target: { value: "3400" } });
  clickEditorButton("Save proposal");
  await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalled());
  expect(api.reviseFinanceBudget).toHaveBeenLastCalledWith(
    expect.objectContaining({
      effectiveFrom: "2026-10",
      resources: expect.arrayContaining([expect.objectContaining({ description: "Updated pay" })]),
      allocations: expect.arrayContaining([
        expect.objectContaining({
          key: "Household",
          legacyCategory: "Household basics",
          description: "Revised food and housing",
          amount: 3400,
        }),
      ]),
    }),
  );
});
it("closes an unsaved proposal with Escape", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Revise plan" }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.reviseFinanceBudget).not.toHaveBeenCalled();
});

it.each([
  "draft",
  "retired",
  "active",
] as const)("explains a %s plan with no recorded amounts or assumptions", async (status) => {
  api.getFinanceBudget.mockResolvedValue(
    result({
      ...plan,
      status,
      resources: [],
      allocations: [],
      assumptions: [],
      expectedResources: 0,
      allocatedTotal: 0,
      balanceDelta: 0,
      approvedAt: status === "active" ? now : null,
    }),
  );
  api.listFinanceBudgetBuckets.mockResolvedValue({ taxonomy: { buckets: [] } });
  mount();
  expect(await screen.findByText(/No resources recorded/)).toBeVisible();
  expect(screen.getByText(/Nothing allocated yet/)).toBeVisible();
  expect(screen.getByText("No budget buckets yet.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "0 assumptions · Show details" }));
  expect(screen.getByText("No assumptions recorded.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Approve version/ })).not.toBeInTheDocument();
  if (status === "draft") expect(screen.getByText("Complete your financial profile")).toBeVisible();
  if (status !== "active") expect(screen.getAllByText("Not provided")).toHaveLength(2);
  else expect(screen.queryByText("Not provided")).not.toBeInTheDocument();
});

it("keeps missing category and goal identities distinguishable from unlinked allocations", async () => {
  api.getFinanceCategories.mockResolvedValue([]);
  api.listFinanceGoals.mockResolvedValue(result([]));
  api.getFinanceBudget.mockResolvedValue(
    result({
      ...plan,
      allocations: [
        { key: "Unknown category", kind: "spending", categoryId, amount: 100 },
        { key: "Unlinked category", kind: "spending", amount: 100 },
        { key: "Legacy category", kind: "spending", legacyCategory: "Old essentials", amount: 100 },
        { key: "Unknown goal", kind: "goal", goalId, amount: 100 },
        { key: "Unlinked savings", kind: "savings", amount: 100 },
      ],
    }),
  );
  mount();
  expect(await screen.findByText("Category unavailable")).toBeVisible();
  expect(screen.getByText("No category linked")).toBeVisible();
  expect(screen.getByText("Old essentials")).toBeVisible();
  expect(screen.getByRole("link", { name: "Goal unavailable" })).toHaveAttribute(
    "href",
    "/finances/wealth",
  );
  expect(screen.getByText("No linked record")).toBeVisible();
});

it.each([
  "Resource 2 name",
  "Allocation 2 name",
])("rejects duplicate %s until the name is corrected", async (label) => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
  fireEvent.change(screen.getByLabelText(label), {
    target: { value: label.startsWith("Resource") ? "Salary" : "Household" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  expect(
    await screen.findByText("Give each resource a unique name and each allocation a unique name."),
  ).toBeVisible();
  expect(api.reviseFinanceBudget).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(label), { target: { value: "Distinct purpose" } });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalledOnce());
});

it("requires a linked debt account after a kind change and removes cleared optional details", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Revise plan" }));
  fireEvent.change(screen.getByLabelText("Allocation 1 kind"), { target: { value: "debt" } });
  expect(screen.getByLabelText("Allocation 1 account")).toBeRequired();
  expect(screen.getByLabelText("Allocation 1 account")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Allocation 1 account"), { target: { value: accountId } });
  fireEvent.change(screen.getByLabelText("Allocation 1 description"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Resource 1 description"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Allocation 2 goal"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save proposal" }));
  await waitFor(() => expect(api.reviseFinanceBudget).toHaveBeenCalledOnce());
  const saved = api.reviseFinanceBudget.mock.calls[0]?.[0];
  expect(saved.allocations[0]).toEqual({ key: "Household", kind: "debt", amount: 3000, accountId });
  expect(saved.allocations[1].goalId).toBeUndefined();
  expect(saved.resources[0].description).toBeUndefined();
});
it("keeps approval visible when the following budget refresh fails", async () => {
  const client = mount(`/finances/plan?planId=${plan.planId}`);
  await screen.findByRole("button", { name: "Approve version 3" });
  api.getFinanceBudget.mockRejectedValue(new Error("Refresh unavailable"));
  await userEvent.click(screen.getByRole("button", { name: "Approve version 3" }));
  await waitFor(() =>
    expect(client.getQueryData(["finance-plan", plan.planId])).toMatchObject({
      data: { status: "active" },
    }),
  );
});
