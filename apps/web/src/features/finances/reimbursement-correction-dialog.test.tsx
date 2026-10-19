// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceReimbursement } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, type ToastT, toast } from "sonner";
import { ReimbursementCorrectionDialog } from "./reimbursement-correction-dialog";

const api = vi.hoisted(() => ({ reconcileFinanceReimbursement: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
const id = "11111111-1111-4111-8111-111111111111";
const allocationId = "22222222-2222-4222-8222-222222222222";
const creditId = "33333333-3333-4333-8333-333333333333";
const evidence = {
  summary: "Dinner evidence",
  sourceRefs: [
    {
      provider: "local" as const,
      sourceType: "finance_transaction" as const,
      remoteId: creditId,
      accountId: null,
      revision: "1",
    },
  ],
};
const claim: FinanceReimbursement = {
  id,
  allocationId,
  expectedAmount: 120,
  receivedAmount: 40,
  payer: "Casey",
  dueDate: null,
  revision: 2,
  status: "partially_received",
  rationale: "Dinner",
  evidence,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
  cancelledAt: null,
  cancelledEvidence: null,
  cancelledRationale: null,
  matches: [
    {
      id: creditId,
      reimbursementId: id,
      creditTransactionId: creditId,
      amount: 40,
      createdAt: "2026-10-18T12:00:00Z",
      evidence,
      rationale: "Receipt",
    },
  ],
};
function show(
  operation: "correct_expected" | "unmatch_credit" = "correct_expected",
  reimbursement = claim,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const close = vi.fn(),
    denied = vi.fn();
  const ui = (item: FinanceReimbursement) => (
    <>
      <Toaster />
      <QueryClientProvider client={client}>
        <ReimbursementCorrectionDialog
          reimbursement={item}
          operation={operation}
          {...(operation === "unmatch_credit" ? { matchId: creditId } : {})}
          onClose={close}
          onDenied={denied}
        />
      </QueryClientProvider>
    </>
  );
  const view = render(ui(reimbursement));
  return {
    close,
    denied,
    client,
    rerender: (item: FinanceReimbursement) => view.rerender(ui(item)),
  };
}
function fill() {
  fireEvent.change(screen.getByLabelText("Reason for correction"), {
    target: { value: "Correct the agreed reimbursement" },
  });
  fireEvent.change(screen.getByLabelText("Supporting evidence"), {
    target: { value: "Payer confirmed the amount and receipt" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}
function activeToasts() {
  return toast.getToasts().filter((entry): entry is ToastT => "title" in entry);
}
beforeEach(() => {
  vi.resetAllMocks();
  toast.dismiss();
});
afterEach(() => toast.dismiss());
it("requires explicit confirmation and preserves case/source identity for a correction", async () => {
  api.reconcileFinanceReimbursement.mockResolvedValue({
    ...claim,
    expectedAmount: 80,
    revision: 3,
  });
  const { close } = show();
  expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Expected amount"), { target: { value: "80" } });
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.reconcileFinanceReimbursement).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "correct_expected",
      reimbursementId: id,
      expectedRevision: 2,
      expectedAmount: 80,
      payer: "Casey",
      dueDate: null,
      idempotencyKey: expect.any(String),
      rationale: "Correct the agreed reimbursement",
      evidence: {
        summary: "Payer confirmed the amount and receipt",
        sourceRefs: evidence.sourceRefs,
      },
    }),
  );
});
it("freezes opening source and exact payload/key for uncertain retry even after newer props arrive", async () => {
  api.reconcileFinanceReimbursement
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValueOnce({ status: "applied", result: claim });
  const { close, rerender } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  const retry = await screen.findByRole("button", { name: "Retry same correction" });
  rerender({ ...claim, revision: 9, expectedAmount: 999 });
  expect(screen.getByLabelText("Expected amount")).toHaveValue("120");
  expect(screen.getByLabelText("Expected amount")).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.reconcileFinanceReimbursement.mock.calls[1]?.[0]).toEqual(
    api.reconcileFinanceReimbursement.mock.calls[0]?.[0],
  );
});
it.each([
  { status: "pending_review" },
  { status: "needs_input" },
  { outcome: "failed" },
  { status: "applied", result: { ...claim, id: allocationId } },
])("does not claim completion for non-claim result %j", async (response) => {
  api.reconcileFinanceReimbursement.mockResolvedValue(response);
  const { close } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByRole("button", { name: "Retry same correction" })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
});
it("can unmatch an exact active receipt even on a cancelled case without erasing the credit", async () => {
  api.reconcileFinanceReimbursement.mockResolvedValue({
    ...claim,
    status: "cancelled",
    matches: [],
    receivedAmount: 0,
    revision: 3,
  });
  const { close } = show("unmatch_credit", { ...claim, status: "cancelled" });
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.reconcileFinanceReimbursement).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "unmatch_credit",
      matchId: creditId,
      reimbursementId: id,
      expectedRevision: 2,
    }),
  );
});
it("uses real Sonner loading to confirmed success on the same ID without inline action feedback", async () => {
  let complete!: (value: FinanceReimbursement) => void;
  api.reconcileFinanceReimbursement.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText("Saving reimbursement correction…")).toBeInTheDocument();
  const pending = activeToasts().at(-1);
  expect(pending?.type).toBe("loading");
  await act(async () => complete(claim));
  expect(await screen.findByText("Reimbursement correction saved.")).toBeInTheDocument();
  expect(activeToasts().find((entry) => entry.id === pending?.id)?.type).toBe("success");
  expect(within(screen.getByRole("dialog")).queryByRole("status")).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
});
it.each([
  400, 401, 403, 409, 429, 500,
])("uses Sonner and hides private dialog on authoritative denial %s", async (status) => {
  api.reconcileFinanceReimbursement.mockRejectedValue(
    new ApiClientError({
      status,
      code: status === 400 ? "invalid_request" : "failure",
      message: "Rejected",
    }),
  );
  const { close, denied } = show();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(activeToasts().at(-1)?.type).toBe("error"));
  expect(close).not.toHaveBeenCalled();
  if (status === 401 || status === 403) {
    expect(denied).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } else {
    expect(within(screen.getByRole("dialog")).queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  }
});
it("rejects subcent amounts and expectations below received money", () => {
  show();
  fill();
  for (const value of ["1.234", "39.99"]) {
    fireEvent.change(screen.getByLabelText("Expected amount"), { target: { value } });
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
  }
});
