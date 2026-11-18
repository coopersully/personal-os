// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceGoal, FinanceGoalPlanningEvidence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";
import {
  GoalProgressConfirmation,
  goalProgressApplicability,
} from "./goal-progress-confirmation.js";

const api = vi.hoisted(() => ({ manageFinanceGoal: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const loadingToast = vi.spyOn(toast, "loading");
const errorToast = vi.spyOn(toast, "error");
const successToast = vi.spyOn(toast, "success");
const owner = "11111111-1111-4111-8111-111111111111";
const goal: FinanceGoal = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Reserve",
  version: 3,
  currentAmount: 0,
  targetAmount: 1000,
  status: "active",
  priority: "high",
  deadline: null,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
};
const evidence: FinanceGoalPlanningEvidence = {
  kind: "goal",
  evidenceId: "33333333-3333-4333-8333-333333333333",
  ownerUserId: owner,
  actor: { type: "user", userId: owner },
  provenance: "explicit_user",
  currencyCode: "EUR",
  asOf: "2026-10-18",
  recordedAt: "2026-10-18T12:00:00Z",
  goalId: goal.id,
  goalVersion: 3,
  progressAmountCents: 0,
};
function envelope() {
  return {
    outcome: "completed",
    data: { ...goal, version: 4, planningEvidence: { ...evidence, goalVersion: 4 } },
    communication: { headline: "Saved", requiredDisclosures: [], optionalDetails: [] },
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Toaster />
      <GoalProgressConfirmation goal={goal} todayLocalDate="2026-10-18" onClose={close} />
    </QueryClientProvider>,
  );
  return { close, invalidate };
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function statement() {
  fill("Current goal amount you confirm", "0");
  fill("Currency for the whole goal", "EUR");
  fill("Progress statement as-of date", "2026-10-18");
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm my progress statement" }));
}
beforeEach(() => {
  toast.dismiss();
  vi.clearAllMocks();
  api.manageFinanceGoal.mockResolvedValue(envelope());
});

it("requires an explicit amount, currency and as-of, then records confirmed zero and refreshes canonical reads", async () => {
  const { close, invalidate } = mount();
  expect(screen.getByLabelText("Current goal amount you confirm")).toHaveValue("");
  submit();
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
  statement();
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.manageFinanceGoal).toHaveBeenCalledWith({
    operation: "confirm_progress",
    goalId: goal.id,
    expectedVersion: 3,
    progressAmountCents: 0,
    currencyCode: "EUR",
    asOf: "2026-10-18",
    idempotencyKey: expect.any(String),
  });
  expect(invalidate).toHaveBeenCalled();
  expect(loadingToast).toHaveBeenCalledWith(
    "Recording your goal progress…",
    expect.objectContaining({ id: expect.any(String) }),
  );
  expect(successToast).toHaveBeenCalledWith(
    "Goal progress confirmed.",
    expect.objectContaining({ id: loadingToast.mock.calls.at(-1)?.[1]?.id }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByText("Goal progress confirmed."),
  ).not.toBeInTheDocument();
});

it("rejects unsupported currency, subcent amounts and future dates before any write", () => {
  mount();
  statement();
  fill("Currency for the whole goal", "JPY");
  submit();
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
  expect(
    screen.getAllByText(/recognized currency with two minor-unit digits/).length,
  ).toBeGreaterThan(0);
  fill("Currency for the whole goal", "USD");
  fill("Current goal amount you confirm", "1.001");
  submit();
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
  fill("Current goal amount you confirm", "0");
  fill("Progress statement as-of date", "2026-10-19");
  submit();
  expect(api.manageFinanceGoal).not.toHaveBeenCalled();
  expect(screen.getAllByText(/cannot be in the future/).length).toBeGreaterThan(0);
});

it.each([
  "uncertain",
  "conflict",
  "failed envelope",
  "unauthorized",
  "forbidden",
  "rate limited",
  "server failure",
  "field validation",
])("delivers Sonner-only action feedback and preserves retry identity after %s", async (failure) => {
  if (failure === "uncertain")
    api.manageFinanceGoal.mockRejectedValueOnce(new Error("Network response lost"));
  else if (failure === "failed envelope")
    api.manageFinanceGoal.mockResolvedValueOnce({ ...envelope(), outcome: "failed" });
  else {
    const status =
      failure === "conflict"
        ? 409
        : failure === "unauthorized"
          ? 401
          : failure === "forbidden"
            ? 403
            : failure === "rate limited"
              ? 429
              : failure === "field validation"
                ? 400
                : 503;
    api.manageFinanceGoal.mockRejectedValueOnce(
      new ApiClientError({
        code: status === 400 ? "invalid_request" : "internal_error",
        message: "Statement rejected",
        status,
        ...(status === 400
          ? {
              details: [
                { code: "custom", path: ["currencyCode"], message: "Invalid currency statement" },
              ],
            }
          : {}),
      }),
    );
  }
  const { close } = mount();
  statement();
  submit();
  await waitFor(() => expect(api.manageFinanceGoal).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm my progress statement" })).toBeEnabled(),
  );
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(errorToast).toHaveBeenCalled());
  const actionMessage = String(errorToast.mock.calls.at(-1)?.[0]);
  expect(errorToast.mock.calls.at(-1)?.[1]?.id).toBe(loadingToast.mock.calls.at(-1)?.[1]?.id);
  expect(within(screen.getByRole("dialog")).queryByText(actionMessage)).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("status")).not.toBeInTheDocument();
  const toaster = document.querySelector<HTMLElement>("[data-sonner-toaster]");
  expect(toaster).not.toBeNull();
  if (!toaster) throw new Error("Sonner renderer missing");
  expect((await within(toaster).findAllByText(actionMessage)).length).toBeGreaterThan(0);

  expect(screen.getByLabelText("Current goal amount you confirm")).toHaveValue("0");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const first = api.manageFinanceGoal.mock.calls[0]?.[0];
  const second = api.manageFinanceGoal.mock.calls[1]?.[0];
  expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
  expect(successToast.mock.calls.at(-1)?.[1]?.id).toBe(loadingToast.mock.calls.at(-1)?.[1]?.id);
  if (failure === "uncertain" || failure === "server failure")
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  else expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});

it("qualifies owner, source identity, version, content, currency and as-of without promoting legacy zero", () => {
  expect(goalProgressApplicability(goal, owner, "2026-10-18").state).toBe("unknown");
  expect(
    goalProgressApplicability({ ...goal, planningEvidence: evidence }, owner, "2026-10-18").state,
  ).toBe("applicable");
  for (const change of [
    { goalVersion: 2 },
    { ownerUserId: "44444444-4444-4444-8444-444444444444" },
    { goalId: "44444444-4444-4444-8444-444444444444" },
    { progressAmountCents: 1 },
    { asOf: "2026-10-19" },
    { currencyCode: "JPY" },
  ]) {
    expect(
      goalProgressApplicability(
        { ...goal, planningEvidence: { ...evidence, ...change } },
        owner,
        "2026-10-18",
      ).state,
    ).toBe("unknown");
  }
});

it("updates one real Sonner toast from pending to confirmed success without inline action results", async () => {
  let resolveStatement: ((value: ReturnType<typeof envelope>) => void) | undefined;
  api.manageFinanceGoal.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveStatement = resolve;
    }),
  );
  mount();
  statement();
  submit();
  await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull());
  const toaster = document.querySelector<HTMLElement>("[data-sonner-toaster]");
  if (!toaster) throw new Error("Sonner renderer missing");
  expect(
    (await within(toaster).findAllByText("Recording your goal progress…")).length,
  ).toBeGreaterThan(0);
  expect(
    within(screen.getByRole("dialog")).queryByText("Recording your goal progress…"),
  ).not.toBeInTheDocument();
  await act(async () => {
    resolveStatement?.(envelope());
  });
  await waitFor(() => expect(successToast).toHaveBeenCalled());
  expect(successToast.mock.calls.at(-1)?.[1]?.id).toBe(loadingToast.mock.calls.at(-1)?.[1]?.id);
  expect((await within(toaster).findAllByText("Goal progress confirmed.")).length).toBeGreaterThan(
    0,
  );
  expect(
    within(screen.getByRole("dialog")).queryByText("Goal progress confirmed."),
  ).not.toBeInTheDocument();
});
