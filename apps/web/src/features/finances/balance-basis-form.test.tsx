// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createApiClient } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BalanceBasisForm } from "./balance-basis-form.js";

const api = vi.hoisted(() => ({ confirmFinanceBalanceBasis: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const accountId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
function mount(truncated = false, complete = true) {
  const close = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BalanceBasisForm
        account={{
          id: accountId,
          name: "Checking",
          currencyCode: "USD",
          kind: "cash",
          includeInPlanning: true,
          ownershipType: "individual",
          ownershipShare: 1,
          accountRevision: "9007199254740993",
        }}
        previousBasis={null}
        coverage={{ complete, truncated, transactionLimit: 1000 }}
        transactions={[
          {
            id: transactionId,
            accountId,
            merchant: "Rent",
            date: "2026-10-01",
            transactionRevision: "9007199254740994",
            reimbursementRelationshipRevision: "9007199254740997",
            amountCents: 1000,
            currencyCode: "USD",
            direction: "expense",
            pending: true,
            incomeEligibility: { eligible: false, reasons: ["pending"] },
            allocations: [],
          },
        ]}
        onClose={close}
      />
    </QueryClientProvider>,
  );
  return close;
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function statement() {
  fill("Balance kind you confirm", "available");
  fill("Balance amount", "-12.34");
  fill("Balance currency code", "USD");
  fill("Balance as-of instant (ISO with offset)", "2026-10-18T10:00:00-04:00");
  fill("Valid-until instant (ISO with offset)", "2026-10-18T11:00:00-04:00");
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm my balance statement" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.confirmFinanceBalanceBasis.mockResolvedValue({
    outcome: "completed",
    data: {},
    communication: { headline: "Recorded", requiredDisclosures: [], optionalDetails: [] },
  });
});
it("requires explicit per-movement reflection and preserves exact bigint revision strings and unknown floor", async () => {
  const close = mount();
  statement();
  submit();
  expect(api.confirmFinanceBalanceBasis).not.toHaveBeenCalled();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "not_included");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.confirmFinanceBalanceBasis).toHaveBeenCalledWith({
    accountId,
    expectedAccountRevision: "9007199254740993",
    expectedBasisRevision: 0,
    kind: "available",
    amountCents: -1234,
    currencyCode: "USD",
    asOf: "2026-10-18T10:00:00-04:00",
    validUntil: "2026-10-18T11:00:00-04:00",
    protectedFloorCents: null,
    reflections: [
      {
        transactionId,
        transactionRevision: "9007199254740994",
        reimbursementRelationshipRevision: "9007199254740997",
        reflection: "not_included",
      },
    ],
    idempotencyKey: expect.any(String),
  });
});
it("rejects inverted validity and distinguishes an optional explicit zero floor", async () => {
  const close = mount();
  statement();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "included");
  fill("Valid-until instant (ISO with offset)", "2026-10-18T09:00:00-04:00");
  submit();
  expect(api.confirmFinanceBalanceBasis).not.toHaveBeenCalled();
  fill("Valid-until instant (ISO with offset)", "2026-10-18T11:00:00-04:00");
  fill("Optional protected floor (blank means unknown)", "0");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.confirmFinanceBalanceBasis).toHaveBeenCalledWith(
    expect.objectContaining({
      protectedFloorCents: 0,
      reflections: [
        {
          transactionId,
          transactionRevision: "9007199254740994",
          reimbursementRelationshipRevision: "9007199254740997",
          reflection: "included",
        },
      ],
    }),
  );
});
it("reuses an uncertain statement's key and never substitutes the displayed account balance", async () => {
  api.confirmFinanceBalanceBasis.mockRejectedValueOnce(new Error("Response lost"));
  const close = mount();
  expect(screen.getByLabelText("Balance amount")).toHaveValue("");
  statement();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "included");
  submit();
  await waitFor(() => expect(api.confirmFinanceBalanceBasis).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm my balance statement" })).toBeEnabled(),
  );
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.confirmFinanceBalanceBasis.mock.calls[1]?.[0]).toEqual(
    api.confirmFinanceBalanceBasis.mock.calls[0]?.[0],
  );
});

it("does not let truncated source coverage establish a complete reflection statement", () => {
  mount(true);
  statement();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "included");
  submit();
  expect(api.confirmFinanceBalanceBasis).not.toHaveBeenCalled();
  expect(screen.getByText(/Source transaction coverage is incomplete/)).toBeInTheDocument();
});

it("sends basis reflection revisions unchanged through the real client route", async () => {
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
  api.confirmFinanceBalanceBasis.mockImplementationOnce(client.confirmFinanceBalanceBasis);
  const close = mount();
  statement();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "included");
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(transport).toHaveBeenCalledWith(
    "https://nohmi.example/v1/finances/balance-bases",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toMatchObject({
    accountId,
    expectedAccountRevision: "9007199254740993",
    protectedFloorCents: null,
    reflections: [
      {
        transactionId,
        transactionRevision: "9007199254740994",
        reimbursementRelationshipRevision: "9007199254740997",
        reflection: "included",
      },
    ],
  });
});

it("does not treat a nontruncated date window as a complete account-history review", () => {
  mount(false, false);
  statement();
  fill("Balance reflection for Rent · 2026-10-01 · revision 9007199254740994", "included");
  submit();
  expect(api.confirmFinanceBalanceBasis).not.toHaveBeenCalled();
  expect(screen.getByText(/Source transaction coverage is incomplete/)).toBeInTheDocument();
});
