// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceActivityEntry, FinanceActivityPage as Page } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceActivityPage, groupFinanceActivity } from "./activity-page";

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-id"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
const entry: FinanceActivityEntry = {
  id: "entry",
  occurredAt: "2026-10-18T10:00:00Z",
  kind: "human_answer_decision",
  status: "accepted",
  actor: { type: "user", id: "human" },
  action: "Answer accepted",
  explanation: "Use the source answer",
  caseId: "case",
  runId: null,
  actionId: null,
  sourceOperationId: "operation",
  auditEventIds: ["audit"],
  recordRefs: [],
  changes: [],
  targets: [],
  sourceMessages: [
    {
      id: "message",
      sequence: "9223372036854775807",
      text: "Immutable original answer",
      createdAt: "2026-10-18T10:00:00Z",
      contentHash: "a".repeat(64),
      excerpt: null,
    },
  ],
};
const page = (entries = [entry], nextCursor: string | null = null): Page => ({
  entries,
  nextCursor,
  capabilities: {
    financialActions: { state: "unavailable", reason: "mutation_evidence_not_integrated" },
    humanDecisions: { state: "available" },
  },
  coverage: {
    state: "partial",
    reasons: [
      "financial_mutation_evidence_not_integrated",
      "historical_decisions_without_causal_message_not_projected",
    ],
  },
});
function view(readActivity: (query: unknown) => Promise<Page>, ownerId = "one") {
  return (
    <MemoryRouter>
      <FinanceActivityPage ownerId={ownerId} readActivity={readActivity} />
    </MemoryRouter>
  );
}
function openActivity() {
  const button = screen.getAllByRole("button", { name: /^Open activity:/ })[0];
  if (!button) throw new Error("Activity record missing");
  fireEvent.click(button);
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  // Node's server-side storage may shadow JSDOM storage. Isolate table preferences per test.
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } satisfies Storage);
});
it("shows honest coverage and immutable supporting evidence without rounding message sequences", async () => {
  const read = vi.fn().mockResolvedValue(page());
  render(view(read));
  expect(await screen.findByText(/Partial history/)).toBeVisible();

  openActivity();
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  expect(await screen.findByText("Immutable original answer")).toBeVisible();
  expect(screen.getByText(/9223372036854775807/)).toBeVisible();
  expect(screen.getByText("No historical excerpt was recorded.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open source message" })).toHaveAttribute(
    "href",
    "/finances/chat?message=message",
  );
  expect(screen.getByRole("link", { name: "Review case" })).toHaveAttribute(
    "href",
    "/finances/review?case=case",
  );
});
it("retains old results and cursor after failures and updates one action toast", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "cursor"))
    .mockRejectedValueOnce(new Error("private failure"))
    .mockResolvedValueOnce(page([{ ...entry, id: "entry2", action: "Second answer" }]));
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not load activity. Try again.", {
      id: "toast-id",
    }),
  );
  expect(screen.getByText(entry.explanation)).toBeVisible();
  expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Second answer");
  expect(screen.getAllByText(entry.explanation)).toHaveLength(1);
  expect(read.mock.calls[2]?.[0]).toMatchObject({ cursor: "cursor", limit: 50 });
  expect(toast.success).toHaveBeenCalledWith("Activity loaded", { id: "toast-id" });
});
it("applies filters from scratch and refreshes the applied filters rather than draft edits", async () => {
  const read = vi.fn().mockResolvedValue(page([entry], "old"));
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Activity filters" }));
  fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "agent" } });
  fireEvent.change(screen.getByLabelText("From (UTC)"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(read.mock.calls[1]?.[0]).toEqual({
    limit: 50,
    actor: "agent",
    from: "2026-10-01T00:00:00.000Z",
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh activity" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Activity filters" }));
  fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "system" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read.mock.calls[2]?.[0]).toMatchObject({ actor: "agent" });
});
it("discards old owner results and in-flight work", async () => {
  let resolve!: (value: Page) => void;
  const first = vi.fn().mockImplementation(
    () =>
      new Promise<Page>((done) => {
        resolve = done;
      }),
  );
  const second = vi.fn().mockResolvedValue(page([]));
  const rendered = render(view(first));
  rendered.rerender(view(second, "two"));
  await screen.findByText(/No recorded activity matches/);
  resolve(page());
  await waitFor(() => expect(screen.queryByText(entry.explanation)).not.toBeInTheDocument());
});
it("renders financial statuses and exact before/after evidence without a fabricated run route", async () => {
  const financial = {
    ...entry,
    kind: "financial_action" as const,
    status: "partial" as const,
    runId: "run",
    actionId: "action",
    sourceMessages: [],
    changes: [
      {
        id: "change",
        recordRef: { kind: "transaction" as const, id: "transaction" },
        before: { amount: "10.01" },
        after: { amount: "9.99" },
        auditEventIds: ["change-audit"],
      },
    ],
  };
  render(view(vi.fn().mockResolvedValue(page([financial]))));
  await screen.findByText("partial");
  openActivity();
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  expect(await screen.findByText(/10.01/)).toBeVisible();
  expect(screen.getByText(/9.99/)).toBeVisible();
  expect(screen.getByText("run")).toBeVisible();
  expect(screen.queryByRole("link", { name: /run/ })).not.toBeInTheDocument();
});
it("keeps loaded records on refresh failure and rejects reversed dates without reading", async () => {
  const read = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("down"));
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByText(entry.explanation)).toBeVisible();
  expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Activity filters" }));
  fireEvent.change(screen.getByLabelText("From (UTC)"), { target: { value: "2026-10-18" } });
  fireEvent.change(screen.getByLabelText("Through (UTC)"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(toast.error).toHaveBeenCalledWith("Check the filters and date range.");
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  "accepted",
  "proposed",
  "approved",
  "applied",
  "failed",
  "partial",
] as const)("preserves the %s status", async (status) => {
  render(view(vi.fn().mockResolvedValue(page([{ ...entry, kind: "financial_action", status }]))));
  expect(await screen.findByText(status)).toBeVisible();
  expect(screen.queryByText(/Answer accepted. This record/)).not.toBeInTheDocument();
});

it.each([
  401, 403,
])("clears same-owner private results and pagination after authoritative %s refresh denial", async (status) => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "private-cursor"))
    .mockRejectedValueOnce(new ApiClientError({ status, code: "denied", message: "Denied" }))
    .mockResolvedValueOnce(page([]));
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  await waitFor(() => expect(screen.queryByText(entry.explanation)).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Activity coverage")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  await screen.findByText(/No recorded activity/);
  expect(read.mock.calls[2]?.[0]).toEqual({ limit: 50 });
});
it.each([401, 403])("clears same-owner evidence on direct pagination %s denial", async (status) => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "private-cursor"))
    .mockRejectedValueOnce(new ApiClientError({ status, code: "denied", message: "Denied" }));
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByRole("button", { name: "Retry activity" });
  expect(read.mock.calls[1]?.[0]).toMatchObject({ cursor: "private-cursor" });
  expect(screen.queryByText(entry.explanation)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith(expect.any(String), { id: "toast-id" });
});
it.each([
  "Retry activity",
  "Refresh activity",
])("uses only Sonner pending feedback for explicit %s without a page", async (action) => {
  let resolve!: (value: Page) => void;
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("Transient"))
    .mockImplementationOnce(
      () =>
        new Promise<Page>((done) => {
          resolve = done;
        }),
    );
  render(view(read));
  await screen.findByRole("button", { name: "Retry activity" });
  fireEvent.click(screen.getByRole("button", { name: action }));
  expect(toast.loading).toHaveBeenCalledWith("Loading activity…");
  expect(screen.queryByText("Loading activity…")).not.toBeInTheDocument();
  resolve(page([]));
  await screen.findByText(/No recorded activity/);
  expect(toast.success).toHaveBeenCalledWith("Activity loaded", { id: "toast-id" });
});
it("cannot restore denied evidence from an older in-flight response", async () => {
  let resolve!: (value: Page) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "old-cursor"))
    .mockImplementationOnce(
      () =>
        new Promise<Page>((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValueOnce(
      new ApiClientError({ status: 403, code: "forbidden", message: "Denied" }),
    );
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  // Exercise overlapping request settlement independent of the disabled control affordance.
  fireEvent.click(screen.getByRole("button", { name: "Activity filters" }));
  const form = document.querySelector("form");
  if (!form) throw new Error("Activity filter form missing");
  fireEvent.submit(form);
  await screen.findByRole("button", { name: "Retry activity" });
  resolve(page([entry], "old-cursor"));
  await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("toast-id"));
  expect(screen.queryByText(entry.explanation)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
});

function financialEntry(): FinanceActivityEntry {
  const changes = Array.from({ length: 100 }, (_, i) => ({
    id: `audit-${i}`,
    recordRef: { kind: "transaction", id: `record-${i}` },
    before: { category: "Uncategorized" },
    after: { category: `Food ${i}` },
    auditEventIds: [`audit-${i}`],
  }));
  return {
    ...entry,
    kind: "financial_action",
    status: "applied",
    action: "Classified transactions",
    actor: { type: "agent", id: "agent" },
    runId: "run",
    sourceMessages: [],
    changes,
    effect: {
      candidateId: "candidate",
      candidateRevision: `sha256:${"a".repeat(64)}`,
      authorityBasis: "original_live_grant",
      actionFamilies: ["transaction"],
      significance: "routine",
      humanApproval: null,
    },
    evidence: { totalChanges: 101, loadedChanges: 100, nextCursor: "evidence-cursor" },
  };
}
it("loads exact remaining evidence without a second activity row and retains it on transient failure", async () => {
  const financial = financialEntry();
  const readEvidence = vi
    .fn()
    .mockRejectedValueOnce(new Error("Temporary"))
    .mockResolvedValueOnce({
      entryId: financial.id,
      offset: 100,
      totalChanges: 101,
      nextCursor: null,
      auditEventIds: ["last-audit"],
      recordRefs: [{ kind: "transaction", id: "last-record" }],
      changes: [
        {
          id: "last-audit",
          recordRef: { kind: "transaction", id: "last-record" },
          before: { category: "Uncategorized" },
          after: { category: "Final classification" },
          auditEventIds: ["last-audit"],
        },
      ],
    });
  render(
    <MemoryRouter>
      <FinanceActivityPage
        ownerId="one"
        readActivity={vi.fn().mockResolvedValue(page([financial]))}
        readEvidence={readEvidence}
      />
    </MemoryRouter>,
  );
  await screen.findByText("Classified transactions");
  openActivity();
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  expect(
    await screen.findByText("100 of 101 audited changes loaded · Evidence incomplete"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Could not load evidence. Try again.", {
      id: "toast-id",
    }),
  );
  expect(screen.getByText(/100 of 101/)).toBeVisible();
  expect(screen.queryByText("Could not load evidence. Try again.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  expect(await screen.findByText("101 of 101 audited changes loaded · Complete")).toBeVisible();
  expect(screen.getByText(/Final classification/)).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveTextContent("Classified transactions");
  expect(screen.getByRole("link", { name: "transaction · last-record" })).toHaveAttribute(
    "href",
    "/finances/transactions?transactionId=last-record",
  );
  expect(toast.success).toHaveBeenCalledWith("Evidence loaded", { id: "toast-id" });
  expect(readEvidence.mock.calls[1]).toEqual([financial.id, { cursor: "evidence-cursor" }]);
});
it.each([
  401, 403, 404,
])("clears private action evidence on evidence read %s access loss", async (status) => {
  const financial = financialEntry();
  render(
    <MemoryRouter>
      <FinanceActivityPage
        ownerId="one"
        readActivity={vi.fn().mockResolvedValue(page([financial]))}
        readEvidence={vi
          .fn()
          .mockRejectedValue(
            new ApiClientError({ status, code: "denied", message: "Unavailable" }),
          )}
      />
    </MemoryRouter>,
  );
  await screen.findByText("Classified transactions");
  openActivity();
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  await screen.findByRole("button", { name: "Retry activity" });
  expect(screen.queryByText("Classified transactions")).not.toBeInTheDocument();
  expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument();
});
it("groups only exact routine automated run/single-family entries, leaving mixed and budget decisions individual", () => {
  const financial = financialEntry();
  const effect = financial.effect;
  if (!effect) throw new Error("Missing effect fixture");
  const groups = groupFinanceActivity([
    financial,
    { ...financial, id: "second" },
    {
      ...financial,
      id: "budget",
      effect: {
        ...effect,
        significance: "budget_decision",
        humanApproval: { actorId: "human", reviewId: "review" },
      },
    },
    {
      ...financial,
      id: "mixed",
      effect: { ...effect, actionFamilies: ["transaction", "category"] },
    },
    { ...financial, id: "manual", actor: { type: "user", id: "human" } },
    entry,
  ]);
  expect(groups.map((group) => group.entries.map((item) => item.id))).toEqual([
    ["entry", "second"],
    ["budget"],
    ["mixed"],
    ["manual"],
    ["entry"],
  ]);
});
it("keeps in-flight evidence isolated when the owner changes", async () => {
  const financial = financialEntry();
  let resolve!: (value: unknown) => void;
  const readEvidence = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = vi.fn().mockResolvedValue(page([financial]));
  const rendered = render(
    <MemoryRouter>
      <FinanceActivityPage ownerId="one" readActivity={first} readEvidence={readEvidence} />
    </MemoryRouter>,
  );
  await screen.findByText("Classified transactions");
  openActivity();
  fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
  fireEvent.click(screen.getByRole("button", { name: "Load more evidence" }));
  expect(toast.loading).toHaveBeenCalledWith("Loading more evidence…");
  expect(screen.queryByText("Loading more evidence…")).not.toBeInTheDocument();
  rendered.rerender(
    <MemoryRouter>
      <FinanceActivityPage
        ownerId="two"
        readActivity={vi.fn().mockResolvedValue(page([]))}
        readEvidence={readEvidence}
      />
    </MemoryRouter>,
  );
  await screen.findByText(/No recorded activity/);
  expect(toast.dismiss).toHaveBeenCalledWith("toast-id");
  resolve({
    entryId: financial.id,
    offset: 100,
    totalChanges: 101,
    nextCursor: null,
    changes: [],
    recordRefs: [],
    auditEventIds: [],
  });
  await waitFor(() =>
    expect(screen.queryByText("Classified transactions")).not.toBeInTheDocument(),
  );
});
it("shows current coverage constraints and opens grouped routine actions with keyboard disclosure", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const first = financialEntry();
  const value = page([first, { ...first, id: "second", action: "Second classification" }]);
  value.capabilities.financialActions = {
    state: "available",
    scope: "committed_candidate_effects",
  };
  value.coverage.reasons = ["committed_receipts_with_incomplete_evidence_not_projected"];
  render(view(vi.fn().mockResolvedValue(value)));
  const trigger = await screen.findByRole("button", { name: /^Open activity:/ });
  fireEvent.click(screen.getByRole("button", { name: "Partial history" }));
  expect(
    screen.getByText(/Includes applied changes with committed candidate receipts/),
  ).toBeVisible();
  expect(
    screen.getByText(/Some committed receipts have incomplete supporting evidence/),
  ).toBeVisible();
  expect(screen.queryByText(/Historical decisions without/)).not.toBeInTheDocument();
  expect(screen.queryByText("Second classification")).not.toBeInTheDocument();
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("dialog", { name: "Activity details" })).toBeVisible();
  expect(screen.getByText("Second classification")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("applies a complete bounded filter set and deduplicates overlapping action pages", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "cursor"))
    .mockResolvedValueOnce(page([entry], "filtered"))
    .mockResolvedValueOnce(
      page([entry, { ...entry, id: "another", action: "Another accepted answer" }]),
    );
  render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Activity filters" }));
  fireEvent.change(screen.getByLabelText("Event type"), {
    target: { value: "human_answer_decision" },
  });
  fireEvent.change(screen.getByLabelText("Record ID"), {
    target: { value: "11111111-1111-4111-8111-111111111111" },
  });
  fireEvent.change(screen.getByLabelText("Through (UTC)"), { target: { value: "2026-10-18" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled());
  expect(read.mock.calls[1]?.[0]).toEqual({
    limit: 50,
    type: "human_answer_decision",
    recordId: "11111111-1111-4111-8111-111111111111",
    through: "2026-10-18T23:59:59.999Z",
  });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Another accepted answer");
  expect(screen.getAllByText("Answer accepted")).toHaveLength(1);
});
it("ignores an expired owner's failed refresh and dismisses its loading toast", async () => {
  let reject!: (reason: Error) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce(page())
    .mockImplementationOnce(
      () =>
        new Promise<Page>((_resolve, fail) => {
          reject = fail;
        }),
    );
  const rendered = render(view(read));
  await screen.findByText(entry.explanation);
  fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
  rendered.rerender(view(vi.fn().mockResolvedValue(page([])), "next-owner"));
  await screen.findByText(/No recorded activity/);
  reject(new ApiClientError({ status: 403, code: "forbidden", message: "Expired owner" }));
  await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("toast-id"));
  expect(toast.error).not.toHaveBeenCalled();
  expect(screen.queryByText(entry.explanation)).not.toBeInTheDocument();
});
it("does not group missing run or effect provenance", () => {
  const financial = financialEntry();
  const { effect: _effect, ...withoutEffect } = financial;
  const values = [
    { ...financial, id: "no-run", runId: null },
    { ...withoutEffect, id: "no-effect" },
  ];
  expect(groupFinanceActivity(values).map((group) => group.entries.map((item) => item.id))).toEqual(
    [["no-run"], ["no-effect"]],
  );
});

it("pages with server cursors, goes back, and resets to the first page when size changes", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "second-page"))
    .mockResolvedValueOnce(page([{ ...entry, id: "second", action: "Second page" }]))
    .mockResolvedValueOnce(page([entry], "second-page"))
    .mockResolvedValueOnce(page([entry]));
  render(view(read));
  await screen.findByText(entry.action);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("Second page")).toBeVisible();
  expect(screen.queryByText(entry.action)).not.toBeInTheDocument();
  expect(screen.getByText("Page 2")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  await screen.findByText(entry.action);
  expect(read.mock.calls[2]?.[0]).toMatchObject({ limit: 50, cursor: undefined });
  fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "10" } });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  expect(read.mock.calls[3]?.[0]).toMatchObject({ limit: 10, cursor: undefined });
  expect(screen.getByText("Page 1")).toBeVisible();
});

it("keeps cursor navigation available when a subsequent page has no projected entries", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(page([entry], "empty-page"))
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([entry], "empty-page"));
  render(view(read));
  await screen.findByText(entry.action);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText(/No recorded activity matches/);
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(await screen.findByText(entry.action)).toBeVisible();
  expect(screen.getByText("Page 1")).toBeVisible();
});

it("attributes activity to the supplied account and keeps evidence attribution", async () => {
  const { agentAccountFixture } = await import("../../test-fixtures/agent-account");
  render(
    view(
      vi.fn().mockResolvedValue(
        page([
          {
            ...entry,
            actor: { type: "agent", id: "connection-actor" },
            agentAccount: agentAccountFixture,
          },
        ]),
      ),
    ),
  );
  expect((await screen.findAllByText("Cedar Fox")).length).toBeGreaterThan(0);
  openActivity();
  expect(screen.getByRole("dialog")).toHaveTextContent("Cedar Fox");
  expect(screen.getByRole("dialog")).toHaveTextContent("connection-actor");
});

it("fetches fresh profile attribution when returning from account settings for the same owner", async () => {
  const { agentAccountFixture } = await import("../../test-fixtures/agent-account");
  const read = vi.fn().mockResolvedValue(
    page([
      {
        ...entry,
        actor: { type: "agent", id: "recorded-actor" },
        agentAccount: agentAccountFixture,
      },
    ]),
  );
  const activity = render(view(read));
  expect((await screen.findAllByText("Cedar Fox")).length).toBeGreaterThan(0);
  activity.unmount();

  // A profile edit or relink in Settings changes the server projection, not the recorded actor.
  read.mockResolvedValue(
    page([
      {
        ...entry,
        actor: { type: "agent", id: "recorded-actor" },
        agentAccount: {
          ...agentAccountFixture,
          id: "relinked-account",
          displayName: "Updated Maple",
        },
      },
    ]),
  );
  render(view(read));
  expect((await screen.findAllByText("Updated Maple")).length).toBeGreaterThan(0);
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Cedar Fox")).not.toBeInTheDocument();
  openActivity();
  expect(screen.getByRole("dialog")).toHaveTextContent("Updated Maple");
  expect(screen.getByRole("dialog")).toHaveTextContent("recorded-actor");
});
