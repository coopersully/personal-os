// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createApiClient } from "@personal-os/api-client";
import type {
  FinanceCashflowSourceSnapshots,
  FinanceOccurrenceMatchEvent,
  FinanceRecurringOccurrence,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OccurrenceMatchDialog } from "./occurrence-match-dialog.js";

const api = vi.hoisted(() => ({ manageFinanceOccurrenceMatch: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const scheduleId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const allocationId = "44444444-4444-4444-8444-444444444444";
const matchId = "55555555-5555-4555-8555-555555555555";
const occurrenceId = "66666666-6666-4666-8666-666666666666";
const event: FinanceOccurrenceMatchEvent = {
  id: matchId,
  occurrenceId,
  kind: "match",
  allocationId,
  incomeTransactionId: null,
  amountCents: 500,
  currencyCode: "USD",
  allocationRevision: 7,
  transactionRevision: "9007199254740993",
  reimbursementRelationshipRevision: "9007199254740997",
  reversesMatchId: null,
  actorUserId: accountId,
  recordedAt: "2026-10-18T12:00:00Z",
  rationale: "Original match",
};
function mount(kind: "income" | "obligation" = "obligation", matchEvents = [event]) {
  const occurrence: FinanceRecurringOccurrence = {
    key: "schedule/date/0",
    occurrenceId,
    scheduleVersionId: scheduleId,
    source: { kind, id: scheduleId },
    sourceRevision: 3,
    accountId,
    displayName: "Rent",
    localDate: "2026-10-18",
    slot: 0,
    expectedAmountCents: 1000,
    currencyCode: "USD",
    amountBasis: "fixed",
    certainty: "expected",
    inCurrentSchedule: true,
    matchState: "partially_matched",
    matchedAmountCents: 500,
    remainingExpectedCents: 500,
    matchIds: [matchId],
  };
  const transaction: FinanceCashflowSourceSnapshots["transactions"][number] = {
    id: transactionId,
    accountId,
    merchant: "Posted movement",
    date: "2026-10-18",
    pending: false,
    direction: kind === "income" ? ("income" as const) : ("expense" as const),
    currencyCode: "USD",
    amountCents: 1000,
    transactionRevision: "9007199254740993",
    reimbursementRelationshipRevision: "9007199254740997",
    incomeEligibility: { eligible: kind === "income", reasons: [] },
    allocations: [
      {
        id: allocationId,
        amountCents: 1000,
        revision: 7,
        treatment: "personal",
        expenseEligibility: { eligible: kind === "obligation", reasons: [] },
      },
    ],
  };
  const close = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OccurrenceMatchDialog
        occurrence={occurrence}
        candidates={[
          transaction,
          {
            ...transaction,
            id: "77777777-7777-4777-8777-777777777777",
            merchant: "Unclassified movement",
            incomeEligibility: { eligible: false, reasons: ["unclassified"] },
            allocations: [],
          },
          {
            ...transaction,
            id: "88888888-8888-4888-8888-888888888888",
            merchant: "Pending movement",
            pending: true,
          },
        ]}
        matchEvents={matchEvents}
        onClose={close}
      />
    </QueryClientProvider>,
  );
  return close;
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function statement(expense = true) {
  fill("Posted actual movement", transactionId);
  if (expense) fill("Canonical expense allocation", allocationId);
  fill("Amount of this occurrence matched", "2.50");
  fill("Reason for this match decision", "Partial actual received");
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm actual match" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.manageFinanceOccurrenceMatch.mockResolvedValue({
    outcome: "completed",
    data: {},
    communication: { headline: "Recorded", requiredDisclosures: [], optionalDetails: [] },
  });
});
it("matches a partial canonical expense allocation with exact current revisions and excludes ambiguous posting", async () => {
  const close = mount();
  expect(
    screen.queryByRole("option", { name: /Unclassified movement|Pending movement/ }),
  ).not.toBeInTheDocument();
  statement();
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith({
    operation: "match_expense",
    occurrence: { scheduleVersionId: scheduleId, localDate: "2026-10-18", slot: 0 },
    transactionId,
    expectedTransactionRevision: "9007199254740993",
    expectedReimbursementRelationshipRevision: "9007199254740997",
    allocationId,
    expectedAllocationRevision: 7,
    amountCents: 250,
    currencyCode: "USD",
    rationale: "Partial actual received",
    idempotencyKey: expect.any(String),
  });
});
it("matches canonical income without manufacturing a shadow allocation", async () => {
  const close = mount("income");
  statement(false);
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const input = api.manageFinanceOccurrenceMatch.mock.calls[0]?.[0];
  expect(input.operation).toBe("match_income");
  expect(input).not.toHaveProperty("allocationId");
  expect(input).not.toHaveProperty("expectedAllocationRevision");
});
it("performs a full reversal with rationale and retains the original immutable audit input", async () => {
  const before = structuredClone(event);
  const close = mount();
  fill("Match operation", "reverse");
  fill("Existing match to reverse in full", matchId);
  fill("Reason for this match decision", "Wrong occurrence selected");
  fireEvent.click(screen.getByRole("button", { name: "Reverse the whole match" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.manageFinanceOccurrenceMatch).toHaveBeenCalledWith({
    operation: "reverse",
    matchId,
    rationale: "Wrong occurrence selected",
    idempotencyKey: expect.any(String),
  });
  expect(event).toEqual(before);
});
it("retains an uncertain partial match's exact payload and key on retry", async () => {
  api.manageFinanceOccurrenceMatch.mockRejectedValueOnce(new Error("Response lost"));
  const close = mount();
  statement();
  submit();
  await waitFor(() => expect(api.manageFinanceOccurrenceMatch).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm actual match" })).toBeEnabled(),
  );
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.manageFinanceOccurrenceMatch.mock.calls[1]?.[0]).toEqual(
    api.manageFinanceOccurrenceMatch.mock.calls[0]?.[0],
  );
});

it("sends canonical income matching through the real client without an allocation", async () => {
  const transport = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          outcome: "completed",
          data: {},
          communication: {
            headline: "Match recorded",
            requiredDisclosures: [],
            optionalDetails: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const client = createApiClient({ baseUrl: "https://nohmi.example", fetch: transport });
  api.manageFinanceOccurrenceMatch.mockImplementationOnce(client.manageFinanceOccurrenceMatch);
  const close = mount("income");
  statement(false);
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(transport).toHaveBeenCalledWith(
    "https://nohmi.example/v1/finances/recurring-occurrence-matches",
    expect.objectContaining({ method: "POST", credentials: "include" }),
  );
  const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    operation: "match_income",
    transactionId,
    expectedTransactionRevision: "9007199254740993",
    expectedReimbursementRelationshipRevision: "9007199254740997",
    amountCents: 250,
  });
  expect(body).not.toHaveProperty("allocationId");
});

it("attributes agent matches and reversals to their actual agent with a historical user fallback", () => {
  const agentId = "99999999-9999-4999-8999-999999999999";
  mount("obligation", [
    event,
    { ...event, id: "agent-match", approvalActor: { type: "agent", id: agentId } },
    {
      ...event,
      id: "agent-reversal",
      kind: "reverse",
      reversesMatchId: matchId,
      approvalActor: { type: "agent", id: agentId },
    },
  ]);
  expect(screen.getByText(new RegExp(`Event ${matchId} · User ${accountId}`))).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Event agent-match · Agent ${agentId}`))).toBeInTheDocument();
  expect(
    screen.getByText(new RegExp(`Event agent-reversal · Agent ${agentId}`)),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(new RegExp(`Event agent-match · User ${accountId}`)),
  ).not.toBeInTheDocument();
});
