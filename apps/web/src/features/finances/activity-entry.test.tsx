// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type {
  FinanceActivityEntry,
  FinanceActivityEvidencePage,
  FinanceActivityEvidenceQuery,
} from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceActivityEntry as ActivityEntry } from "./activity-entry";

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "evidence-toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
function entry(): FinanceActivityEntry {
  return {
    id: "receipt",
    occurredAt: "2026-10-18T10:00:00Z",
    kind: "financial_action",
    status: "applied",
    actor: { type: "agent", id: null },
    action: "Budget approved",
    explanation: "Exact approved budget",
    caseId: null,
    runId: "run",
    actionId: "candidate-action",
    sourceOperationId: null,
    auditEventIds: ["audit"],
    targets: [],
    recordRefs: [],
    sourceMessages: [],
    changes: [
      {
        id: "audit",
        recordRef: { kind: "finance_budget_plan", id: "budget" },
        sourceRecordRef: { kind: "finance_budget_plan", id: "budget" },
        actor: { type: "user", id: null },
        action: "Budget activated",
        before: { amount: "100.01", currencyCode: "USD" },
        after: { amount: "125.02", currencyCode: "USD" },
        auditEventIds: ["audit"],
      },
    ],
    effect: {
      candidateId: "candidate",
      candidateRevision: `sha256:${"a".repeat(64)}`,
      authorityBasis: "authenticated_owner",
      actionFamilies: ["budget_plan"],
      significance: "budget_decision",
      humanApproval: { actorId: "owner", reviewId: "approval-review" },
    },
    evidence: { loadedChanges: 1, totalChanges: 2, nextCursor: "next" },
  };
}
function mount(
  value: FinanceActivityEntry,
  readEvidence?: (
    id: string,
    query: FinanceActivityEvidenceQuery,
  ) => Promise<FinanceActivityEvidencePage>,
) {
  return render(
    <MemoryRouter>
      <ActivityEntry entry={value} {...(readEvidence ? { readEvidence } : {})} />
    </MemoryRouter>,
  );
}
function last(): FinanceActivityEvidencePage {
  return {
    entryId: "receipt",
    offset: 1,
    totalChanges: 2,
    nextCursor: null,
    auditEventIds: ["audit2"],
    recordRefs: [],
    changes: [
      {
        id: "audit2",
        recordRef: { kind: "account", id: "account" },
        before: null,
        after: { currencyCode: "EUR", amount: "50.00" },
        auditEventIds: ["audit2"],
        actor: { type: "system", id: "system" },
        occurredAt: "2026-10-18T11:00:00Z",
      },
    ],
  };
}
it("opens exact budget approval, currency and raw audit provenance with the keyboard", async () => {
  const user = userEvent.setup();
  mount(entry());
  const trigger = screen.getByRole("button", { name: "Inspect evidence" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/owner · Approval review approval-review/)).toBeVisible();
  expect(screen.getByText(/Actor ID unavailable/)).toBeVisible();
  expect(screen.getByText(/Original record: finance_budget_plan · budget/)).toBeVisible();
  expect(screen.getByText(/100.01/)).toHaveTextContent('"currencyCode": "USD"');
  expect(screen.getByText(/125.02/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Load more evidence" })).toBeDisabled();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});
it("links only proven canonical kinds and preserves unknown or mismatched provenance as text", () => {
  const value = entry();
  value.recordRefs = [
    { kind: "account", id: "account / one", sourceKind: "finance_account" },
    { kind: "review_case", id: "review", sourceKind: "finance_review_case" },
    { kind: "transaction", id: "not-a-transaction", sourceKind: "finance_budget_plan" },
    { kind: "constructor", id: "unknown", sourceKind: "constructor" },
    { kind: "contextual_question", id: "question", sourceKind: "finance_contextual_question" },
  ];
  value.targets = [
    { kind: "chat", id: "message / one" },
    { kind: "run", id: "run-target" },
  ];
  mount(value);
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  expect(screen.getByRole("link", { name: "account · account / one" })).toHaveAttribute(
    "href",
    "/finances/transactions?accountId=account%20%2F%20one",
  );
  expect(screen.getByRole("link", { name: "review case · review" })).toHaveAttribute(
    "href",
    "/finances/review?case=review",
  );
  expect(screen.getByRole("link", { name: "chat · message / one" })).toHaveAttribute(
    "href",
    "/finances/chat?message=message%20%2F%20one",
  );
  expect(screen.getByText("transaction · not-a-transaction")).toBeVisible();
  expect(screen.queryByRole("link", { name: /not-a-transaction/ })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /run-target|question|unknown/ }),
  ).not.toBeInTheDocument();
});
it("shows a recorded excerpt with its actual range and never substitutes the full message", () => {
  const value = entry();
  value.sourceMessages = [
    {
      id: "message",
      sequence: "9007199254740993",
      text: "Original immutable message",
      createdAt: "2026-10-18T10:00:00Z",
      contentHash: "b".repeat(64),
      excerpt: { start: 9, end: 18, text: "immutable" },
    },
  ];
  mount(value);
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  expect(screen.getByText("Original immutable message")).toBeVisible();
  expect(screen.getByText("Recorded excerpt · characters 9–18")).toBeVisible();
  expect(screen.getByText("immutable", { selector: "blockquote" })).toBeVisible();
  expect(screen.queryByText("No historical excerpt was recorded.")).not.toBeInTheDocument();
});
it.each([
  "entryId",
  "offset",
  "totalChanges",
] as const)("retains exact evidence and cursor when the %s continuation binding changes", async (field) => {
  const result = last();
  const invalid = {
    ...result,
    ...(field === "entryId"
      ? { entryId: "another-receipt" }
      : field === "offset"
        ? { offset: 0 }
        : { totalChanges: 3 }),
  };
  const read = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(result);
  mount(entry(), read);
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not load evidence. Try again.", {
      id: "evidence-toast",
    }),
  );
  expect(screen.getByText(/1 of 2 audited changes/)).toBeVisible();
  expect(screen.queryByText("Could not load evidence. Try again.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  expect(await screen.findByText("2 of 2 audited changes loaded · Complete")).toBeVisible();
  expect(screen.getByText(/50.00/)).toHaveTextContent('"currencyCode": "EUR"');
  expect(read.mock.calls[1]).toEqual(["receipt", { cursor: "next" }]);
});
it("retains private evidence after a transient HTTP failure and settles the same toast", async () => {
  mount(
    entry(),
    vi
      .fn()
      .mockRejectedValue(
        new ApiClientError({ status: 503, code: "unavailable", message: "Temporary" }),
      ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not load evidence. Try again.", {
      id: "evidence-toast",
    }),
  );
  expect(screen.getByText(/1 of 2 audited changes/)).toBeVisible();
  expect(toast.loading).toHaveBeenCalledWith("Loading more evidence…");
  expect(screen.queryByText("Loading more evidence…")).not.toBeInTheDocument();
});
it("discards a failed evidence read after unmount without replaying an error toast", async () => {
  let reject!: (reason: Error) => void;
  const read = vi.fn().mockImplementation(
    () =>
      new Promise<FinanceActivityEvidencePage>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const rendered = mount(entry(), read);
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  rendered.unmount();
  expect(toast.dismiss).toHaveBeenCalledWith("evidence-toast");
  reject(new Error("Late failure"));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(toast.error).not.toHaveBeenCalled();
});
