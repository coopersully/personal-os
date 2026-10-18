// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceReimbursement, MaterialSourceReference } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceReimbursementJourney } from "./reimbursement-journey";
import { FinanceReimbursementList } from "./reimbursement-list";

const api = vi.hoisted(() => ({ listFinanceReimbursements: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));

const claimId = "11111111-1111-4111-8111-111111111111";
const allocationId = "22222222-2222-4222-8222-222222222222";
const creditId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const recordedAt = "2026-10-18T12:00:00.000Z";
const evidence = {
  summary: "Shared dinner receipt",
  sourceRefs: [
    {
      accountId: null,
      provider: "local" as const,
      remoteId: sourceId,
      revision: "1",
      sourceType: "finance_transaction" as const,
    },
  ] satisfies [MaterialSourceReference],
};
function claim(changes: Partial<FinanceReimbursement> = {}): FinanceReimbursement {
  return {
    id: claimId,
    allocationId,
    payer: "Casey",
    expectedAmount: 120,
    receivedAmount: 40,
    status: "partially_received",
    dueDate: null,
    rationale: "Shared meal",
    evidence,
    revision: 2,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    cancelledAt: null,
    cancelledEvidence: null,
    cancelledRationale: null,
    matches: [
      {
        id: creditId,
        reimbursementId: claimId,
        creditTransactionId: creditId,
        amount: 40,
        createdAt: recordedAt,
        rationale: "First repayment",
        evidence: { ...evidence, summary: "Repayment evidence" },
      },
    ],
    ...changes,
  };
}
function mount(item = claim()) {
  return render(
    <MemoryRouter>
      <FinanceReimbursementJourney reimbursement={item} />
    </MemoryRouter>,
  );
}

it("opens recorded receipt evidence with the keyboard and links exact canonical transactions", async () => {
  const user = userEvent.setup();
  mount();
  const trigger = screen.getByRole("button", { name: "Receipt history and evidence" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("First repayment")).not.toBeInTheDocument();
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("First repayment")).toBeVisible();
  expect(screen.getByText("Recorded amount: 40.00")).toBeVisible();
  expect(screen.getByText("Currency is not supplied by this record.")).toBeVisible();
  expect(screen.getByText(/Match recorded/)).toBeVisible();
  expect(screen.getByText(/Match recorded/).querySelector("time")).toHaveAttribute(
    "dateTime",
    recordedAt,
  );
  expect(screen.queryByText(/settled|paid on/i)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open credit transaction 1" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${creditId}`,
  );
  expect(screen.getAllByRole("link", { name: "Open source transaction" })[0]).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${sourceId}`,
  );
  expect(screen.getByText(allocationId)).toBeVisible();
  expect(screen.getByText(claimId)).toBeVisible();
  await user.keyboard(" ");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});

it("keeps multiple partial receipts distinct without recomputing the server's received amount", async () => {
  const first = claim();
  mount(
    claim({
      matches: [
        ...first.matches,
        {
          id: sourceId,
          reimbursementId: claimId,
          creditTransactionId: sourceId,
          createdAt: recordedAt,
          evidence,
          amount: 15,
          rationale: "Second repayment",
        },
      ],
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  const receipts = screen.getByRole("list", { name: "Recorded receipts" });
  expect(within(receipts).getAllByRole("listitem")).toHaveLength(2);
  expect(within(receipts).getByText("Recorded amount: 15.00")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open credit transaction 2" })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${sourceId}`,
  );
});

it("retains receipts and cancellation evidence after the expected remainder is cancelled", async () => {
  mount(
    claim({
      status: "cancelled",
      cancelledAt: recordedAt,
      cancelledRationale: "Remainder waived",
      cancelledEvidence: { ...evidence, summary: "Cancellation confirmed by payer" },
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  expect(screen.getByText("First repayment")).toBeVisible();
  expect(screen.getByText("Remainder waived")).toBeVisible();
  expect(screen.getByText("Cancellation confirmed by payer")).toBeVisible();
  expect(screen.getByText(/Cancellation recorded/)).toBeVisible();
});

it("shows an unknown due date and an empty receipt history honestly", async () => {
  mount(claim({ matches: [], receivedAmount: 0, status: "expected" }));
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  expect(screen.getByText("Due date not recorded")).toBeVisible();
  expect(screen.getByText("No receipts recorded")).toBeVisible();
  expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
});

it("renders provider evidence as text without treating remote IDs as local transaction links", async () => {
  const remoteId = "https://example.com/provider-record";
  mount(
    claim({
      evidence: {
        summary: "Provider evidence",
        sourceRefs: [{ ...evidence.sourceRefs[0], provider: "plaid", remoteId, revision: null }],
      },
      matches: [],
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  expect(screen.getByText(remoteId)).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("preserves separate evidence for claims belonging to the same payer", async () => {
  render(
    <MemoryRouter>
      <FinanceReimbursementJourney reimbursement={claim()} />
      <FinanceReimbursementJourney
        reimbursement={claim({
          id: sourceId,
          allocationId: creditId,
          matches: [],
          rationale: "Different expense",
        })}
      />
    </MemoryRouter>,
  );
  const triggers = screen.getAllByRole("button", { name: "Receipt history and evidence" });
  const secondTrigger = triggers[1];
  if (!secondTrigger) throw new Error("Second claim disclosure is missing");
  await userEvent.click(secondTrigger);
  expect(screen.getByText("Different expense")).toBeVisible();
  expect(screen.queryByText("First repayment")).not.toBeInTheDocument();
  expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
});

it("integrates receipt details without changing the claim summary totals", async () => {
  api.listFinanceReimbursements.mockResolvedValue({
    reimbursements: [claim()],
    unmatchedCredits: [],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <FinanceReimbursementList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/\$40.00 received of \$120.00 · \$80.00 remaining/)).toBeVisible();
  expect(screen.getByLabelText("Reimbursement from Casey")).toHaveAttribute(
    "aria-valuenow",
    "33.33333333333333",
  );
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  expect(screen.getByRole("link", { name: "Open credit transaction 1" })).toBeVisible();
  expect(screen.getByText(/\$40.00 received of \$120.00 · \$80.00 remaining/)).toBeVisible();
  expect(api.listFinanceReimbursements).toHaveBeenCalledTimes(1);
});

it("does not link missing or invalid local transaction IDs and retains optional cancellation gaps", async () => {
  mount(
    claim({
      status: "cancelled",
      matches: [],
      dueDate: "2026-10-31",
      evidence: {
        summary: "Manual record",
        sourceRefs: [
          { ...evidence.sourceRefs[0], remoteId: "not-a-canonical-id", accountId: allocationId },
          { ...evidence.sourceRefs[0], remoteId: null, revision: null },
        ],
      },
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Receipt history and evidence" }));
  expect(screen.getByText("Due date: 2026-10-31")).toBeVisible();
  expect(screen.getByText("Cancellation time not recorded")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getAllByText(allocationId)).toHaveLength(2);
});
