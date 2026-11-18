// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgeRecord, KnowledgeTagIndex } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { renderWithFeedback } from "@/test-utils/feedback";
import { MemoryPage } from "./page";

vi.mock("@/api", () => ({
  api: {
    searchKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
    getKnowledgeHistory: vi.fn(),
    exportKnowledge: vi.fn(),
    saveKnowledge: vi.fn(),
    updateKnowledge: vi.fn(),
    listKnowledgeTags: vi.fn(),
    mergeKnowledgeTags: vi.fn(),
    unmergeKnowledgeTags: vi.fn(),
  },
}));

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";
const linkedId = "55555555-5555-4555-8555-555555555555";
const childId = "66666666-6666-4666-8666-666666666666";
const agentId = "77777777-7777-4777-8777-777777777777";
const mergeId = "88888888-8888-4888-8888-888888888888";
const laterMergeId = "99999999-9999-4999-8999-999999999999";
const now = "2026-11-12T12:00:00.000Z";
const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);
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
  purposes: [],
  confidence: 0.83,
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
  trashVersion: 0,
};
const page = (
  items: KnowledgeRecord[],
  extra: Partial<{ epoch: number; nextCursor: string }> = {},
) =>
  ({
    schemaVersion: 1,
    state: "available",
    epoch: extra.epoch ?? 3,
    items,
    nextCursor: extra.nextCursor ?? null,
  }) as const;
const tagIndex: KnowledgeTagIndex = {
  tags: [
    { name: "family", count: 2 },
    { name: "communication", count: 1 },
  ],
  aliases: [],
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

const rowName = /Communication style.*concise/i;

async function openRecord(name: RegExp = rowName) {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name: "Communication style" });
}

async function openEditor() {
  await openRecord();
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  fireEvent.change(screen.getByLabelText("Value", { exact: true }), {
    target: { value: "detailed" },
  });
}

function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}

/** The message is a Sonner toast, and nothing else on the page repeats it inline. */
async function expectToastOnly(message: string) {
  const shown = await screen.findByText(message);
  expect(shown.closest("[data-sonner-toast]")).not.toBeNull();
  expect(screen.getAllByText(message)).toEqual([shown]);
  return shown;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function readable(next: KnowledgeRecord) {
  return { receiptId: operationId, recordId: next.id, outcome: "readable" as const, record: next };
}

function conflict(details?: unknown) {
  return new ApiClientError({ status: 409, code: "conflict", message: "Changed", details });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([record]));
  vi.mocked(api.getKnowledge).mockResolvedValue(record);
  vi.mocked(api.listKnowledgeTags).mockResolvedValue(tagIndex);
  vi.mocked(api.getKnowledgeHistory).mockResolvedValue(page([record]));
});

afterEach(() => {
  vi.useRealTimers();
});

it("lists_tabs_all_conflicts_archived_trash", async () => {
  mount();
  const all = await screen.findByRole("tab", { name: "All" });
  expect(all).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenCalledWith({}));
  selectTab("Conflicts");
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ hasConflict: true }));
  selectTab("Archived");
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ status: "archived" }));
  selectTab("Trash");
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ status: "trashed" }));
  selectTab("All");
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({}));
});

it("filters_by_tag_chip", async () => {
  mount();
  const chips = await screen.findByRole("group", { name: "Filter by tag" });
  const family = await within(chips).findByRole("button", { name: "family", pressed: false });
  fireEvent.click(family);
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ tags: ["family"] }));
  expect(within(chips).getByRole("button", { name: "family" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(within(chips).getByRole("button", { name: "communication" }));
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenLastCalledWith({ tags: ["family", "communication"] }),
  );
  fireEvent.click(within(chips).getByRole("button", { name: "family" }));
  fireEvent.click(within(chips).getByRole("button", { name: "communication" }));
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({}));

  fireEvent.change(screen.getByLabelText("Origin"), { target: { value: "inferred" } });
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ origin: "inferred" }));
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "fact" } });
  fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "mail" } });
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenLastCalledWith({
      origin: "inferred",
      kind: "fact",
      workspace: "mail",
    }),
  );
  fireEvent.change(screen.getByLabelText("Origin"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Search memory"), { target: { value: "  morning  " } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({ text: "morning" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await waitFor(() => expect(api.searchKnowledge).toHaveBeenLastCalledWith({}));
  expect(screen.getByLabelText("Search memory")).toHaveValue("");
});

it("shows_stated_inferred_and_sensitive_labels", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T12:00:00.000Z") });
  const stated: KnowledgeRecord = {
    ...record,
    id: linkedId,
    origin: "stated",
    content: {
      kind: "fact",
      value: {
        subject: "owner",
        predicate: "home_city",
        value: { type: "string", value: "Austin" },
      },
    },
    claimKey: null,
    tags: ["home"],
  };
  const inferred: KnowledgeRecord = {
    ...record,
    sensitivity: "sensitive",
    core: true,
    agentAccess: "blocked",
    author: { actorId: agentId, actorType: "agent" },
    ownerHeld: false,
  };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([stated, inferred]));
  vi.mocked(api.getKnowledge).mockResolvedValue(inferred);
  mount();
  const statedRow = await screen.findByRole("button", { name: /Home city.*Austin/i });
  expect(within(statedRow).getByText("Stated", { exact: true })).toBeVisible();
  expect(within(statedRow).queryByText("Sensitive")).not.toBeInTheDocument();
  expect(within(statedRow).getByText("home", { exact: true })).toBeVisible();
  const inferredRow = screen.getByRole("button", { name: rowName });
  expect(within(inferredRow).getByText("Inferred", { exact: true })).toBeVisible();
  expect(within(inferredRow).getByText("Sensitive", { exact: true })).toBeVisible();
  expect(within(inferredRow).getByText("Core", { exact: true })).toBeVisible();
  expect(within(inferredRow).getByText("Hidden from agents", { exact: true })).toBeVisible();
  expect(within(inferredRow).getByText("Updated 3 days ago")).toBeVisible();

  const detail = await openRecord();
  expect(await within(detail).findByText("Inferred", { exact: true })).toBeVisible();
  expect(within(detail).getByText("Sensitive", { exact: true })).toBeVisible();
  expect(within(detail).getByText(`Agent ${agentId}`)).toBeVisible();
  expect(within(detail).getByText("All workspaces")).toBeVisible();
  expect(within(detail).getByText("All uses")).toBeVisible();
  expect(document.body.textContent).not.toMatch(/%/);
  expect(document.body.textContent).not.toMatch(/confidence/i);
});

it("resolve_conflict_keep_mine_and_take_agents", async () => {
  const mine: KnowledgeRecord = { ...record, conflictRecordIds: [proposalId] };
  const proposal: KnowledgeRecord = {
    ...record,
    id: proposalId,
    revision: 1,
    status: "proposed",
    content: preference("detailed"),
    author: { actorId: agentId, actorType: "agent" },
    ownerHeld: false,
    acceptance: null,
    conflictRecordIds: [id],
  };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([mine, proposal]));
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) =>
    requested === proposalId ? proposal : mine,
  );
  vi.mocked(api.updateKnowledge)
    .mockResolvedValueOnce(readable({ ...proposal, status: "superseded", revision: 2 }))
    .mockResolvedValueOnce(readable({ ...proposal, status: "active", revision: 2 }));
  mount();
  selectTab("Conflicts");
  const proposalRow = await screen.findByRole("button", { name: /Agent proposal/ });
  fireEvent.click(proposalRow);
  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  const panel = await within(detail).findByRole("region", { name: "Conflict" });
  expect(await within(panel).findByText("concise")).toBeVisible();
  expect(within(panel).getByText("detailed")).toBeVisible();
  for (const name of ["Confirm memory", "Dispute memory", "Edit memory", "Archive"])
    expect(within(detail).queryByRole("button", { name })).not.toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", { name: "Keep mine" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenCalledWith({
      action: "resolve_conflict",
      recordId: proposalId,
      expectedRevision: 1,
      keep: "current",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Kept your version.");

  fireEvent.click(
    await screen.findByRole("button", { name: /Communication style.*concise.*Conflict/i }),
  );
  const original = await screen.findByRole("dialog", { name: "Communication style" });
  const originalPanel = await within(original).findByRole("region", { name: "Conflict" });
  fireEvent.click(await within(originalPanel).findByRole("button", { name: "Take the agent's" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith({
      action: "resolve_conflict",
      recordId: proposalId,
      expectedRevision: 1,
      keep: "proposed",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Took the agent's version.");
  const [first, second] = vi.mocked(api.updateKnowledge).mock.calls;
  expect(first?.[0].mutationKey).not.toBe(second?.[0].mutationKey);
});

it("edit_and_keep_mine_resolves_then_edits_from_the_agents_proposal", async () => {
  const mine: KnowledgeRecord = { ...record, conflictRecordIds: [proposalId] };
  const proposal: KnowledgeRecord = {
    ...record,
    id: proposalId,
    revision: 1,
    status: "proposed",
    content: preference("detailed"),
    conflictRecordIds: [id],
  };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([proposal]));
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) =>
    requested === proposalId ? proposal : mine,
  );
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(conflict())
    .mockResolvedValueOnce(readable({ ...proposal, status: "superseded", revision: 2 }))
    .mockResolvedValueOnce(readable({ ...mine, revision: 4, content: preference("detailed") }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Agent proposal/ }));
  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  const panel = await within(detail).findByRole("region", { name: "Conflict" });
  const editKeepingMine = await within(panel).findByRole("button", {
    name: "Edit and keep mine",
  });
  // A refused resolution opens nothing, so the proposal is never left pending behind an editor.
  fireEvent.click(editKeepingMine);
  await expectToastOnly("This memory changed. Review the latest version.");
  expect(screen.queryByRole("dialog", { name: "Edit memory" })).not.toBeInTheDocument();
  fireEvent.click(
    await within(
      await within(await screen.findByRole("dialog")).findByRole("region", { name: "Conflict" }),
    ).findByRole("button", { name: "Edit and keep mine" }),
  );
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith({
      action: "resolve_conflict",
      recordId: proposalId,
      expectedRevision: 1,
      keep: "current",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Kept your version. Edit it with the agent's proposal.");
  const editor = await screen.findByRole("dialog", { name: "Edit memory" });
  expect(within(editor).getByLabelText("Value", { exact: true })).toHaveValue("detailed");
  fireEvent.click(within(editor).getByRole("button", { name: "Save memory" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "revise",
        recordId: id,
        expectedRevision: 3,
        content: preference("detailed"),
      }),
    ),
  );
  await expectToastOnly("Memory saved.");
});

it("compares two plain conflicting claims without offering a resolution", async () => {
  const mine: KnowledgeRecord = { ...record, conflictRecordIds: [linkedId] };
  const rival: KnowledgeRecord = {
    ...record,
    id: linkedId,
    origin: "stated",
    content: preference("brief"),
    conflictRecordIds: [id],
  };
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) =>
    requested === linkedId ? rival : mine,
  );
  mount();
  const detail = await openRecord();
  const panel = await within(detail).findByRole("region", { name: "Conflict" });
  expect(await within(panel).findByText("brief")).toBeVisible();
  expect(within(panel).queryByRole("button", { name: "Keep mine" })).not.toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", { name: "Open conflicting memory 1" }));
  const opened = await within(await screen.findByRole("dialog")).findByText("This memory");
  await waitFor(() =>
    expect(within(opened.parentElement as HTMLElement).getByText("brief")).toBeVisible(),
  );
});

it("trash_confirmation_states_backup_and_agent_limits_and_lists_linked", async () => {
  const linking: KnowledgeRecord = {
    ...record,
    relatedRecordIds: [linkedId, childId, operationId],
  };
  const linked: KnowledgeRecord = {
    ...record,
    id: linkedId,
    content: {
      kind: "relationship",
      value: {
        subjectId: id,
        objectId: operationId,
        relationship: "Partner",
        direction: "directed",
      },
    },
    claimKey: null,
  };
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) => {
    if (requested === linkedId) return linked;
    if (requested === childId)
      return { id: childId, state: "forgotten", trashedAt: now, purgedAt: now };
    if (requested === operationId)
      throw new ApiClientError({ status: 404, code: "not_found", message: "Gone" });
    return linking;
  });
  vi.mocked(api.updateKnowledge).mockResolvedValue({
    receiptId: operationId,
    recordId: id,
    outcome: "trashed",
  });
  mount();
  const detail = await openRecord();
  fireEvent.click(await within(detail).findByRole("button", { name: "Move to Trash" }));
  const confirmation = await screen.findByRole("dialog", { name: "Move to Trash?" });
  expect(
    within(confirmation).getByText(/Older backups may still contain this until they're deleted/),
  ).toBeVisible();
  expect(
    within(confirmation).getByText(/Agents that already read it may remember it/),
  ).toBeVisible();
  const links = within(confirmation).getByRole("region", { name: "Memories this one links to" });
  expect(await within(links).findByText("Partner")).toBeVisible();
  expect(await within(links).findByText("A deleted memory")).toBeVisible();
  expect(await within(links).findByText("A memory you can't open")).toBeVisible();
  expect(within(links).queryByText("Communication style")).not.toBeInTheDocument();
  // Backlinks have no API yet (COO-268); the list must not read as complete.
  expect(
    within(links).getByText(/Memories that link to this one aren't listed here yet/),
  ).toBeVisible();
  expect(api.searchKnowledge).not.toHaveBeenCalledWith(
    expect.objectContaining({ entityRefs: expect.anything() }),
  );
  fireEvent.click(within(confirmation).getByRole("button", { name: "Move to Trash" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenCalledWith({
      action: "trash",
      recordId: id,
      expectedRevision: 3,
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Memory moved to Trash.");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("says when nothing links to a memory before trashing it, and can cancel", async () => {
  mount();
  const detail = await openRecord();
  fireEvent.click(await within(detail).findByRole("button", { name: "Move to Trash" }));
  const confirmation = await screen.findByRole("dialog", { name: "Move to Trash?" });
  expect(
    await within(confirmation).findByText("This memory doesn't link to other memories."),
  ).toBeVisible();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("dialog", { name: "Communication style" })).toBeVisible();
  expect(api.updateKnowledge).not.toHaveBeenCalled();
});

it("restore_and_delete_now_from_trash", async () => {
  const root: KnowledgeRecord = {
    ...record,
    trashedAt: now,
    trashGroupId: id,
    trashVersion: 2,
  };
  const child: KnowledgeRecord = {
    ...record,
    id: childId,
    content: preference("derived"),
    trashedAt: now,
    trashGroupId: id,
    trashVersion: 2,
  };
  const refreshed = { ...root, trashVersion: 3 };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([root, child]));
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(root).mockResolvedValue(refreshed);
  vi.mocked(api.updateKnowledge)
    .mockResolvedValueOnce(readable({ ...record, trashVersion: 3 }))
    .mockRejectedValueOnce(conflict({ trashVersion: 3, trashedAt: now }))
    .mockResolvedValueOnce({ receiptId: operationId, recordId: id, outcome: "forgotten" });
  mount();
  selectTab("Trash");
  // Rows are found again after each refresh, which replaces the list.
  const trashRow = async (text: string) => {
    await screen.findByText(text);
    const row = screen.getAllByRole("listitem").find((item) => within(item).queryByText(text));
    if (!row) throw new Error(`Expected a trashed row for ${text}.`);
    return row;
  };
  const rootRow = await trashRow("concise");
  const childRow = await trashRow("derived");
  expect(within(childRow).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  expect(within(childRow).queryByRole("button", { name: "Delete now" })).not.toBeInTheDocument();
  expect(within(childRow).getByText(/Restores with the memory it was trashed with/)).toBeVisible();
  expect(within(rootRow).getByText(/Deleted for good in \d+ days?/)).toBeVisible();

  fireEvent.click(within(rootRow).getByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenCalledWith({
      action: "restore",
      recordId: id,
      expectedRevision: 3,
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Memory restored.");

  fireEvent.click(within(await trashRow("concise")).getByRole("button", { name: "Delete now" }));
  const confirmation = await screen.findByRole("dialog", { name: "Delete now?" });
  expect(within(confirmation).getByText(/can't be restored/)).toBeVisible();
  expect(
    within(confirmation).getByText(/Older backups may still contain this until they're deleted/),
  ).toBeVisible();
  // Delete now waits for the owner's read, which carries the Trash version it confirms.
  const confirmDelete = within(confirmation).getByRole("button", { name: "Delete now" });
  await waitFor(() => expect(confirmDelete).toBeEnabled());
  fireEvent.click(confirmDelete);
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith({
      action: "delete_now",
      recordId: id,
      expectedRevision: 3,
      expectedTrashVersion: 2,
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("This memory's Trash state changed. Review it before deleting.");
  expect(api.updateKnowledge).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(api.getKnowledge).toHaveBeenCalledTimes(2));

  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  fireEvent.click(await within(detail).findByRole("button", { name: "Delete now" }));
  const again = await screen.findByRole("dialog", { name: "Delete now?" });
  fireEvent.click(within(again).getByRole("button", { name: "Delete now" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "delete_now", expectedTrashVersion: 3 }),
    ),
  );
  await expectToastOnly("Memory deleted.");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("opens a trashed record that moved with another and offers its group root", async () => {
  const child: KnowledgeRecord = {
    ...record,
    id: childId,
    content: preference("derived"),
    trashedAt: now,
    trashGroupId: id,
    trashVersion: 1,
  };
  const root: KnowledgeRecord = { ...record, trashedAt: now, trashGroupId: id, trashVersion: 1 };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([child]));
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) =>
    requested === childId ? child : root,
  );
  vi.mocked(api.updateKnowledge).mockRejectedValue(conflict());
  mount();
  selectTab("Trash");
  fireEvent.click(await screen.findByRole("button", { name: /Communication style.*derived/i }));
  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  expect(await within(detail).findByText(/moved to Trash with another memory/)).toBeVisible();
  for (const name of ["Restore", "Delete now", "Edit memory", "Move to Trash"])
    expect(within(detail).queryByRole("button", { name })).not.toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: "Open the memory it moved with" }));
  await waitFor(() => expect(api.getKnowledge).toHaveBeenLastCalledWith({ id }));
  fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
  await expectToastOnly("This memory couldn't be restored. Review Trash and try again.");
});

it("toggles_core_and_agent_access", async () => {
  const cored = { ...record, revision: 4, core: true };
  const blocked = { ...cored, revision: 5, agentAccess: "blocked" as const };
  const sensitive = { ...blocked, revision: 6, sensitivity: "sensitive" as const };
  const standard = { ...sensitive, revision: 7, sensitivity: "standard" as const };
  vi.mocked(api.updateKnowledge)
    .mockResolvedValueOnce(readable(cored))
    .mockResolvedValueOnce(readable(blocked))
    .mockResolvedValueOnce(readable(sensitive))
    .mockResolvedValueOnce(readable(standard));
  vi.mocked(api.getKnowledge)
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce(cored)
    .mockResolvedValueOnce(blocked)
    .mockResolvedValueOnce(sensitive)
    .mockResolvedValue(standard);
  mount();
  const detail = await openRecord();
  const core = await within(detail).findByRole("switch", { name: "Load at session start" });
  expect(core).not.toBeChecked();
  fireEvent.click(core);
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenCalledWith({
      action: "revise",
      recordId: id,
      expectedRevision: 3,
      content: record.content,
      core: true,
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Memory will load at session start.");
  await waitFor(() =>
    expect(within(detail).getByRole("switch", { name: "Load at session start" })).toBeChecked(),
  );

  const access = within(detail).getByRole("switch", { name: "Agents can read this" });
  expect(access).toBeChecked();
  fireEvent.click(access);
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith({
      action: "set_access",
      recordId: id,
      expectedRevision: 4,
      agentAccess: "blocked",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Memory hidden from agents.");

  await waitFor(() =>
    expect(within(detail).getByRole("switch", { name: "Agents can read this" })).not.toBeChecked(),
  );
  fireEvent.click(within(detail).getByRole("switch", { name: "Sensitive memory" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith({
      action: "set_sensitivity",
      recordId: id,
      expectedRevision: 5,
      sensitivity: "sensitive",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Memory marked sensitive.");
  await waitFor(() =>
    expect(within(detail).getByRole("switch", { name: "Sensitive memory" })).toBeChecked(),
  );
  fireEvent.click(within(detail).getByRole("switch", { name: "Sensitive memory" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "set_sensitivity", sensitivity: "standard" }),
    ),
  );
  await expectToastOnly("Memory marked standard.");
});

it("turns core off and gives agents access back", async () => {
  const start = { ...record, core: true };
  const uncored = { ...start, revision: 4, core: false, agentAccess: "blocked" as const };
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(start).mockResolvedValue(uncored);
  vi.mocked(api.updateKnowledge)
    .mockResolvedValueOnce(readable(uncored))
    .mockResolvedValueOnce(readable({ ...uncored, revision: 5, agentAccess: "allowed" }));
  mount();
  const detail = await openRecord();
  fireEvent.click(await within(detail).findByRole("switch", { name: "Load at session start" }));
  await expectToastOnly("Memory no longer loads at session start.");
  await waitFor(() =>
    expect(within(detail).getByRole("switch", { name: "Agents can read this" })).not.toBeChecked(),
  );
  fireEvent.click(within(detail).getByRole("switch", { name: "Agents can read this" }));
  await expectToastOnly("Agents can read this memory.");
  expect(api.updateKnowledge).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "set_access", agentAccess: "allowed", expectedRevision: 4 }),
  );
});

it("merge_and_undo_tag", async () => {
  const merged: KnowledgeTagIndex = {
    tags: [{ name: "family", count: 3 }],
    aliases: [
      { alias: "communication", name: "family", mergeId },
      { alias: "kin", name: "family", mergeId: laterMergeId },
    ],
  };
  vi.mocked(api.listKnowledgeTags).mockResolvedValueOnce(tagIndex).mockResolvedValue(merged);
  vi.mocked(api.mergeKnowledgeTags).mockResolvedValue({
    mergeId,
    from: "communication",
    into: "family",
    undoneAt: null,
  });
  vi.mocked(api.unmergeKnowledgeTags)
    .mockRejectedValueOnce(conflict({ blockingMergeIds: [laterMergeId] }))
    .mockResolvedValue({ mergeId, from: "communication", into: "family", undoneAt: now });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  const dialog = await screen.findByRole("dialog", { name: "Manage tags" });
  const from = await within(dialog).findByLabelText("Tag");
  await within(dialog).findByRole("option", { name: "communication (1)" });
  fireEvent.change(from, { target: { value: "communication" } });
  fireEvent.change(within(dialog).getByLabelText("Rename or merge into"), {
    target: { value: "Family" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge tag" }));
  await waitFor(() =>
    expect(api.mergeKnowledgeTags).toHaveBeenCalledWith({
      from: "communication",
      into: "family",
      mutationKey: uuid,
    }),
  );
  await expectToastOnly("Tag merged.");
  const aliases = await within(dialog).findByRole("region", { name: "Merged tags" });
  fireEvent.click(
    await within(aliases).findByRole("button", { name: "Undo merge of communication" }),
  );
  await waitFor(() =>
    expect(api.unmergeKnowledgeTags).toHaveBeenCalledWith({ mergeId, mutationKey: uuid }),
  );
  await expectToastOnly("Undo the later merge first: kin → family.");
  fireEvent.click(within(aliases).getByRole("button", { name: "Undo merge of communication" }));
  await expectToastOnly("Merge undone.");
  const [first, second] = vi.mocked(api.unmergeKnowledgeTags).mock.calls;
  expect(first?.[0].mutationKey).not.toBe(second?.[0].mutationKey);
});

it("rejects a tag merge without a valid target and reports a failed merge", async () => {
  vi.mocked(api.mergeKnowledgeTags).mockRejectedValue(
    new ApiClientError({
      status: 422,
      code: "unprocessable",
      message: "A tag cannot be merged into itself.",
    }),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  const dialog = await screen.findByRole("dialog", { name: "Manage tags" });
  await within(dialog).findByRole("option", { name: "family (2)" });
  expect(within(dialog).getByText("No merged tags yet.")).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText("Rename or merge into"), {
    target: { value: "!!!" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge tag" }));
  await expectToastOnly("Enter a tag name with letters or numbers.");
  expect(api.mergeKnowledgeTags).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText("Rename or merge into"), {
    target: { value: "relatives" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge tag" }));
  await expectToastOnly("A tag cannot be merged into itself.");
  expect(api.mergeKnowledgeTags).toHaveBeenCalledWith({
    from: "family",
    into: "relatives",
    mutationKey: uuid,
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Manage tags" })).not.toBeInTheDocument(),
  );
});

it("action_feedback_uses_sonner_only", async () => {
  const archiving = deferred<ReturnType<typeof readable>>();
  vi.mocked(api.updateKnowledge)
    .mockImplementationOnce(() => archiving.promise)
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }))
    .mockRejectedValueOnce(conflict())
    .mockResolvedValueOnce(readable({ ...record, revision: 5, status: "disputed" }));
  const unconfirmed = { ...record, ownerHeld: false, revision: 4 };
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(record).mockResolvedValue(unconfirmed);
  mount();
  const detail = await openRecord();
  fireEvent.click(await within(detail).findByRole("button", { name: "Archive" }));
  await expectToastOnly("Archiving memory…");
  expect(within(detail).getByRole("button", { name: "Archive" })).toBeDisabled();
  await act(async () =>
    archiving.resolve(readable({ ...record, revision: 4, status: "archived" })),
  );
  await expectToastOnly("Memory archived.");
  expect(screen.queryByText("Archiving memory…")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  const reopened = await openRecord();
  fireEvent.click(await within(reopened).findByRole("button", { name: "Confirm memory" }));
  await expectToastOnly(
    "Couldn’t confirm this update. Review the latest memory before trying again.",
  );
  expect(within(reopened).queryByRole("alert")).not.toBeInTheDocument();

  fireEvent.click(within(reopened).getByRole("button", { name: "Dispute memory" }));
  await expectToastOnly("This memory changed. Review the latest version.");
  fireEvent.click(within(reopened).getByRole("button", { name: "Dispute memory" }));
  await expectToastOnly("Memory disputed.");
  expect(api.updateKnowledge).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "dispute", expectedRevision: 4 }),
  );
});

it("unarchives from the Archived view", async () => {
  const archived = { ...record, status: "archived" as const };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([archived]));
  vi.mocked(api.getKnowledge).mockResolvedValue(archived);
  vi.mocked(api.updateKnowledge).mockResolvedValue(readable({ ...record, revision: 4 }));
  mount();
  selectTab("Archived");
  const detail = await openRecord(/Communication style.*Archived/i);
  expect(within(detail).queryByRole("button", { name: "Edit memory" })).not.toBeInTheDocument();
  fireEvent.click(await within(detail).findByRole("button", { name: "Unarchive" }));
  await expectToastOnly("Memory unarchived.");
  expect(api.updateKnowledge).toHaveBeenCalledWith({
    action: "unarchive",
    recordId: id,
    expectedRevision: 3,
    mutationKey: uuid,
  });
});

it("adds a memory with tags, core and a purpose hint", async () => {
  vi.mocked(api.saveKnowledge).mockResolvedValue(readable(record));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  const editor = await screen.findByRole("dialog", { name: "Add memory" });
  fireEvent.change(within(editor).getByLabelText("Fact"), { target: { value: "home_city" } });
  fireEvent.change(within(editor).getByLabelText("Value", { exact: true }), {
    target: { value: "Austin" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save memory" }));
  expect(await within(editor).findByText("Enter 1 to 8 tags, separated by commas.")).toBeVisible();
  await expectToastOnly("Check the highlighted memory fields.");
  fireEvent.change(within(editor).getByLabelText("Tags"), { target: { value: "Home, travel" } });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Load at session start" }));
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Sensitive" }));
  fireEvent.click(within(editor).getByRole("checkbox", { name: "Planning" }));
  fireEvent.change(within(editor).getByLabelText("Workspace"), { target: { value: "tasks" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save memory" }));
  await waitFor(() =>
    expect(api.saveKnowledge).toHaveBeenCalledWith({
      mutationKey: uuid,
      content: {
        kind: "fact",
        value: {
          subject: "owner",
          predicate: "home_city",
          value: { type: "string", value: "Austin" },
        },
      },
      evidence: [{ type: "statement", wording: "Home city. Austin" }],
      scope: { workspace: "tasks" },
      tags: ["home", "travel"],
      purposes: ["planning"],
      relatedRecordIds: [],
      core: true,
      sensitivity: "sensitive",
    }),
  );
  await expectToastOnly("Memory saved.");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
  const corrected: KnowledgeRecord = { ...latest, revision: 5, content: preference("detailed") };
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(conflict())
    .mockResolvedValue(readable(corrected));
  vi.mocked(api.getKnowledge)
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce(latest)
    .mockResolvedValue(corrected);
  vi.mocked(api.getKnowledgeHistory).mockResolvedValue(page([corrected, latest], { epoch: 5 }));
  mount();
  const row = await screen.findByRole("button", { name: rowName });
  expect(within(row).getByText("Inferred", { exact: true })).toBeVisible();
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
  await expectToastOnly("Memory saved.");
  const detail = screen.getByRole("dialog", { name: "Communication style" });
  expect(within(detail).getByText("Inferred", { exact: true })).toBeVisible();
  fireEvent.click(within(detail).getByRole("button", { name: "Show history" }));
  const history = await within(detail).findByRole("region", { name: "Revision history" });
  expect(await within(history).findByText("Revision 5")).toBeVisible();
  expect(within(history).getAllByText("Saved by you")).toHaveLength(2);
  expect(api.getKnowledgeHistory).toHaveBeenCalledWith({ recordId: id });
});

it("uses the latest memory after reviewing a conflicting edit", async () => {
  const latest = { ...record, revision: 4, content: preference("plain") };
  vi.mocked(api.updateKnowledge).mockRejectedValueOnce(conflict());
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(record).mockResolvedValue(latest);
  mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use latest memory" }));
  const detail = await screen.findByRole("dialog", { name: "Communication style" });
  expect(await within(detail).findByText("plain")).toBeVisible();
});

it("revises tags from the editor without changing content", async () => {
  vi.mocked(api.updateKnowledge).mockResolvedValue(
    readable({ ...record, revision: 4, tags: ["communication", "family"] }),
  );
  mount();
  await openRecord();
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
  fireEvent.click(await screen.findByRole("button", { name: rowName }));
  const detail = await screen.findByRole("dialog", { name: "Memory details" });
  await waitFor(() => expect(within(detail).queryByText("Inferred")).not.toBeInTheDocument());
  expect(within(detail).queryByRole("button", { name: "Edit memory" })).not.toBeInTheDocument();
});

it("late_save_after_logout_cannot_restore_memory", async () => {
  let finish!: () => void;
  vi.mocked(api.updateKnowledge).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(readable(record));
      }),
  );
  const { client, view } = mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await waitFor(() => expect(api.updateKnowledge).toHaveBeenCalledOnce());
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([], { epoch: 0 }));
  await act(async () => {
    client.clear();
    client.setQueryData(["me"], { id: id });
    view.rerender(<MemoryPage ownerId={id} />);
    finish();
  });
  expect(await screen.findByText("No matching memory")).toBeVisible();
  expect(screen.queryByText("Memory saved.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
  expect(client.getQueryCache().findAll({ queryKey: ["memory", owner] })).toHaveLength(0);
});

it("drops a late save and its toast after leaving Memory", async () => {
  let finish!: () => void;
  vi.mocked(api.updateKnowledge).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(readable(record));
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
  vi.mocked(api.updateKnowledge).mockResolvedValue(readable(updated));
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(record).mockResolvedValue(fresh);
  const { client } = mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  expect(await screen.findByText("Current source projection")).toBeVisible();
  expect(screen.queryByText("Previous source projection")).not.toBeInTheDocument();
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([fresh], { epoch: 5 }));
  await act(async () => {
    await client.refetchQueries({
      predicate: (query) => query.queryKey.includes("list") && query.isActive(),
    });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Current source projection")).not.toBeInTheDocument();
});

it("narrows the workspace and preserves the draft after a concurrent change", async () => {
  const latest: KnowledgeRecord = { ...record, revision: 4, sensitivity: "sensitive" };
  vi.mocked(api.getKnowledge).mockResolvedValueOnce(record).mockResolvedValue(latest);
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(conflict())
    .mockResolvedValue(readable(latest));
  mount();
  await openRecord();
  fireEvent.click(await screen.findByRole("button", { name: "Change workspace" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), {
    target: { value: "tasks" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  const keep = await screen.findByRole("button", { name: "Keep editing the workspace" });
  expect(
    within(screen.getByRole("region", { name: "Current claim" })).getByText("Sensitive"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Submitted change" })).getByText("Tasks"),
  ).toBeVisible();
  fireEvent.click(keep);
  expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveValue("tasks");
  fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "restrict", expectedRevision: 4, workspace: "tasks" }),
    ),
  );
  await expectToastOnly("Workspace updated.");
});

it("widens a restricted memory back to every workspace", async () => {
  const restricted = { ...record, scope: { workspace: "mail" as const } };
  vi.mocked(api.getKnowledge).mockResolvedValue(restricted);
  vi.mocked(api.updateKnowledge).mockResolvedValue(readable({ ...record, revision: 4 }));
  mount();
  const detail = await openRecord();
  expect(await within(detail).findByText("Mail")).toBeVisible();
  fireEvent.click(within(detail).getByRole("button", { name: "Change workspace" }));
  const select = screen.getByRole("combobox", { name: "Workspace" });
  expect(screen.getByRole("button", { name: "Save workspace" })).toBeDisabled();
  fireEvent.change(select, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
  await waitFor(() =>
    expect(api.updateKnowledge).toHaveBeenCalledWith({
      action: "widen",
      recordId: id,
      expectedRevision: 3,
      workspace: null,
      mutationKey: uuid,
    }),
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
  await openRecord();
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  expect(screen.getByRole("button", { name: "Save memory" })).toBeDisabled();
  expect(api.updateKnowledge).not.toHaveBeenCalled();
});

function invalidCursor() {
  return new ApiClientError({ status: 409, code: "conflict", message: "The cursor changed." });
}

it("drops previously disclosed rows before restarting a rejected list cursor", async () => {
  vi.mocked(api.searchKnowledge)
    .mockResolvedValueOnce(page([record], { nextCursor: "old-list" }))
    .mockRejectedValueOnce(invalidCursor())
    .mockResolvedValue(page([], { epoch: 4 }));
  mount();
  expect(await screen.findByRole("button", { name: rowName })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more memories" }));
  expect(await screen.findByText("No matching memory")).toBeVisible();
  expect(screen.queryByRole("button", { name: rowName })).not.toBeInTheDocument();
  await expectToastOnly("This memory page expired or changed. Reloading saved memory.");
  expect(api.searchKnowledge).toHaveBeenCalledTimes(3);
  expect(api.searchKnowledge).toHaveBeenLastCalledWith({});
});

it("loads the next page of memory", async () => {
  const second = { ...record, id: linkedId, content: preference("second page") };
  vi.mocked(api.searchKnowledge)
    .mockResolvedValueOnce(page([record], { nextCursor: "next" }))
    .mockResolvedValue(page([second]));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Load more memories" }));
  expect(await screen.findByRole("button", { name: /second page/ })).toBeVisible();
  expect(api.searchKnowledge).toHaveBeenLastCalledWith({ cursor: "next" });
  expect(screen.queryByRole("button", { name: "Load more memories" })).not.toBeInTheDocument();
});

it("reports partial and unavailable memory and retries a failed list", async () => {
  vi.mocked(api.searchKnowledge)
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }))
    .mockResolvedValueOnce({ ...page([record]), state: "partial" })
    .mockResolvedValue({ ...page([]), state: "unavailable" });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading memory" }));
  expect(
    await screen.findByText("Some memories are unavailable because their sources are unavailable."),
  ).toBeVisible();
  selectTab("Archived");
  expect(
    await screen.findByText("Memory sources are unavailable for these filters."),
  ).toBeVisible();
});

it("clears disclosed revision sources when a restriction invalidates the next history page", async () => {
  const revision: KnowledgeRecord = {
    ...record,
    author: { actorId: agentId, actorType: "agent" },
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
    .mockResolvedValueOnce(page([revision], { nextCursor: "old-history" }))
    .mockRejectedValueOnce(invalidCursor());
  mount();
  await openRecord();
  fireEvent.click(await screen.findByRole("button", { name: "Show history" }));
  expect(await screen.findByText(`Saved by agent ${agentId}`)).toBeVisible();
  fireEvent.click(await screen.findByText("Sources for revision 3"));
  expect(screen.getByText("Former revision source")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more revisions" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Former revision source")).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: rowName })).toBeVisible();
  expect(api.getKnowledgeHistory).toHaveBeenCalledTimes(2);
});

it("shows sources, validity and links for a superseded memory without edits", async () => {
  const superseded: KnowledgeRecord = {
    ...record,
    status: "superseded",
    supersededBy: operationId,
    relatedRecordIds: [childId],
    validFrom: now,
    validUntil: "2026-12-12T12:00:00.000Z",
    reviewAt: now,
    lastConfirmedAt: now,
    sources: [
      {
        id: operationId,
        actorId: agentId,
        actorType: "agent",
        classification: "agent_observation",
        evidence: { type: "observation", reference: "Calendar pattern" },
      },
      {
        id: linkedId,
        actorId: owner,
        actorType: "user",
        classification: "domain_record",
        evidence: { type: "domain_record", domain: "knowledge", id: linkedId, revision: 2 },
      },
      {
        id: childId,
        actorId: owner,
        actorType: "user",
        classification: "domain_record",
        evidence: { type: "domain_record", domain: "goals", id: childId, revision: 1 },
      },
      {
        id: proposalId,
        actorId: agentId,
        actorType: "agent",
        classification: "signed_inbound_message",
        evidence: { type: "signed_inbound_message", id: proposalId },
      },
      {
        id: mergeId,
        actorId: owner,
        actorType: "user",
        classification: "owner_statement",
        evidence: {
          type: "statement",
          wording: "Keep it short",
          sessionRef: "session-1",
          messageRef: "message-1",
        },
      },
      {
        id: laterMergeId,
        actorId: owner,
        actorType: "user",
        classification: "owner_statement",
        evidence: { type: "statement", wording: "Hidden" },
        availability: "unavailable",
      },
    ],
  };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([superseded]));
  vi.mocked(api.getKnowledge).mockResolvedValue(superseded);
  mount();
  const detail = await openRecord(/Communication style.*Superseded/i);
  expect(await within(detail).findByText("Calendar pattern")).toBeVisible();
  expect(within(detail).getByText("Keep it short")).toBeVisible();
  expect(within(detail).getByText("Source unavailable")).toBeVisible();
  expect(within(detail).getByText("Available until")).toBeVisible();
  expect(within(detail).queryByRole("button", { name: "Edit memory" })).not.toBeInTheDocument();
  expect(within(detail).queryByRole("switch")).not.toBeInTheDocument();
  fireEvent.click(within(detail).getByRole("button", { name: "Open replacement" }));
  await waitFor(() => expect(api.getKnowledge).toHaveBeenLastCalledWith({ id: operationId }));
  fireEvent.click(
    await within(await screen.findByRole("dialog")).findByRole("button", {
      name: "Open source memory · revision 2",
    }),
  );
  await waitFor(() => expect(api.getKnowledge).toHaveBeenLastCalledWith({ id: linkedId }));
  fireEvent.click(
    await within(await screen.findByRole("dialog")).findByRole("button", {
      name: "Open related memory 1",
    }),
  );
  await waitFor(() => expect(api.getKnowledge).toHaveBeenLastCalledWith({ id: childId }));
});

it("downloads memory a page at a time", async () => {
  vi.mocked(api.exportKnowledge)
    .mockResolvedValueOnce({ ...page([record], { nextCursor: "next-export" }), state: "partial" })
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce({ ...page([]), state: "unavailable" })
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }));
  const create = vi.fn(() => "blob:memory");
  const revoke = vi.fn();
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: create },
    revokeObjectURL: { configurable: true, value: revoke },
  });
  const download = async (name: string) => {
    fireEvent.click(await screen.findByRole("button", { name }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
  };
  try {
    mount();
    await download("Download memory");
    await expectToastOnly("Memory download started.");
    expect(
      screen.getByText("The file includes available revisions. Some sources are unavailable."),
    ).toBeVisible();
    await download("Download next page");
    await expectToastOnly("No available memory to download.");
    await download("Download memory");
    await expectToastOnly("Memory export is unavailable because its sources are unavailable.");
    await download("Download memory");
    await expectToastOnly("Memory export is unavailable. Try again later.");
    expect(create).toHaveBeenCalledOnce();
    // The page revokes the file's URL a second after the download starts.
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:memory"), { timeout: 1500 });
  } finally {
    anchorClick.mockRestore();
    if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

it("revalidates disclosures and resets the download after an export cursor conflict", async () => {
  vi.mocked(api.exportKnowledge)
    .mockResolvedValueOnce(page([record], { nextCursor: "old-export" }))
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

it("refreshes Trash when a restore conflicts and explains an empty Trash", async () => {
  const root = { ...record, trashedAt: now, trashGroupId: id, trashVersion: 1 };
  vi.mocked(api.searchKnowledge)
    .mockResolvedValueOnce(page([record]))
    .mockResolvedValueOnce(page([root]))
    .mockResolvedValue(page([]));
  vi.mocked(api.updateKnowledge).mockRejectedValue(conflict());
  mount();
  await screen.findByRole("button", { name: rowName });
  selectTab("Trash");
  fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
  await expectToastOnly("This memory couldn't be restored. Review Trash and try again.");
  expect(await screen.findByText("Trashed memory appears here for 30 days.")).toBeVisible();
});

it("asks for a valid search and keeps a selected tag that left the index", async () => {
  vi.mocked(api.listKnowledgeTags)
    .mockResolvedValueOnce(tagIndex)
    .mockResolvedValue({ tags: [], aliases: [] });
  mount();
  const chips = await screen.findByRole("group", { name: "Filter by tag" });
  fireEvent.click(await within(chips).findByRole("button", { name: "family" }));
  fireEvent.change(screen.getByLabelText("Search memory"), { target: { value: "\uD800" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await expectToastOnly("Enter a valid memory search.");
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  const dialog = await screen.findByRole("dialog", { name: "Manage tags" });
  fireEvent.change(within(dialog).getByLabelText("Rename or merge into"), {
    target: { value: "relatives" },
  });
  vi.mocked(api.mergeKnowledgeTags).mockResolvedValue({
    mergeId,
    from: "family",
    into: "relatives",
    undoneAt: null,
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge tag" }));
  await expectToastOnly("Tag merged.");
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const kept = await screen.findByRole("group", { name: "Filter by tag" });
  expect(within(kept).getByRole("button", { name: "family", pressed: true })).toBeVisible();
});

it("reports tag failures that are not the person's to fix", async () => {
  vi.mocked(api.listKnowledgeTags).mockResolvedValue({
    tags: tagIndex.tags,
    aliases: [{ alias: "kin", name: "family", mergeId }],
  });
  vi.mocked(api.mergeKnowledgeTags).mockRejectedValue(
    new ApiClientError({ status: 500, code: "internal", message: "Down" }),
  );
  vi.mocked(api.unmergeKnowledgeTags)
    .mockRejectedValueOnce(
      new ApiClientError({
        status: 404,
        code: "not_found",
        message: "The tag merge was not found.",
      }),
    )
    .mockRejectedValueOnce(conflict({ blockingMergeIds: [laterMergeId] }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  const dialog = await screen.findByRole("dialog", { name: "Manage tags" });
  await within(dialog).findByRole("option", { name: "family (2)" });
  fireEvent.change(within(dialog).getByLabelText("Rename or merge into"), {
    target: { value: "relatives" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge tag" }));
  await expectToastOnly("Couldn’t merge these tags. Try again.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo merge of kin" }));
  await expectToastOnly("The tag merge was not found.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo merge of kin" }));
  await expectToastOnly("Changed");
});

it("closes an edit whose memory was deleted meanwhile", async () => {
  vi.mocked(api.updateKnowledge).mockResolvedValue({
    receiptId: operationId,
    recordId: id,
    outcome: "forgotten",
  });
  mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  await expectToastOnly("This memory is unavailable.");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("closes the review when the latest memory is gone", async () => {
  vi.mocked(api.updateKnowledge).mockRejectedValue(conflict());
  vi.mocked(api.getKnowledge)
    .mockResolvedValueOnce(record)
    .mockRejectedValue(new ApiClientError({ status: 404, code: "not_found", message: "Gone" }));
  mount();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review latest memory" }));
  await expectToastOnly("This memory is no longer available.");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("refuses delete now without the Trash version the owner read", async () => {
  const unversioned = { ...record, trashedAt: now, trashGroupId: id };
  delete (unversioned as Partial<KnowledgeRecord>).trashVersion;
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([unversioned]));
  vi.mocked(api.getKnowledge).mockResolvedValue(unversioned);
  mount();
  selectTab("Trash");
  fireEvent.click(await screen.findByRole("button", { name: "Delete now" }));
  const confirmation = await screen.findByRole("dialog", { name: "Delete now?" });
  const confirmDelete = within(confirmation).getByRole("button", { name: "Delete now" });
  await waitFor(() => expect(confirmDelete).toBeEnabled());
  fireEvent.click(confirmDelete);
  await expectToastOnly("Reload Trash before deleting this memory.");
  expect(api.updateKnowledge).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("dialog", { name: "Communication style" })).toBeVisible();
});

it("shows an inference's uncertainty and partial history, and retries history", async () => {
  const inference: KnowledgeRecord = {
    ...record,
    claimKey: null,
    content: {
      kind: "inference",
      value: {
        subject: "Mornings",
        proposition: "Prefers quiet mornings",
        uncertainty: "Two weeks of calendar data",
        evidenceIds: [],
        reviewCondition: "Ask next month",
      },
    },
  };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([inference]));
  vi.mocked(api.getKnowledge).mockResolvedValue(inference);
  vi.mocked(api.getKnowledgeHistory)
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }))
    .mockResolvedValue({ ...page([inference]), state: "partial" });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Mornings.*quiet mornings/ }));
  const detail = await screen.findByRole("dialog", { name: "Mornings" });
  expect(await within(detail).findByText("Two weeks of calendar data")).toBeVisible();
  fireEvent.click(within(detail).getByRole("button", { name: "Show history" }));
  fireEvent.click(await within(detail).findByRole("button", { name: "Retry history" }));
  expect(
    await within(detail).findByText(
      "Some revisions are unavailable because their sources are unavailable.",
    ),
  ).toBeVisible();
});

it("starts a new download when memory changes between pages", async () => {
  vi.mocked(api.exportKnowledge).mockResolvedValue(page([record], { epoch: 9 }));
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
  try {
    mount();
    await screen.findByRole("button", { name: rowName });
    fireEvent.click(screen.getByRole("button", { name: "Download memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await expectToastOnly("Memory changed. Start a new download from the first page.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  } finally {
    anchorClick.mockRestore();
    if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
  }
});

it("retries an uncertain save with the same key so it cannot duplicate", async () => {
  vi.mocked(api.saveKnowledge)
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }))
    .mockResolvedValue(readable(record));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  const editor = await screen.findByRole("dialog", { name: "Add memory" });
  fireEvent.change(within(editor).getByLabelText("Fact"), { target: { value: "home_city" } });
  fireEvent.change(within(editor).getByLabelText("Value", { exact: true }), {
    target: { value: "Austin" },
  });
  fireEvent.change(within(editor).getByLabelText("Tags"), { target: { value: "home" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save memory" }));
  await expectToastOnly(
    "Couldn’t confirm the memory was saved. Check the list before trying again.",
  );
  fireEvent.click(within(editor).getByRole("button", { name: "Save memory" }));
  await expectToastOnly("Memory saved.");
  const [first, second] = vi.mocked(api.saveKnowledge).mock.calls;
  expect(second?.[0].mutationKey).toBe(first?.[0].mutationKey);
});

it("names the memories that block a restore and says when Trash retention ended", async () => {
  const root = { ...record, trashedAt: now, trashGroupId: id, trashVersion: 1 };
  const expired = {
    ...root,
    id: childId,
    trashGroupId: childId,
    content: preference("expired"),
    trashedAt: "2026-01-01T00:00:00.000Z",
  };
  const source = { ...record, id: linkedId, content: preference("source"), trashedAt: now };
  vi.mocked(api.searchKnowledge).mockResolvedValue(page([root, expired]));
  vi.mocked(api.getKnowledge).mockImplementation(async ({ id: requested }) => {
    if (requested === linkedId) return source;
    if (requested === operationId)
      return { id: operationId, state: "forgotten", trashedAt: now, purgedAt: now };
    throw new ApiClientError({ status: 404, code: "not_found", message: "Gone" });
  });
  vi.mocked(api.updateKnowledge)
    .mockRejectedValueOnce(conflict({ blockedBy: [linkedId, operationId, proposalId] }))
    .mockRejectedValueOnce(
      new ApiClientError({
        status: 409,
        code: "conflict",
        message: "This memory is past its Trash retention.",
      }),
    )
    .mockRejectedValueOnce(new ApiClientError({ status: 500, code: "internal", message: "Down" }));
  mount();
  selectTab("Trash");
  await screen.findByText("expired");
  const row = (text: string) => {
    const found = screen.getAllByRole("listitem").find((item) => within(item).queryByText(text));
    if (!found) throw new Error(`Expected a row for ${text}.`);
    return found;
  };
  fireEvent.click(within(row("concise")).getByRole("button", { name: "Restore" }));
  await expectToastOnly(
    "This memory came from memory that is in Trash or deleted: Communication style, A deleted memory, a memory you can't open. Restore that first, or leave this one in Trash.",
  );
  await screen.findByText("expired");
  fireEvent.click(within(row("expired")).getByRole("button", { name: "Restore" }));
  await expectToastOnly("This memory can no longer be restored. Its 30 days in Trash have ended.");
  await screen.findByText("expired");
  fireEvent.click(within(row("concise")).getByRole("button", { name: "Restore" }));
  await expectToastOnly("Couldn't confirm the restore. Check Trash before trying again.");
  expect(api.updateKnowledge).toHaveBeenCalledTimes(3);
  expect(
    screen.queryByText("This memory changed. Review the latest version."),
  ).not.toBeInTheDocument();
});

it("explains why Core is unavailable for sensitive, hidden and disputed memory", async () => {
  const cases: Array<[Partial<KnowledgeRecord>, string]> = [
    [{ sensitivity: "sensitive" }, "Sensitive memories never load at session start."],
    [{ agentAccess: "blocked" }, "Memories hidden from agents never load at session start."],
    [
      { status: "disputed" },
      "Confirm or edit this disputed memory first. Changing this would clear the dispute.",
    ],
  ];
  for (const [patch, reason] of cases) {
    vi.mocked(api.getKnowledge).mockResolvedValue({ ...record, ...patch });
    const { view } = mount();
    const detail = await openRecord();
    const core = await within(detail).findByRole("switch", { name: "Load at session start" });
    expect(core).toBeDisabled();
    expect(core).toHaveAccessibleDescription(reason);
    fireEvent.click(core);
    expect(api.updateKnowledge).not.toHaveBeenCalled();
    view.unmount();
  }
});

it("disables further tag chips once eight are chosen", async () => {
  const names = Array.from({ length: 9 }, (_, index) => `tag${index + 1}`);
  vi.mocked(api.listKnowledgeTags).mockResolvedValue({
    tags: names.map((name) => ({ name, count: 1 })),
    aliases: [],
  });
  mount();
  const chips = await screen.findByRole("group", { name: "Filter by tag" });
  for (const name of names.slice(0, 8))
    fireEvent.click(await within(chips).findByRole("button", { name }));
  const ninth = within(chips).getByRole("button", { name: "tag9" });
  expect(ninth).toBeDisabled();
  fireEvent.click(ninth);
  await waitFor(() =>
    expect(api.searchKnowledge).toHaveBeenLastCalledWith({ tags: names.slice(0, 8) }),
  );
  fireEvent.click(within(chips).getByRole("button", { name: "tag1" }));
  expect(within(chips).getByRole("button", { name: "tag9" })).toBeEnabled();
});
