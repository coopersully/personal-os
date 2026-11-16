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
  ownerHeld: true,
  agentAccess: "allowed",
  core: false,
  tags: ["communication"],
  lastConfirmedAt: null,
  supersededBy: null,
  trashedAt: null,
  trashGroupId: null,
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
  vi.mocked(api.searchKnowledge).mockResolvedValue({
    schemaVersion: 1,
    state: "available",
    epoch: 3,
    items: [record],
    nextCursor: null,
  });
  vi.mocked(api.getKnowledge).mockResolvedValue(record);
});

it("owner_can_correct_inferred_memory", async () => {
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
  await waitFor(() => expect(api.updateKnowledge).toHaveBeenCalledTimes(2));
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
});

it("revises tags from the editor without changing content", async () => {
  vi.mocked(api.updateKnowledge).mockResolvedValue({
    receiptId: id,
    recordId: id,
    outcome: "readable",
    record: { ...record, revision: 4, tags: ["communication", "family"] },
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  const tags = screen.getByLabelText("Tags", { exact: true });
  expect(tags).toHaveValue("communication");
  fireEvent.change(tags, { target: { value: "!!!" } });
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(await screen.findByText("Enter 1 to 8 tags, separated by commas.")).toBeVisible();
  expect(api.updateKnowledge).not.toHaveBeenCalled();
  fireEvent.change(tags, { target: { value: "Communication, Family" } });
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await waitFor(() => expect(api.updateKnowledge).toHaveBeenCalledOnce());
  expect(api.updateKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "revise",
      content: preference("concise"),
      tags: ["communication", "family"],
    }),
  );
});

it("treats a deleted memory as no longer available", async () => {
  vi.mocked(api.getKnowledge).mockResolvedValue({
    id,
    state: "forgotten",
    trashedAt: now,
    purgedAt: now,
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  const detail = await screen.findByRole("dialog", { name: "Memory details" });
  await waitFor(() => expect(within(detail).queryByText("Inferred")).not.toBeInTheDocument());
  expect(within(detail).queryByRole("button", { name: "Edit memory" })).not.toBeInTheDocument();
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

it("narrows the workspace and preserves the draft after a concurrent change", async () => {
  const before: KnowledgeRecord = record;
  const latest: KnowledgeRecord = { ...before, revision: 4, sensitivity: "sensitive" };
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(before).mockResolvedValue(latest);
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
    )
    .mockResolvedValue({ receiptId: id, recordId: id, outcome: "readable", record: latest });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*concise/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Restrict use" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), {
    target: { value: "tasks" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save restrictions" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  const keep = await screen.findByRole("button", { name: "Keep editing restrictions" });
  expect(
    within(screen.getByRole("region", { name: "Current claim" })).getByText("Sensitive"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Submitted change" })).getByText("Tasks"),
  ).toBeVisible();
  fireEvent.click(keep);
  expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveValue("tasks");
  fireEvent.click(screen.getByRole("button", { name: "Save restrictions" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "restrict", expectedRevision: 4, workspace: "tasks" }),
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

it("drops previously disclosed rows before restarting a rejected list cursor", async () => {
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
  expect(await screen.findByText("No matching memory")).toBeVisible();
  expect(screen.queryByText("Inferred")).not.toBeInTheDocument();
  const notice = await screen.findByText(
    "This memory page expired or changed. Reloading saved memory.",
  );
  expect(notice.closest("[data-sonner-toast]")).not.toBeNull();
  expect(api.searchKnowledge).toHaveBeenCalledTimes(3);
  expect(api.searchKnowledge).toHaveBeenLastCalledWith({
    purpose: "planning",
    reviewView: "accepted",
  });
});

it("clears disclosed revision sources when a restriction invalidates the next history page", async () => {
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
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Former revision source")).not.toBeInTheDocument();
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
  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  expect(await within(detail).findByRole("button", { name: "Show history" })).toBeEnabled();
  expect(within(detail).queryByRole("button", { name: "Edit memory" })).not.toBeInTheDocument();
});

it("revalidates disclosures and resets the download after an export cursor conflict", async () => {
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
    expect(await screen.findByRole("button", { name: "Download memory" })).toBeVisible();
    expect(api.exportKnowledge).toHaveBeenLastCalledWith({ cursor: "old-export" });
    expect(create).toHaveBeenCalledOnce();
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
