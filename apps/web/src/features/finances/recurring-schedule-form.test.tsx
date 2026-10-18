// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError, createApiClient } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RecurringScheduleForm } from "./recurring-schedule-form.js";
const api = vi.hoisted(() => ({ confirmFinanceRecurringSchedule: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const sourceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
function mount() {
  const close = vi.fn();
  const saved = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecurringScheduleForm
        source={{ kind: "income", id: sourceId }}
        sourceName="Payroll"
        expectedSourceRevision={3}
        supersedes={null}
        accounts={[{ id: accountId, name: "Checking", currencyCode: "USD" }]}
        onClose={close}
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
  return { close, saved };
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function statement(cadence = "semimonthly") {
  fill("Schedule account", accountId);
  fill("Confirmed cadence", cadence);
  fill("Schedule timezone (IANA)", "America/New_York");
  fill("Original anchor local date", "2026-01-31");
  fill("Effective from local date", "2026-10-01");
  if (cadence === "semimonthly") {
    fill("First semimonthly day (1–31)", "15");
    fill("Second semimonthly day (1–31)", "31");
  }
  fill("Amount basis", "fixed");
  fill("Expected amount (blank if variable and unknown)", "0");
  fill("Schedule currency code", "USD");
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm my schedule statement" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.confirmFinanceRecurringSchedule.mockResolvedValue({
    outcome: "completed",
    data: {},
    communication: { headline: "Recorded", requiredDisclosures: [], optionalDetails: [] },
  });
});
it("requires an explicit original anchor and records exact semimonthly facts, zero amount and source revision", async () => {
  const { close, saved } = mount();
  expect(screen.getByLabelText("Original anchor local date")).toHaveValue("");
  submit();
  expect(api.confirmFinanceRecurringSchedule).not.toHaveBeenCalled();
  statement();
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(saved).toHaveBeenCalledOnce();
  expect(api.confirmFinanceRecurringSchedule).toHaveBeenCalledWith({
    source: { kind: "income", id: sourceId },
    expectedSourceRevision: 3,
    supersedesId: null,
    accountId,
    cadence: "semimonthly",
    timezone: "America/New_York",
    anchorLocalDate: "2026-01-31",
    effectiveFrom: "2026-10-01",
    semimonthlyDays: [15, 31],
    amountBasis: "fixed",
    amountCents: 0,
    currencyCode: "USD",
    idempotencyKey: expect.any(String),
  });
});
it("rejects duplicate semimonthly slots and unsupported currency, but retains unknown variable amount as null", async () => {
  const { close } = mount();
  statement();
  fill("Second semimonthly day (1–31)", "15");
  submit();
  expect(api.confirmFinanceRecurringSchedule).not.toHaveBeenCalled();
  fill("Second semimonthly day (1–31)", "31");
  fill("Schedule currency code", "JPY");
  submit();
  expect(api.confirmFinanceRecurringSchedule).not.toHaveBeenCalled();
  fill("Schedule currency code", "USD");
  fill("Amount basis", "variable");
  fill("Expected amount (blank if variable and unknown)", "");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.confirmFinanceRecurringSchedule).toHaveBeenCalledWith(
    expect.objectContaining({ amountBasis: "variable", amountCents: null }),
  );
});
it.each([
  "uncertain",
  "conflict",
])("keeps statements and handles retry identity after %s", async (failure) => {
  api.confirmFinanceRecurringSchedule.mockRejectedValueOnce(
    failure === "uncertain"
      ? new Error("Response lost")
      : new ApiClientError({ code: "conflict", message: "Source changed", status: 409 }),
  );
  const { close } = mount();
  statement("monthly");
  submit();
  await waitFor(() => expect(api.confirmFinanceRecurringSchedule).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm my schedule statement" })).toBeEnabled(),
  );
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const first = api.confirmFinanceRecurringSchedule.mock.calls[0]?.[0];
  const second = api.confirmFinanceRecurringSchedule.mock.calls[1]?.[0];
  expect(second).toEqual({ ...first, idempotencyKey: expect.any(String) });
  if (failure === "uncertain") expect(second.idempotencyKey).toBe(first.idempotencyKey);
  else expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});

it("uses the real client schedule route and JSON contract", async () => {
  const transport = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          outcome: "completed",
          data: {},
          communication: {
            headline: "Statement recorded",
            requiredDisclosures: [],
            optionalDetails: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const client = createApiClient({ baseUrl: "https://nohmi.example", fetch: transport });
  api.confirmFinanceRecurringSchedule.mockImplementationOnce(
    client.confirmFinanceRecurringSchedule,
  );
  const { close } = mount();
  statement("monthly");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(transport).toHaveBeenCalledWith(
    "https://nohmi.example/v1/finances/recurring-schedules",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );
  const options = transport.mock.calls[0]?.[1];
  expect(JSON.parse(String(options?.body))).toMatchObject({
    source: { kind: "income", id: sourceId },
    expectedSourceRevision: 3,
    semimonthlyDays: null,
    amountCents: 0,
  });
});
