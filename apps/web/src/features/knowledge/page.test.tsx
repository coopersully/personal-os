// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgeRecord } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { renderWithFeedback } from "@/test-utils/feedback";
import { MemoryPage } from "./page";

vi.mock("@/api", () => ({
  api: {
    searchKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
    getKnowledgeHistory: vi.fn(),
    exportKnowledge: vi.fn(),
    updateKnowledge: vi.fn(),
    listActiveKnowledgeForgetOperations: vi.fn(),
    previewKnowledgeForget: vi.fn(),
    forgetKnowledge: vi.fn(),
    getKnowledgeForgetStatus: vi.fn(),
  },
}));

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const now = "2026-11-12T12:00:00.000Z";
const preference = (value: string): KnowledgeRecord["content"] => ({
  kind: "preference",
  value: {
    subject: "owner",
    key: "communication_style",
    value: { type: "string", value },
  },
});
const record: KnowledgeRecord = {
  id,
  author: { actorId: owner, actorType: "user" },
  requiredReadScopes: [],
  validFrom: null,
  validUntil: null,
  reviewAt: null,
  schemaVersion: 1,
  content: preference("concise"),
  scope: { workspace: null },
  sensitivity: "standard",
  purposes: ["planning"],
  confidence: 0,
  status: "active",
  revision: 3,
  sources: [],
  relatedRecordIds: [],
  createdAt: now,
  origin: "inferred",
  acceptance: { kind: "owner", actorId: owner, acceptedAt: now, evidenceIds: [] },
  claimKey: '[null,"preference","owner","communication_style"]',
  conflictRecordIds: [],
  evidenceAvailable: true,
  stale: false,
  supersededBy: null,
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: owner });
  const view = renderWithFeedback(<MemoryPage ownerId={owner} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, view };
}

async function openEditor() {
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  fireEvent.change(screen.getByLabelText("Value", { exact: true }), {
    target: { value: "detailed" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listActiveKnowledgeForgetOperations).mockResolvedValue([]);
  vi.mocked(api.searchKnowledge).mockResolvedValue({
    schemaVersion: 1,
    state: "available",
    epoch: 3,
    items: [record],
    nextCursor: null,
  });
  vi.mocked(api.getKnowledge).mockResolvedValue(record);
});

it("owner_can_correct_inferred_memory_and_forget_dependents", async () => {
  const latest: KnowledgeRecord = {
    ...record,
    revision: 4,
    content: {
      kind: "preference",
      value: {
        subject: "Travel profile",
        key: "communication_style",
        value: { type: "string", value: "concise" },
      },
    },
  };
  const corrected: KnowledgeRecord = {
    ...latest,
    revision: 5,
    origin: "stated",
    content: preference("detailed"),
    acceptance: { kind: "owner", actorId: owner, acceptedAt: now, evidenceIds: [] },
  };
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
    )
    .mockResolvedValue({ receiptId: id, recordId: id, outcome: "readable", record: corrected });
  vi.mocked(api.getKnowledge)
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce(latest)
    .mockResolvedValue(corrected);
  vi.mocked(api.getKnowledgeHistory).mockResolvedValue({
    schemaVersion: 1,
    state: "available",
    epoch: 5,
    items: [corrected, latest],
    nextCursor: null,
  });
  vi.mocked(api.previewKnowledgeForget).mockResolvedValue({
    previewId: id,
    ownerEpoch: 5,
    recordId: id,
    affected: [{ recordId: id, revision: 5 }],
    dependentCopyCount: 2,
    historyCount: 5,
    nextCursor: null,
  });
  vi.mocked(api.forgetKnowledge).mockResolvedValue({
    receiptId: operationId,
    recordId: id,
    outcome: "pending_erasure",
    operationId,
  });
  vi.mocked(api.getKnowledgeForgetStatus).mockResolvedValue({ operationId, status: "completed" });
  mount();
  expect(await screen.findByText("Inferred")).toBeVisible();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  expect(await screen.findByRole("button", { name: "Keep editing" })).toBeEnabled();
  expect(screen.getByText("Travel profile", { exact: true })).toBeVisible();
  expect(screen.getByText("Your submitted change")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Value", { exact: true })).toHaveValue("detailed");
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  const forget = await screen.findByRole("button", { name: "Preview forgetting" });
  expect(api.updateKnowledge).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 4 }),
  );
  const saved = await screen.findByText("Memory saved.");
  expect(saved.closest("[data-sonner-toast]")).not.toBeNull();
  expect(screen.getAllByText("Memory saved.")).toEqual([saved]);
  const detail = screen.getByRole("dialog", { name: "Communication style" });
  expect(within(detail).getByText("Stated", { exact: true })).toBeVisible();
  fireEvent.click(within(detail).getByRole("button", { name: "Show history" }));
  const history = await within(detail).findByRole("region", { name: "Revision history" });
  expect(await within(history).findByText("Inferred", { exact: true })).toBeVisible();
  expect(within(history).getAllByText("Accepted by you")).toHaveLength(2);
  fireEvent.click(forget);
  expect(await screen.findByText("2 dependent copies")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Forget permanently" }));
  const forgotten = await screen.findByText("Memory forgotten.");
  expect(forgotten.closest("[data-sonner-toast]")).not.toBeNull();
  expect(screen.getAllByText("Memory forgotten.")).toEqual([forgotten]);
});

it("late_save_after_logout_cannot_restore_memory", async () => {
  let finish!: () => void;
  vi.mocked(api.updateKnowledge).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ receiptId: id, recordId: id, outcome: "readable", record });
      }),
  );
  const { client, view } = mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await waitFor(() => expect(api.updateKnowledge).toHaveBeenCalledOnce());
  vi.mocked(api.searchKnowledge).mockResolvedValue({
    schemaVersion: 1,
    state: "available",
    epoch: 0,
    items: [],
    nextCursor: null,
  });
  await act(async () => {
    client.clear();
    client.setQueryData(["me"], { id: id });
    view.rerender(<MemoryPage ownerId={id} />);
    finish();
  });
  expect(await screen.findByText("No matching memory")).toBeVisible();
  expect(screen.queryByText("Memory saved.")).not.toBeInTheDocument();
  expect(screen.queryByText("Inferred")).not.toBeInTheDocument();
  expect(client.getQueryCache().findAll({ queryKey: ["memory", owner] })).toHaveLength(0);
});

it("drops a late save and its toast after leaving Memory", async () => {
  let finish!: () => void;
  vi.mocked(api.updateKnowledge).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ receiptId: id, recordId: id, outcome: "readable", record });
      }),
  );
  const { client, view } = mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await waitFor(() => expect(api.updateKnowledge).toHaveBeenCalledOnce());
  view.rerender(<p>Other settings</p>);
  await act(async () => finish());
  expect(screen.getByText("Other settings")).toBeVisible();
  expect(screen.queryByText("Memory saved.")).not.toBeInTheDocument();
  expect(client.getQueryCache().findAll({ queryKey: ["memory", owner] })).toHaveLength(0);
});

function fencedError() {
  return new ApiClientError({
    status: 503,
    code: "service_unavailable",
    message: "Memory is unavailable while forgetting is in progress.",
    details: { reason: "knowledge_erasure_pending" },
  });
}

it("hides private content immediately after a fenced detail response, before discovery resolves", async () => {
  vi.mocked(api.listActiveKnowledgeForgetOperations)
    .mockResolvedValueOnce([])
    .mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.getKnowledge).mockRejectedValue(fencedError());
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  await waitFor(() => expect(api.listActiveKnowledgeForgetOperations).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("button", { name: /Communication style.*concise/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download memory" })).not.toBeInTheDocument();
  expect(screen.queryByText("Inferred")).not.toBeInTheDocument();
});

it("drops a delayed export response after learning of an admitted erasure", async () => {
  let finish!: () => void;
  vi.mocked(api.exportKnowledge).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            schemaVersion: 1,
            items: [record],
            epoch: 3,
            state: "available",
            nextCursor: null,
          });
      }),
  );
  vi.mocked(api.getKnowledge).mockRejectedValue(fencedError());
  vi.mocked(api.listActiveKnowledgeForgetOperations)
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ operationId, status: "blocked" }]);
  vi.mocked(api.getKnowledgeForgetStatus).mockResolvedValue({ operationId, status: "blocked" });
  const exportFile = vi.fn(() => "blob:memory");
  const original = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: exportFile });
  try {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Download memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(api.exportKnowledge).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: /Communication style.*concise/i }));
    expect(await screen.findByRole("button", { name: "Retry erasure" })).toBeVisible();
    await act(async () => finish());
    expect(exportFile).not.toHaveBeenCalled();
    expect(screen.queryByText("Memory download started.")).not.toBeInTheDocument();
  } finally {
    if (original) Object.defineProperty(URL, "createObjectURL", original);
    else Reflect.deleteProperty(URL, "createObjectURL");
  }
});

it("keeps an overdue active record out of the Accepted request and requests all review candidates", async () => {
  mount();
  expect(await screen.findByRole("tab", { name: "Accepted" })).toBeVisible();
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenCalledWith({
      purpose: "planning",
      reviewView: "accepted",
    }),
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Needs review" }), {
    button: 0,
    ctrlKey: false,
  });
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenLastCalledWith({
      purpose: "planning",
      reviewView: "needs_review",
    }),
  );
});

it("prefers a fresh same-revision projection and clears the selected detail on a newer epoch", async () => {
  const source = (wording: string): KnowledgeRecord["sources"] => [
    {
      id: operationId,
      classification: "owner_statement",
      actorId: owner,
      actorType: "user",
      evidence: { type: "statement", wording },
    },
  ];
  const updated = { ...record, revision: 4, sources: source("Previous source projection") };
  const fresh = { ...updated, sources: source("Current source projection") };
  vi.mocked(api.updateKnowledge).mockResolvedValue({
    receiptId: id,
    recordId: id,
    outcome: "readable",
    record: updated,
  });
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(record).mockResolvedValue(fresh);
  const { client } = mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(await screen.findByText("Current source projection")).toBeVisible();
  expect(screen.queryByText("Previous source projection")).not.toBeInTheDocument();
  vi.mocked(api.searchKnowledge).mockResolvedValue({
    schemaVersion: 1,
    items: [fresh],
    epoch: 5,
    state: "available",
    nextCursor: null,
  });
  await act(async () => {
    await client.refetchQueries({
      predicate: (query) => query.queryKey.includes("list") && query.isActive(),
    });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Current source projection")).not.toBeInTheDocument();
});

it("shows both restriction choices and preserves a narrower draft after concurrent restriction", async () => {
  const before: KnowledgeRecord = { ...record, purposes: ["planning", "review", "communication"] };
  const latest: KnowledgeRecord = {
    ...before,
    revision: 4,
    purposes: ["planning", "review"],
    sensitivity: "sensitive",
  };
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(before).mockResolvedValue(latest);
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
    )
    .mockResolvedValue({ receiptId: id, recordId: id, outcome: "readable", record: latest });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Restrict use" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Save restrictions" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  const keep = await screen.findByRole("button", { name: "Keep editing restrictions" });
  expect(
    within(screen.getByRole("region", { name: "Current claim" })).getByText("Only you"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Submitted change" })).getByText(
      "Planning, Communication",
    ),
  ).toBeVisible();
  fireEvent.click(keep);
  expect(screen.getByRole("checkbox", { name: "Review" })).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Communication" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save restrictions" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        restrictions: {
          scope: { workspace: null },
          purposes: ["planning"],
          sensitivity: "sensitive",
        },
      }),
    ),
  );
});

it("leaves an untouched generated inference out of the revise path", async () => {
  const generated: KnowledgeRecord = {
    ...record,
    content: {
      kind: "inference",
      value: {
        subject: "owner",
        proposition: JSON.stringify(record.content),
        uncertainty: "Tentative",
        evidenceIds: [],
        reviewCondition: "Owner review",
      },
    },
  };
  vi.mocked(api.getKnowledge).mockResolvedValue(generated);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  expect(screen.getByRole("button", { name: "Save memory" })).toBeDisabled();
  expect(api.updateKnowledge).not.toHaveBeenCalled();
});

function invalidCursor() {
  return new ApiClientError({ status: 409, code: "conflict", message: "The cursor changed." });
}

function heldErasureDiscovery() {
  let release!: () => void;
  const response = new Promise<[]>((resolve) => {
    release = () => resolve([]);
  });
  vi.mocked(api.listActiveKnowledgeForgetOperations)
    .mockResolvedValueOnce([])
    .mockReturnValueOnce(response);
  return release;
}

it("drops previously disclosed rows before restarting a rejected list cursor", async () => {
  const release = heldErasureDiscovery();
  const page = { schemaVersion: 1, state: "available" } as const;
  vi.mocked(api.searchKnowledge)
    .mockResolvedValueOnce({ ...page, items: [record], epoch: 3, nextCursor: "old-list" })
    .mockRejectedValueOnce(invalidCursor())
    .mockResolvedValue({ ...page, items: [], epoch: 4, nextCursor: null });
  mount();
  expect(
    await screen.findByRole("button", { name: /Communication style.*concise/i }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more memories" }));
  await waitFor(() => expect(api.listActiveKnowledgeForgetOperations).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Inferred")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download memory" })).not.toBeInTheDocument();
  expect(api.searchKnowledge).toHaveBeenCalledTimes(2);
  await act(async () => release());
  expect(await screen.findByText("No matching memory")).toBeVisible();
  expect(api.searchKnowledge).toHaveBeenLastCalledWith({
    purpose: "planning",
    reviewView: "accepted",
  });
});

it("clears disclosed revision sources when a restriction invalidates the next history page", async () => {
  const release = heldErasureDiscovery();
  const revision: KnowledgeRecord = {
    ...record,
    sources: [
      {
        id: operationId,
        actorId: owner,
        actorType: "user",
        classification: "owner_statement",
        evidence: { type: "statement", wording: "Former revision source" },
      },
    ],
  };
  vi.mocked(api.getKnowledgeHistory)
    .mockResolvedValueOnce({
      schemaVersion: 1,
      items: [revision],
      epoch: 3,
      state: "available",
      nextCursor: "old-history",
    })
    .mockRejectedValueOnce(invalidCursor());
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Show history" }));
  fireEvent.click(await screen.findByText("Sources for revision 3"));
  expect(screen.getByText("Former revision source")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more revisions" }));
  await waitFor(() => expect(api.listActiveKnowledgeForgetOperations).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Former revision source")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => release());
  expect(
    await screen.findByRole("button", { name: /Communication style.*concise/i }),
  ).toBeVisible();
  expect(api.getKnowledgeHistory).toHaveBeenCalledTimes(2);
});

it("reopens an ordinary superseded predecessor from All memory", async () => {
  const predecessor: KnowledgeRecord = {
    ...record,
    status: "superseded",
    revision: 4,
    supersededBy: operationId,
    conflictRecordIds: [],
  };
  vi.mocked(api.searchKnowledge).mockImplementation(async (input) => ({
    schemaVersion: 1,
    epoch: 4,
    state: "available",
    nextCursor: null,
    items: !input.reviewView && !input.hasConflict ? [predecessor] : [],
  }));
  vi.mocked(api.getKnowledge).mockResolvedValue(predecessor);
  mount();
  expect(await screen.findByText("No matching memory")).toBeVisible();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "All memory" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(await screen.findByLabelText("Status"), { target: { value: "superseded" } });
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenLastCalledWith({
      purpose: "planning",
      status: "superseded",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*Superseded/i }));
  const preview = await screen.findByRole("button", { name: "Preview forgetting" });
  await waitFor(() => expect(preview).toBeEnabled());
});

it("revalidates disclosures and resets the download after an export cursor conflict", async () => {
  const release = heldErasureDiscovery();
  vi.mocked(api.exportKnowledge)
    .mockResolvedValueOnce({
      schemaVersion: 1,
      items: [record],
      state: "available",
      epoch: 3,
      nextCursor: "old-export",
    })
    .mockRejectedValueOnce(invalidCursor());
  const create = vi.fn(() => "blob:memory");
  const revoke = vi.fn();
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: create },
    revokeObjectURL: { configurable: true, value: revoke },
  });
  try {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Download memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(api.listActiveKnowledgeForgetOperations).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Inferred")).not.toBeInTheDocument();
    expect(api.exportKnowledge).toHaveBeenLastCalledWith({ cursor: "old-export" });
    expect(create).toHaveBeenCalledOnce();
    await act(async () => release());
    expect(await screen.findByRole("button", { name: "Download memory" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download next page" })).not.toBeInTheDocument();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:memory"), { timeout: 1500 });
  } finally {
    anchorClick.mockRestore();
    if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});
