// @vitest-environment jsdom

import { ApiClientError } from "@personal-os/api-client";
import type { KnowledgePage, KnowledgeRecord } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RowAction } from "../../components/row-action-button";
import { memoryDateTime } from "./presentation";
import { MemoryScreen } from "./screen";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
type Alert = { title: string; message: string; buttons: { text: string; onPress?: () => void }[] };
const h = vi.hoisted(() => ({
  api: {
    searchKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
    getKnowledgeHistory: vi.fn(),
    updateKnowledge: vi.fn(),
    saveKnowledge: vi.fn(),
    listKnowledgeTags: vi.fn(),
    mergeKnowledgeTags: vi.fn(),
    unmergeKnowledgeTags: vi.fn(),
    exportKnowledge: vi.fn(),
  },
  epoch: 1,
  owner: "owner",
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  alerts: [] as Alert[],
  back: undefined as (() => void) | undefined,
  share: { available: true, shareMemoryPage: vi.fn() },
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: h.owner
      ? { status: "signedIn", user: { id: h.owner } }
      : { status: "signedOut", user: null },
    session: { epoch: () => h.epoch, api: () => h.api },
  }),
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn() },
  // The header's trailing actions render so tests reach the native action menu.
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight ? <header>{options.headerRight()}</header> : null,
  },
  useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  // The last screen to render owns native back, as the one mounted PrivateMemory does.
  usePreventRemove: (prevent: boolean, callback: (event: unknown) => void) => {
    h.back = prevent ? () => callback({ data: { action: { type: "POP" } } }) : undefined;
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {} },
  Alert: {
    alert: (title: string, message: string, buttons: Alert["buttons"]) => {
      h.alerts.push({ title, message, buttons });
    },
  },
  RefreshControl: ({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) => (
    <button type="button" aria-busy={refreshing} onClick={onRefresh}>
      Refresh list
    </button>
  ),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("sonner-native", () => ({ toast: h.toast }));
vi.mock("./share", () => ({
  memoryShareAvailable: () => h.share.available,
  shareMemoryPage: h.share.shareMemoryPage,
}));
vi.mock("../../components/screen", async () => {
  const { PageRefreshControl } = await vi.importActual<
    typeof import("../../components/page-refresh")
  >("../../components/page-refresh");
  return {
    Screen: ({
      children,
      onRefresh,
    }: {
      children: ReactNode;
      onRefresh?: () => Promise<unknown>;
    }) => (
      <main>
        {onRefresh && <PageRefreshControl onRefresh={onRefresh} />}
        {children}
      </main>
    ),
  };
});
vi.mock("../../components/editor-header", async () => {
  const { RowActions } = await vi.importActual<typeof import("../../components/row-actions")>(
    "../../components/row-actions",
  );
  return {
    editorDismissOptions: () => ({}),
    editorActionsOptions: (label: string, actions: RowAction[]) => ({
      headerRight: actions.length
        ? () => <RowActions placement="header" label={label} actions={actions} />
        : undefined,
    }),
  };
});
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/forms/form-save", () => ({
  FloatingAdd: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
  FormSave: ({
    label = "Save changes",
    disabled,
    onPress,
  }: {
    label?: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));

const id = "7d175d08-e235-49e9-900a-8b103bb68f9c";
const linkedId = "1e8a2c55-7a07-4c63-9d0e-6f1d6d2d0a01";
const proposalId = "2c0b6d4e-8f7a-4b55-9a51-0d9a6c4e7b02";
const otherId = "3f4e5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a03";
const groupId = "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c04";
const now = Date.parse("2026-11-15T15:00:00.000Z");
const base: KnowledgeRecord = {
  id,
  origin: "stated",
  revision: 1,
  status: "active",
  ownerHeld: true,
  agentAccess: "allowed",
  core: false,
  tags: ["communication"],
  lastConfirmedAt: null,
  schemaVersion: 1,
  claimKey: '[null,"preference","owner","communication_style"]',
  content: {
    kind: "preference",
    value: {
      subject: "owner",
      key: "communication_style",
      value: { type: "string", value: "bullets" },
    },
  },
  acceptance: null,
  author: { actorId: id, actorType: "user" },
  requiredReadScopes: [],
  validFrom: null,
  validUntil: null,
  reviewAt: null,
  scope: { workspace: null },
  sensitivity: "standard",
  purposes: ["planning"],
  confidence: 0.8,
  sources: [],
  relatedRecordIds: [],
  createdAt: "2026-11-12T15:00:00.000Z",
  conflictRecordIds: [],
  evidenceAvailable: true,
  supersededBy: null,
  trashedAt: null,
  trashGroupId: null,
  trashVersion: 0,
};
const memory = (overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord => ({
  ...base,
  ...overrides,
});
const fact = (subject: string, predicate: string, value: string): KnowledgeRecord["content"] => ({
  kind: "fact",
  value: { subject, predicate, value: { type: "string", value } },
});
const page = (
  items: KnowledgeRecord[],
  epoch = 1,
  nextCursor: string | null = null,
  state: KnowledgePage["state"] = "available",
): KnowledgePage => ({ schemaVersion: 1, items, epoch, state, nextCursor });
const records = new Map<string, KnowledgeRecord>();
const conflict = (details?: unknown) =>
  new ApiClientError({ code: "conflict", message: "Conflict", status: 409, details });
const receipt = (record: KnowledgeRecord) => ({
  receiptId: crypto.randomUUID(),
  recordId: record.id,
  outcome: "readable" as const,
  record,
});

function setup() {
  const view = render(<MemoryScreen />);
  return { ...view, refreshSession: () => view.rerender(<MemoryScreen />) };
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (name: string | RegExp) => fireEvent.click(button(name));
async function openMemory(title: string | RegExp = /Communication style/) {
  fireEvent.click(await screen.findByRole("button", { name: title }));
  await screen.findByRole("button", { name: "Revision history" });
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}, `) }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: option }));
}
/** The header's lifecycle actions, read from its menu (or its lone button) and left closed. */
function headerActions() {
  const header = document.querySelector("header");
  if (!header) return [];
  const trigger = within(header).queryByRole("button", { name: "Memory actions" });
  if (!trigger)
    return within(header)
      .getAllByRole("button")
      .map((entry) => entry.getAttribute("aria-label"));
  fireEvent.click(trigger);
  const labels = within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((entry) => entry.textContent)
    .filter((label) => label);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss actions" }));
  return labels;
}
/** Runs a header action through the native ellipsis menu, or the lone header button. */
function menu(name: string) {
  const header = document.querySelector("header");
  expect(header).not.toBeNull();
  const trigger = within(header as HTMLElement).queryByRole("button", { name: "Memory actions" });
  if (!trigger) {
    fireEvent.click(within(header as HTMLElement).getByRole("button", { name }));
    return;
  }
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
}
async function offers(name: string, offered = true) {
  await waitFor(() =>
    offered ? expect(headerActions()).toContain(name) : expect(headerActions()).not.toContain(name),
  );
}
function nativeBack() {
  act(() => h.back?.());
}
function pressAlert(text: string) {
  const alert = h.alerts.at(-1);
  act(() => alert?.buttons.find((entry) => entry.text === text)?.onPress?.());
}
const lastQuery = () => h.api.searchKnowledge.mock.calls.at(-1)?.[0];
const lastUpdate = () => h.api.updateKnowledge.mock.calls.at(-1)?.[0];
/** Every action reports through one Sonner toast: loading, then its outcome under that id. */
async function expectToast(
  loading: string,
  outcome: "success" | "error" | "info",
  message: string,
) {
  await waitFor(() => {
    const loadingCall = h.toast.loading.mock.calls.findLast(([text]) => text === loading);
    expect(loadingCall).toBeDefined();
    expect(h.toast[outcome]).toHaveBeenCalledWith(
      message,
      expect.objectContaining({ id: loadingCall?.[1]?.id }),
    );
  });
  expect(screen.queryByText(message)).toBeNull();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  h.owner = "owner";
  h.epoch = 1;
  h.alerts = [];
  h.back = undefined;
  h.share.available = true;
  records.clear();
  records.set(id, base);
  h.api.searchKnowledge.mockImplementation(async () => page([...records.values()]));
  h.api.getKnowledge.mockImplementation(async ({ id: wanted }: { id: string }) => {
    const record = records.get(wanted);
    if (!record) throw new ApiClientError({ code: "not_found", message: "Missing", status: 404 });
    return record;
  });
  h.api.getKnowledgeHistory.mockResolvedValue(page([base], 1));
  h.api.listKnowledgeTags.mockResolvedValue({
    tags: [
      { name: "family", count: 2 },
      { name: "communication", count: 1 },
    ],
    aliases: [],
  });
  h.api.updateKnowledge.mockImplementation(async ({ recordId }: { recordId: string }) =>
    receipt(records.get(recordId) ?? base),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lists_tabs_all_conflicts_archived_trash", async () => {
  setup();
  await screen.findByRole("button", { name: /Communication style/ });
  expect(lastQuery()).toEqual({});
  for (const [tab, query] of [
    ["Conflicts", { hasConflict: true }],
    ["Archived", { status: "archived" }],
    ["Trash", { status: "trashed" }],
    ["All", {}],
  ] as const) {
    records.clear();
    press(tab);
    await waitFor(() => expect(lastQuery()).toEqual(query));
    expect(button(tab).getAttribute("aria-pressed")).toBe("true");
  }
  // Empty views explain themselves; Trash offers no capture.
  await screen.findByText(/No memories yet/);
  press("Trash");
  await screen.findByText(/Trash is empty/);
  expect(screen.queryByRole("button", { name: "Add memory" })).toBeNull();
  press("Conflicts");
  await screen.findByText(/No conflicts/);
  press("Archived");
  await screen.findByText("No archived memories.");
  h.api.searchKnowledge.mockResolvedValueOnce(page([], 1, null, "unavailable"));
  press("All");
  await screen.findByText("Memory is unavailable right now.");
});

it("filters_by_tag_chip", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "#family" }));
  await waitFor(() => expect(lastQuery()).toEqual({ tags: ["family"] }));
  expect(button("#family").getAttribute("aria-pressed")).toBe("true");
  press("#communication");
  await waitFor(() => expect(lastQuery()).toEqual({ tags: ["family", "communication"] }));
  // A selected tag stays offered even after the index stops listing it.
  h.api.listKnowledgeTags.mockResolvedValue({ tags: [], aliases: [] });
  press("#family");
  await waitFor(() => expect(lastQuery()).toEqual({ tags: ["communication"] }));
  press("#communication");
  await waitFor(() => expect(lastQuery()).toEqual({}));

  press("Filters");
  choose("Type", "Fact");
  await waitFor(() => expect(lastQuery()).toEqual({ kind: "fact" }));
  choose("Workspace", "Finances");
  records.clear();
  choose("Origin", "Inferred");
  await waitFor(() =>
    expect(lastQuery()).toEqual({ kind: "fact", workspace: "finances", origin: "inferred" }),
  );
  await screen.findByText("No memories match.");
  choose("Type", "All types");
  choose("Workspace", "All workspaces");
  choose("Origin", "Stated and inferred");
  press("Hide filters");
  expect(screen.queryByRole("button", { name: /^Origin, / })).toBeNull();

  fireEvent.change(screen.getByRole("textbox", { name: "Search memory" }), {
    target: { value: "  coffee  " },
  });
  press("Search");
  await waitFor(() => expect(lastQuery()).toEqual({ text: "coffee" }));
  press("Clear search");
  await waitFor(() => expect(lastQuery()).toEqual({}));
  expect(screen.getByRole("textbox", { name: "Search memory" })).toHaveProperty("value", "");
});

it("shows_stated_inferred_and_sensitive_labels", async () => {
  records.set(
    otherId,
    memory({
      id: otherId,
      origin: "inferred",
      ownerHeld: false,
      sensitivity: "sensitive",
      status: "disputed",
      content: fact("owner", "home_city", "Lisbon"),
      claimKey: null,
      tags: ["home", "travel"],
      createdAt: "2026-10-01T15:00:00.000Z",
      author: { actorId: otherId, actorType: "agent" },
    }),
  );
  records.set(id, memory({ lastConfirmedAt: "2026-11-14T15:00:00.000Z" }));
  setup();
  await screen.findByText(/Stated · Added 3 days ago · Confirmed yesterday/);
  await screen.findByText(/#home #travel/);
  await screen.findByText(/Inferred · Sensitive · Disputed · Added a month ago$/);
  expect(document.body.textContent).not.toMatch(/%|0\.8|confidence/i);
  await openMemory(/Home city/);
  expect(screen.getByText(/Inferred · Sensitive · Disputed/)).toBeTruthy();
  expect(screen.getByText(`An agent (${otherId})`)).toBeTruthy();
  expect(screen.getByText("Added")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/%|0\.8|confidence|Updated/i);
});

it("pending_proposal_offers_only_resolve_conflict", async () => {
  const proposal = memory({
    id: proposalId,
    status: "proposed",
    ownerHeld: false,
    origin: "inferred",
    content: fact("owner", "coffee", "oat milk"),
    claimKey: null,
    conflictRecordIds: [id],
    author: { actorId: otherId, actorType: "agent" },
  });
  records.set(proposalId, proposal);
  records.set(id, memory({ conflictRecordIds: [proposalId] }));
  setup();
  await openMemory(/Coffee/);
  // A pending proposal is settled only by resolving it: no header actions at all.
  expect(headerActions()).toEqual([]);
  expect(document.querySelector("header")).toBeNull();
  for (const name of ["Keep mine", "Take the agent’s", "Edit and keep mine"])
    expect(button(name)).toBeTruthy();
});

it("resolve_conflict_keep_mine_and_take_agents", async () => {
  records.set(id, memory({ conflictRecordIds: [proposalId] }));
  const pending = memory({
    id: proposalId,
    revision: 4,
    status: "proposed",
    content: fact("owner", "coffee", "oat milk"),
    claimKey: null,
    conflictRecordIds: [linkedId, id],
  });
  records.set(proposalId, pending);
  // Keeping mine retires the proposal in favor of its target, which the receipt names.
  h.api.updateKnowledge.mockImplementationOnce(async () =>
    receipt({ ...pending, revision: 5, status: "superseded", supersededBy: id }),
  );
  setup();
  press("Conflicts");
  await waitFor(() => expect(lastQuery()).toEqual({ hasConflict: true }));
  await openMemory(/Coffee/);
  press("Keep mine");
  await waitFor(() =>
    expect(lastUpdate()).toEqual({
      recordId: proposalId,
      action: "resolve_conflict",
      keep: "current",
      expectedRevision: 4,
      mutationKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }),
  );
  // Keeping mine returns to the person's own memory.
  await waitFor(() => expect(h.api.getKnowledge).toHaveBeenLastCalledWith({ id }));
  await expectToast("Keeping your version…", "success", "Kept your version.");

  // A conflict need not be a proposal, so its row says only that it conflicts.
  press("Review conflicting memory");
  await screen.findByRole("button", { name: "Take the agent’s" });
  press("Take the agent’s");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ recordId: proposalId, keep: "proposed" }),
  );
  await waitFor(() => expect(h.api.getKnowledge).toHaveBeenLastCalledWith({ id: proposalId }));
  await expectToast("Taking the agent’s version…", "success", "Took the agent’s version.");
});

it("trash_confirmation_states_backup_and_agent_limits_and_lists_linked", async () => {
  records.set(
    id,
    memory({ relatedRecordIds: [linkedId, groupId], content: base.content, trashVersion: 2 }),
  );
  records.set(linkedId, memory({ id: linkedId, content: fact("Sam", "partner", "yes") }));
  h.api.getKnowledge.mockImplementation(async ({ id: wanted }: { id: string }) => {
    if (wanted === groupId)
      return {
        id: groupId,
        state: "forgotten",
        trashedAt: base.createdAt,
        purgedAt: base.createdAt,
      };
    const record = records.get(wanted);
    if (!record) throw new Error("offline");
    return record;
  });
  setup();
  await openMemory();
  await screen.findByRole("button", { name: "Sam · partner" });
  expect(button("A deleted memory")).toBeTruthy();
  menu("Move to Trash");
  const alert = h.alerts.at(-1);
  expect(alert?.title).toBe("Move “Communication style” to Trash?");
  expect(alert?.message).toContain("Older backups may still contain this until they're deleted");
  expect(alert?.message).toContain("Agents that already read it may remember it");
  expect(alert?.message).toContain("Memories this one links to stay where they are:");
  expect(alert?.message).toContain("• Sam · partner");
  expect(alert?.message).toContain("• A deleted memory");
  pressAlert("Cancel");
  expect(h.api.updateKnowledge).not.toHaveBeenCalled();

  menu("Move to Trash");
  h.api.updateKnowledge.mockResolvedValueOnce({
    receiptId: crypto.randomUUID(),
    recordId: id,
    outcome: "trashed",
  });
  pressAlert("Move to Trash");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "trash", recordId: id, expectedRevision: 1 }),
  );
  await expectToast("Moving to Trash…", "success", "Moved to Trash.");
  await screen.findByRole("button", { name: "Share memory export" });

  // A linked memory that cannot be read is still listed, without its content.
  records.delete(linkedId);
  await openMemory();
  await screen.findByRole("button", { name: "A memory you can’t open" });
});

it("restore_and_delete_now_from_trash", async () => {
  const trashed = memory({
    trashedAt: "2026-11-14T15:00:00.000Z",
    trashGroupId: id,
    trashVersion: 3,
  });
  records.set(id, trashed);
  setup();
  press("Trash");
  await waitFor(() => expect(lastQuery()).toEqual({ status: "trashed" }));
  await screen.findByText(/In Trash/);
  await openMemory();
  // The date is the end of the restore period; the purge follows it, not on it.
  // It ends partway through a day, so the deadline carries the local time.
  const deadline = memoryDateTime(
    new Date(Date.parse("2026-11-14T15:00:00.000Z") + 30 * 86_400_000).toISOString(),
  );
  expect(
    screen.getByText(
      `Moved to Trash ${new Date("2026-11-14T15:00:00.000Z").toLocaleDateString(undefined, { dateStyle: "medium" })}. You can restore it until ${deadline}; after that it’s deleted for good.`,
    ),
  ).toBeTruthy();
  expect(headerActions()).toEqual([]);

  press("Restore");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "restore", recordId: id }));
  await expectToast("Restoring memory…", "success", "Memory restored.");
  await screen.findByRole("button", { name: "Delete now" });

  // Delete now confirms the Trash version the person saw; a mismatch refreshes, never retries.
  h.api.updateKnowledge.mockImplementationOnce(async () => {
    records.set(id, { ...trashed, trashVersion: 4 });
    throw conflict({ trashVersion: 4 });
  });
  const reads = h.api.getKnowledge.mock.calls.length;
  press("Delete now");
  expect(h.alerts.at(-1)?.message).toContain(
    "Older backups may still contain this until they're deleted",
  );
  // Delete now also erases memories derived from this one that went to Trash on their own.
  expect(h.alerts.at(-1)?.message).toContain(
    "memories derived from it that you moved to Trash separately",
  );
  pressAlert("Delete now");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "This memory changed in Trash. Review it before deleting.",
      expect.anything(),
    ),
  );
  expect(lastUpdate()).toMatchObject({ action: "delete_now", expectedTrashVersion: 3 });
  await waitFor(() => expect(h.api.getKnowledge.mock.calls.length).toBeGreaterThan(reads));
  expect(h.api.updateKnowledge).toHaveBeenCalledTimes(2);

  await screen.findByRole("button", { name: "Delete now" });
  h.api.updateKnowledge.mockResolvedValueOnce({
    receiptId: crypto.randomUUID(),
    recordId: id,
    outcome: "forgotten",
  });
  press("Delete now");
  pressAlert("Delete now");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ expectedTrashVersion: 4 }));
  await expectToast("Deleting memory…", "success", "Memory deleted.");
});

it("trash_group_members_point_to_the_memory_they_moved_with", async () => {
  records.set(
    id,
    memory({ trashedAt: "2026-11-14T15:00:00.000Z", trashGroupId: groupId, trashVersion: 1 }),
  );
  records.set(
    groupId,
    memory({
      id: groupId,
      content: fact("owner", "source", "notes"),
      claimKey: null,
      trashedAt: "2026-11-14T15:00:00.000Z",
      trashGroupId: groupId,
      trashVersion: 1,
    }),
  );
  setup();
  await openMemory();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  press("Open the memory it moved with");
  await screen.findByRole("button", { name: "Restore" });
});

it("toggles_core_and_agent_access", async () => {
  setup();
  await openMemory();
  /** The server's state after the next action, which the detail reloads. */
  const next = (overrides: Partial<KnowledgeRecord>) => records.set(id, memory(overrides));
  next({ revision: 2, core: true });
  fireEvent.click(screen.getByRole("switch", { name: "Core memory" }));
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      action: "revise",
      recordId: id,
      expectedRevision: 1,
      core: true,
      content: base.content,
    }),
  );
  await expectToast("Updating memory…", "success", "Added to core memory.");
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Core memory" })).toHaveProperty("checked", true),
  );
  next({ revision: 3 });
  fireEvent.click(screen.getByRole("switch", { name: "Core memory" }));
  await waitFor(() => expect(lastUpdate()).toMatchObject({ core: false, expectedRevision: 2 }));
  await expectToast("Updating memory…", "success", "Removed from core memory.");

  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Core memory" })).toHaveProperty("checked", false),
  );
  next({ revision: 4, agentAccess: "blocked" });
  fireEvent.click(screen.getByRole("switch", { name: "Agents can use this" }));
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      action: "set_access",
      agentAccess: "blocked",
      expectedRevision: 3,
    }),
  );
  await expectToast("Updating agent access…", "success", "Hidden from agents.");
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Agents can use this" })).toHaveProperty(
      "checked",
      false,
    ),
  );
  next({ revision: 5 });
  fireEvent.click(screen.getByRole("switch", { name: "Agents can use this" }));
  await waitFor(() => expect(lastUpdate()).toMatchObject({ agentAccess: "allowed" }));
  await expectToast("Updating agent access…", "success", "Agents can use this memory.");

  await screen.findByRole("button", { name: "Sensitivity, Standard" });
  next({ revision: 6, sensitivity: "sensitive" });
  choose("Sensitivity", "Sensitive");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "set_sensitivity", sensitivity: "sensitive" }),
  );
  await screen.findByRole("button", { name: "Sensitivity, Sensitive" });
  next({ revision: 7 });
  choose("Sensitivity", "Standard");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ sensitivity: "standard" }));
  await expectToast("Updating sensitivity…", "success", "Marked standard.");

  await screen.findByRole("button", { name: "Sensitivity, Standard" });
  next({ revision: 8, scope: { workspace: "mail" } });
  choose("Workspace", "Mail");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "restrict", workspace: "mail" }),
  );
  await screen.findByRole("button", { name: "Workspace, Mail" });
  next({ revision: 9 });
  choose("Workspace", "All workspaces");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "widen", workspace: null }));
  await expectToast("Updating workspace…", "success", "Workspace updated.");
});

it("review_actions_confirm_dispute_archive_and_replace", async () => {
  const agentSaved = {
    ownerHeld: false,
    origin: "inferred" as const,
    author: { actorId: otherId, actorType: "agent" as const },
  };
  records.set(id, memory(agentSaved));
  setup();
  await openMemory();
  expect(headerActions()).toEqual([
    "Edit memory",
    "Confirm memory",
    "Dispute memory",
    "Replace with another memory",
    "Archive memory",
    "Move to Trash",
  ]);
  records.set(id, memory({ revision: 2 }));
  menu("Confirm memory");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "confirm" }));
  await expectToast("Confirming memory…", "success", "Memory confirmed.");
  await offers("Confirm memory", false);
  records.set(id, memory({ revision: 3, status: "disputed" }));
  menu("Dispute memory");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "dispute" }));
  await expectToast("Disputing memory…", "success", "Memory disputed.");
  // A disputed memory can be confirmed again, even when the person holds it.
  await offers("Confirm memory");
  expect(headerActions()).not.toContain("Dispute memory");
  records.set(id, memory({ revision: 4, status: "archived" }));
  menu("Archive memory");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "archive" }));
  await expectToast("Archiving memory…", "success", "Memory archived.");

  await offers("Unarchive memory");
  expect(headerActions()).toEqual(["Edit memory", "Unarchive memory", "Move to Trash"]);
  records.set(id, memory({ revision: 5 }));
  menu("Unarchive memory");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "unarchive" }));
  await expectToast("Unarchiving memory…", "success", "Memory unarchived.");

  await offers("Replace with another memory");
  menu("Replace with another memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Replacement memory ID" }), {
    target: { value: otherId },
  });
  records.set(id, memory({ revision: 6, status: "superseded", supersededBy: otherId }));
  records.set(otherId, memory({ id: otherId, content: fact("owner", "tea", "green") }));
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "supersede", replacementId: otherId }),
  );
  await expectToast("Replacing memory…", "success", "Memory replaced.");
  // A replaced memory is read-only apart from Trash.
  await screen.findByRole("button", { name: "Open replacement memory" });
  expect(headerActions()).toEqual(["Move to Trash"]);
  // With nothing linked, the Trash confirmation still states its limits.
  menu("Move to Trash");
  expect(h.alerts.at(-1)?.message).not.toContain("links to");
  expect(h.alerts.at(-1)?.message).toContain("Agents that already read it may remember it");
  pressAlert("Cancel");
  press("Open replacement memory");
  await screen.findByText("Tea");
});

it("native_owner_reviews_and_corrects", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), {
    target: { value: "communication, writing" },
  });
  const revised = memory({ revision: 2, content: fact("owner", "style", "prose"), claimKey: null });
  records.set(id, revised);
  h.api.getKnowledgeHistory.mockResolvedValue(page([revised], 1, "older"));
  press("Save changes");
  await screen.findAllByText("prose");
  expect(h.api.updateKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "revise",
      expectedRevision: 1,
      tags: ["communication", "writing"],
    }),
  );
  await expectToast("Saving memory…", "success", "Memory saved.");
  press("Revision history");
  await screen.findByText("Revision 2");
  // A revision has no time of its own (createdAt is when the memory was added), so none shows.
  expect(screen.queryByText(/· You · /)).toBeNull();
  h.api.getKnowledgeHistory.mockResolvedValueOnce(page([base], 1));
  press("Load older revisions");
  await waitFor(() =>
    expect(h.api.getKnowledgeHistory).toHaveBeenLastCalledWith({ recordId: id, cursor: "older" }),
  );
  await expectToast("Loading older revisions…", "info", "Older revisions loaded.");
  press("Hide revision history");
  expect(screen.queryByText("Revision 2")).toBeNull();
});

it("a_tag_only_edit_keeps_the_agents_sources", async () => {
  records.set(
    id,
    memory({
      ownerHeld: false,
      author: { actorId: otherId, actorType: "agent" },
      origin: "inferred",
    }),
  );
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), {
    target: { value: "communication, writing" },
  });
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "revise", tags: ["communication", "writing"] }),
  );
  // No evidence: the API keeps the agent's wording and session references.
  expect(lastUpdate()).not.toHaveProperty("evidence");
  await expectToast("Saving memory…", "success", "Memory saved.");

  // Changing the claim itself states it in the person's words.
  await screen.findByRole("button", { name: "Revision history" });
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      action: "revise",
      evidence: [{ type: "statement", wording: expect.stringContaining("prose") }],
    }),
  );
  expect(lastUpdate()).not.toHaveProperty("tags");
});

it("a_stale_edit_keeps_the_draft_and_reviews_the_latest_revision", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  h.api.updateKnowledge.mockRejectedValueOnce(conflict({ current: base }));
  press("Save changes");
  await screen.findByText("You edited revision 1.");
  await expectToast("Saving memory…", "error", "Memory changed. Review the latest revision.");
  expect(button("Save changes")).toHaveProperty("disabled", true);
  records.set(id, memory({ revision: 3 }));
  press("Load current revision");
  await screen.findByText("Current revision 3");
  press("Use this revision");
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveProperty("value", "prose");
  press("Save changes");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ expectedRevision: 3 }));
});

it("a_newer_revision_replaces_what_the_person_left_untouched", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), {
    target: { value: "communication, writing" },
  });
  h.api.updateKnowledge.mockRejectedValueOnce(conflict({ current: base }));
  press("Save changes");
  await screen.findByText("You edited revision 1.");
  // Another device changed the value; the person changed only the tags.
  const preference = (value: string): KnowledgeRecord["content"] => ({
    kind: "preference",
    value: { subject: "owner", key: "communication_style", value: { type: "string", value } },
  });
  records.set(id, memory({ revision: 3, content: preference("numbered") }));
  press("Load current revision");
  await screen.findByText("Current revision 3");
  press("Use this revision");
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveProperty("value", "numbered");
  expect(screen.getByRole("textbox", { name: "Tags" })).toHaveProperty(
    "value",
    "communication, writing",
  );
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      expectedRevision: 3,
      content: preference("numbered"),
      tags: ["communication", "writing"],
    }),
  );
});

it("a_field_both_versions_changed_waits_for_the_persons_choice", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  h.api.updateKnowledge.mockRejectedValueOnce(conflict({ current: base }));
  press("Save changes");
  await screen.findByText("You edited revision 1.");
  records.set(
    id,
    memory({
      revision: 3,
      content: {
        kind: "preference",
        value: {
          subject: "owner",
          key: "communication_style",
          value: { type: "string", value: "numbered" },
        },
      },
    }),
  );
  press("Load current revision");
  await screen.findByText("Current revision 3");
  press("Use this revision");
  // The editor stays open with the person's value until they choose.
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveProperty("value", "prose");
  expect(screen.getByText(/Yours: prose/)).toBeTruthy();
  expect(button("Save changes")).toHaveProperty("disabled", true);
  press("Keep my value");
  expect(button("Save changes")).toHaveProperty("disabled", false);
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      expectedRevision: 3,
      content: { value: { value: { value: "prose" } } },
    }),
  );
});

it("a_replacement_that_forms_a_cycle_keeps_the_editor_open", async () => {
  setup();
  await openMemory();
  await offers("Replace with another memory");
  menu("Replace with another memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Replacement memory ID" }), {
    target: { value: id },
  });
  // A cycle refusal carries no current revision: it is not a stale edit.
  h.api.updateKnowledge.mockRejectedValueOnce(conflict());
  press("Save changes");
  await expectToast(
    "Replacing memory…",
    "error",
    "That replacement leads back to this memory. Choose a different one.",
  );
  expect(screen.queryByText("You edited revision 1.")).toBeNull();
  // The draft keeps the replacement the person entered.
  expect(button(`Replacement memory ID, ${id}`)).toBeTruthy();
  expect(button("Save changes")).toHaveProperty("disabled", false);
});

it("reviewing_a_memory_that_was_deleted_returns_to_the_list", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  h.api.updateKnowledge.mockRejectedValueOnce(conflict({ current: base }));
  press("Save changes");
  await screen.findByText("You edited revision 1.");
  h.api.getKnowledge.mockResolvedValueOnce({
    id,
    state: "forgotten",
    trashedAt: "2026-11-14T15:00:00.000Z",
    purgedAt: "2026-11-15T14:00:00.000Z",
  });
  press("Load current revision");
  await expectToast("Loading the latest memory…", "error", "This memory was deleted.");
  await screen.findByRole("button", { name: "Add memory" });
});

it("keeping_my_value_keeps_its_type_too", async () => {
  const preference = (value: { type: string; value: unknown }) =>
    ({
      kind: "preference",
      value: { subject: "owner", key: "communication_style", value },
    }) as KnowledgeRecord["content"];
  records.set(id, memory({ content: preference({ type: "string", value: "yes" }) }));
  setup();
  await openMemory();
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "no" } });
  h.api.updateKnowledge.mockRejectedValueOnce(conflict({ current: base }));
  press("Save changes");
  await screen.findByText("You edited revision 1.");
  records.set(id, memory({ revision: 3, content: preference({ type: "boolean", value: true }) }));
  press("Load current revision");
  await screen.findByText("Current revision 3");
  press("Use this revision");
  expect(screen.getByText(/Yours: no \(String\)/)).toBeTruthy();
  press("Keep my value");
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      expectedRevision: 3,
      content: preference({ type: "string", value: "no" }),
    }),
  );
});

it("invalid_or_unchanged_edits_do_not_save", async () => {
  setup();
  await openMemory();
  menu("Edit memory");
  expect(button("Save changes")).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: " , " } });
  press("Save changes");
  expect(h.toast.error).toHaveBeenCalledWith("Check the memory fields and try again.");
  await screen.findByText("Enter 1 to 8 tags, separated by commas.");
  expect(h.api.updateKnowledge).not.toHaveBeenCalled();
  // Native back from a changed draft asks before discarding it.
  nativeBack();
  pressAlert("Discard");
  await screen.findByRole("button", { name: "Revision history" });
  menu("Edit memory");
  nativeBack();
  await screen.findByRole("button", { name: "Revision history" });
});

it("adds_a_memory", async () => {
  const saved = memory({
    id: otherId,
    content: fact("owner", "birthday", "May 1"),
    claimKey: null,
  });
  h.api.saveKnowledge.mockImplementation(async () => {
    records.set(otherId, saved);
    return receipt(saved);
  });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), {
    target: { value: "birthday" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "May 1" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "Family" } });
  // Sensitive memory never loads at session start, so it cannot be core.
  fireEvent.click(screen.getByRole("switch", { name: "Core memory" }));
  choose("Sensitivity", "Sensitive");
  expect(screen.getByRole("switch", { name: "Core memory" })).toHaveProperty("checked", false);
  expect(screen.getByRole("switch", { name: "Core memory" })).toHaveProperty("disabled", true);
  expect(screen.getByText("Sensitive memories never load at session start.")).toBeTruthy();
  choose("Sensitivity", "Standard");
  fireEvent.click(screen.getByRole("switch", { name: "Core memory" }));
  fireEvent.click(screen.getByRole("switch", { name: "Planning" }));
  press("Save changes");
  await screen.findByText("Birthday");
  expect(h.api.saveKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({
      tags: ["family"],
      core: true,
      purposes: ["planning"],
      sensitivity: "standard",
      scope: { workspace: null },
    }),
  );
  await expectToast("Saving memory…", "success", "Memory saved.");

  // Every use is the default when no use is chosen; closing an untouched form needs no prompt.
  nativeBack();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  nativeBack();
  await screen.findByRole("button", { name: "Add memory" });
  fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), { target: { value: "x" } });
  nativeBack();
  pressAlert("Discard");
  await screen.findByRole("button", { name: "Add memory" });
});

it("an_uncertain_add_keeps_its_key_for_an_exact_retry", async () => {
  h.api.saveKnowledge.mockRejectedValue(new Error("offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), { target: { value: "x" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "y" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "z" } });
  press("Save changes");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
  press("Save changes");
  await waitFor(() => expect(h.api.saveKnowledge).toHaveBeenCalledTimes(2));
  const [first, second] = h.api.saveKnowledge.mock.calls.map(([input]) => input.mutationKey);
  expect(first).toBe(second);
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
  // A purpose-free save leaves the memory available for every use.
  expect(h.api.saveKnowledge.mock.calls[0]?.[0]).not.toHaveProperty("purposes");
  // Native back while a save is in flight fences it.
  let resolve!: (value: unknown) => void;
  h.api.saveKnowledge.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  press("Save changes");
  nativeBack();
  await act(async () => resolve({ receiptId: id, recordId: id, outcome: "trashed" }));
  expect(h.toast.success).not.toHaveBeenCalled();
});

it("returning_to_an_unconfirmed_entry_reuses_its_key", async () => {
  h.api.saveKnowledge.mockRejectedValue(new Error("offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), { target: { value: "x" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "A" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "z" } });
  const save = async (times: number) => {
    press("Save changes");
    await waitFor(() => expect(h.api.saveKnowledge).toHaveBeenCalledTimes(times));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(times));
  };
  await save(1);
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "B" } });
  await save(2);
  // A may have been saved even though its response was lost: retrying A replays its receipt.
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "A" } });
  await save(3);
  const [a, b, again] = h.api.saveKnowledge.mock.calls.map(([input]) => input.mutationKey);
  expect(b).not.toBe(a);
  expect(again).toBe(a);

  // The keys belong to this Add session: a new one starts with none.
  nativeBack();
  pressAlert("Discard");
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), { target: { value: "x" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "A" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "z" } });
  await save(4);
  expect(h.api.saveKnowledge.mock.calls[3]?.[0].mutationKey).not.toBe(a);
});

it("merge_and_undo_tag", async () => {
  const mergeId = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d05";
  const laterId = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e06";
  h.api.listKnowledgeTags.mockResolvedValue({
    tags: [
      { name: "family", count: 2 },
      { name: "kin", count: 1 },
    ],
    aliases: [
      { alias: "relatives", name: "family", mergeId },
      { alias: "family", name: "kin", mergeId: laterId },
    ],
  });
  h.api.mergeKnowledgeTags.mockResolvedValue({
    mergeId,
    from: "kin",
    into: "household",
    undoneAt: null,
  });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  await screen.findByText("#family · 2 memories");
  expect(screen.getByText("#kin · 1 memory")).toBeTruthy();
  choose("Tag", "#kin");
  fireEvent.change(screen.getByRole("textbox", { name: "Merge into" }), {
    target: { value: "kin" },
  });
  press("Merge tags");
  expect(h.toast.error).toHaveBeenCalledWith("Enter a different tag name to merge into.");
  fireEvent.change(screen.getByRole("textbox", { name: "Merge into" }), {
    target: { value: "Household" },
  });
  press("Merge tags");
  await waitFor(() =>
    expect(h.api.mergeKnowledgeTags).toHaveBeenCalledWith({
      from: "kin",
      into: "household",
      mutationKey: expect.any(String),
    }),
  );
  await expectToast("Merging tags…", "success", "#kin is now filed under #household.");

  h.api.unmergeKnowledgeTags.mockRejectedValueOnce(conflict({ blockingMergeIds: [laterId] }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Undo merge of #relatives into #family" }),
  );
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "Undo the merge of #family into #kin first.",
      expect.anything(),
    ),
  );
  // A later merge this screen does not list is named generally.
  h.api.unmergeKnowledgeTags.mockRejectedValueOnce(conflict({ blockingMergeIds: [otherId] }));
  await screen.findByRole("button", { name: "Undo merge of #relatives into #family" });
  press("Undo merge of #relatives into #family");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "Undo the later merge of this tag first.",
      expect.anything(),
    ),
  );
  // A 409 without blocking merges (already undone, or a reused key) is not a later merge.
  h.api.unmergeKnowledgeTags.mockRejectedValueOnce(conflict());
  await screen.findByRole("button", { name: "Undo merge of #relatives into #family" });
  press("Undo merge of #relatives into #family");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "This merge is no longer active. Refresh the tags to see its current state.",
      expect.anything(),
    ),
  );
  h.api.unmergeKnowledgeTags.mockResolvedValueOnce({
    mergeId,
    from: "relatives",
    into: "family",
    undoneAt: base.createdAt,
  });
  await screen.findByRole("button", { name: "Undo merge of #relatives into #family" });
  press("Undo merge of #relatives into #family");
  await waitFor(() =>
    expect(h.api.unmergeKnowledgeTags).toHaveBeenLastCalledWith({
      mergeId,
      mutationKey: expect.any(String),
    }),
  );
  await expectToast("Undoing merge…", "success", "#relatives is its own tag again.");

  h.api.listKnowledgeTags.mockResolvedValue({ tags: [], aliases: [] });
  press("Refresh list");
  await screen.findByText("No tags yet.");
  nativeBack();
  await screen.findByRole("button", { name: "Manage tags" });
});

it("tags_that_fail_to_load_offer_a_retry", async () => {
  h.api.listKnowledgeTags.mockRejectedValue(new Error("offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading tags" }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn’t load tags."));
});

it("action_feedback_uses_sonner_only", async () => {
  setup();
  await openMemory();
  menu("Archive memory");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
  await expectToast("Archiving memory…", "success", "Memory archived.");

  await offers("Archive memory");
  h.api.updateKnowledge.mockRejectedValueOnce(new Error("offline"));
  menu("Archive memory");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
  const failure = "Couldn’t confirm this change. Check the memory before trying again.";
  expect(h.toast.error).toHaveBeenLastCalledWith(
    failure,
    expect.objectContaining({ id: expect.any(String) }),
  );
  expect(screen.queryByText(failure)).toBeNull();

  // A stale single action reloads the memory and says so through Sonner.
  h.api.updateKnowledge.mockRejectedValueOnce(conflict());
  menu("Archive memory");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "This memory changed. Showing the latest version.",
      expect.anything(),
    ),
  );
  // A memory that is gone returns to the list.
  await offers("Archive memory");
  h.api.updateKnowledge.mockRejectedValueOnce(
    new ApiClientError({ code: "not_found", message: "Missing", status: 404 }),
  );
  menu("Archive memory");
  await screen.findByRole("button", { name: "Share memory export" });
  // An unreadable outcome is reported as unavailable.
  await openMemory();
  h.api.updateKnowledge.mockResolvedValueOnce({
    receiptId: id,
    recordId: id,
    outcome: "forgotten",
  });
  menu("Archive memory");
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith(
      "This memory is unavailable.",
      expect.anything(),
    ),
  );
  expect(document.body.textContent).not.toMatch(/archived\.|unavailable\./);
});

it("pull_to_refresh_uses_spinner_and_error_toast_only", async () => {
  setup();
  await screen.findByRole("button", { name: /Communication style/ });
  let resolve!: (value: KnowledgePage) => void;
  h.api.searchKnowledge.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  press("Refresh list");
  await waitFor(() => expect(button("Refresh list").getAttribute("aria-busy")).toBe("true"));
  // Content stays visible while the spinner runs.
  expect(screen.getByRole("button", { name: /Communication style/ })).toBeTruthy();
  await act(async () => resolve(page([base])));
  await waitFor(() => expect(button("Refresh list").getAttribute("aria-busy")).toBe("false"));
  expect(h.api.listKnowledgeTags).toHaveBeenCalledTimes(2);
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(h.toast.success).not.toHaveBeenCalled();
  expect(h.toast.info).not.toHaveBeenCalled();

  // Both reads fail; the gesture still raises one error, and the list stays.
  h.api.searchKnowledge.mockRejectedValueOnce(new Error("offline"));
  h.api.listKnowledgeTags.mockRejectedValueOnce(new Error("offline"));
  press("Refresh list");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith("Couldn’t refresh. Pull down to try again."),
  );
  expect(h.toast.error).toHaveBeenCalledTimes(1);
  expect(h.toast.loading).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Communication style/ })).toBeTruthy();

  // The open memory refreshes the same way.
  await openMemory();
  records.set(id, memory({ content: fact("owner", "style", "prose"), claimKey: null }));
  press("Refresh list");
  await screen.findAllByText("prose");
  expect(h.toast.loading).not.toHaveBeenCalled();
});

it("native_back_from_detail_keeps_list_state", async () => {
  setup();
  await screen.findByRole("button", { name: /Communication style/ });
  press("Archived");
  fireEvent.change(screen.getByRole("textbox", { name: "Search memory" }), {
    target: { value: "style" },
  });
  press("Search");
  press("#family");
  records.set(id, memory({ status: "archived" }));
  await waitFor(() =>
    expect(lastQuery()).toEqual({ text: "style", tags: ["family"], status: "archived" }),
  );
  await openMemory();
  nativeBack();
  await screen.findByRole("button", { name: /Communication style/ });
  expect(screen.getByRole("textbox", { name: "Search memory" })).toHaveProperty("value", "style");
  expect(button("Archived").getAttribute("aria-pressed")).toBe("true");
  expect(button("#family").getAttribute("aria-pressed")).toBe("true");
  expect(lastQuery()).toEqual({ text: "style", tags: ["family"], status: "archived" });
  // A write that reloads the visit keeps the list state too.
  await openMemory();
  records.set(id, base);
  menu("Unarchive memory");
  await waitFor(() => expect(lastUpdate()).toMatchObject({ action: "unarchive" }));
  await offers("Archive memory");
  nativeBack();
  await screen.findByRole("button", { name: /Communication style/ });
  expect(button("Archived").getAttribute("aria-pressed")).toBe("true");
});

it("logout_clears_memory_cache", async () => {
  const view = setup();
  await screen.findByRole("button", { name: /Communication style/ });
  h.epoch++;
  h.owner = "";
  view.refreshSession();
  expect(screen.queryByText(/Communication style/)).toBeNull();
  expect(screen.queryByText("#family")).toBeNull();

  records.clear();
  records.set(otherId, memory({ id: otherId, content: fact("owner", "tea", "green") }));
  h.api.listKnowledgeTags.mockResolvedValue({ tags: [{ name: "drinks", count: 1 }], aliases: [] });
  h.epoch++;
  h.owner = "someone-else";
  view.refreshSession();
  await screen.findByRole("button", { name: /Tea/ });
  await screen.findByRole("button", { name: "#drinks" });
  expect(screen.queryByText(/Communication style/)).toBeNull();
  expect(screen.queryByRole("button", { name: "#family" })).toBeNull();
  expect(h.api.searchKnowledge).toHaveBeenCalledTimes(2);
});

it("back_navigation_and_logout_fence_pending_writes", async () => {
  const view = setup();
  for (const leave of ["back", "logout"]) {
    await openMemory();
    menu("Edit memory");
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "prose" },
    });
    let resolve!: (value: unknown) => void;
    h.api.updateKnowledge.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    press("Save changes");
    if (leave === "back") nativeBack();
    else {
      h.epoch++;
      h.owner = "";
      view.refreshSession();
    }
    await act(async () =>
      resolve(receipt(memory({ revision: 2, content: fact("owner", "x", "prose") }))),
    );
    await waitFor(() => expect(screen.queryByText("prose")).toBeNull());
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.dismiss).toHaveBeenCalled();
  }
});

it("native_treats_a_deleted_memory_as_unavailable", async () => {
  h.api.getKnowledge.mockResolvedValue({
    id,
    state: "forgotten",
    trashedAt: "2026-11-12T15:00:00.000Z",
    purgedAt: "2026-11-12T15:00:00.000Z",
  });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: /Communication style/ }));
  await screen.findByText(/This memory was deleted/);
  expect(headerActions()).toEqual([]);
  expect(screen.queryByText("bullets")).toBeNull();
  nativeBack();
  await screen.findByRole("button", { name: /Communication style/ });

  h.api.getKnowledge.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: /Communication style/ }));
  h.api.getKnowledge.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading memory" }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn’t load this memory."));
});

it("lists_load_more_and_reload_when_memory_changes", async () => {
  h.api.searchKnowledge.mockResolvedValueOnce(page([base], 1, "next"));
  setup();
  const second = memory({ id: otherId, content: fact("owner", "tea", "green") });
  h.api.searchKnowledge.mockResolvedValueOnce(page([second], 1));
  fireEvent.click(await screen.findByRole("button", { name: "Load more memory" }));
  await screen.findByRole("button", { name: /Tea/ });
  expect(lastQuery()).toEqual({ cursor: "next" });
  await expectToast("Loading more memory…", "info", "More memory loaded.");

  // A cursor that went stale reloads the list.
  h.api.searchKnowledge.mockResolvedValueOnce(page([base], 1, "next"));
  press("Refresh list");
  h.api.searchKnowledge.mockRejectedValueOnce(conflict());
  fireEvent.click(await screen.findByRole("button", { name: "Load more memory" }));
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith("This memory page changed. Reloading saved memory."),
  );
  // A page from a newer memory epoch reloads too.
  await screen.findByRole("button", { name: /Communication style/ });
  h.api.searchKnowledge.mockResolvedValueOnce(page([base], 1, "next"));
  press("Refresh list");
  h.api.searchKnowledge.mockResolvedValueOnce(page([second], 2));
  fireEvent.click(await screen.findByRole("button", { name: "Load more memory" }));
  await waitFor(() => expect(h.api.searchKnowledge).toHaveBeenLastCalledWith({}));

  h.api.searchKnowledge.mockRejectedValueOnce(new Error("offline"));
  press("Trash");
  h.api.searchKnowledge.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading saved memory" }));
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn’t load saved memory."));
});

it("a_page_requested_during_a_refresh_never_joins_the_refreshed_list", async () => {
  h.api.searchKnowledge.mockResolvedValueOnce(page([base], 1, "next"));
  setup();
  await screen.findByRole("button", { name: "Load more memory" });
  let refreshed!: (value: KnowledgePage) => void;
  h.api.searchKnowledge.mockReturnValueOnce(new Promise((done) => (refreshed = done)));
  press("Refresh list");
  let more!: (value: KnowledgePage) => void;
  h.api.searchKnowledge.mockReturnValueOnce(new Promise((done) => (more = done)));
  press("Load more memory");
  await act(async () => refreshed(page([base], 1, "next")));
  const second = memory({ id: otherId, content: fact("owner", "tea", "green") });
  await act(async () => more(page([second], 1)));
  // The page continued the list the refresh replaced, so it is dropped.
  expect(screen.queryByRole("button", { name: /Tea/ })).toBeNull();
  expect(button("Load more memory")).toBeTruthy();
});

it("a_partial_page_says_some_memories_are_missing", async () => {
  h.api.searchKnowledge.mockResolvedValueOnce(page([base], 1, null, "partial"));
  setup();
  await screen.findByRole("button", { name: /Communication style/ });
  expect(screen.getByText("Some memories couldn’t be shown right now.")).toBeTruthy();
});

it("search_text_stops_before_a_character_that_would_cross_the_limit", async () => {
  setup();
  await screen.findByRole("button", { name: /Communication style/ });
  const field = screen.getByRole("textbox", { name: "Search memory" });
  fireEvent.change(field, { target: { value: "tea 😀" } });
  expect(screen.getByRole("textbox", { name: "Search memory" })).toHaveProperty("value", "tea 😀");
  // Half an emoji is not text the API accepts, so the whole emoji stays out. (A long value
  // shows as the field's summary row.)
  fireEvent.change(field, { target: { value: `${"a".repeat(499)}😀` } });
  expect(button(`Search memory, ${"a".repeat(499)}`)).toBeTruthy();
});

it("shares_the_export_page_by_page", async () => {
  h.api.exportKnowledge.mockResolvedValueOnce(page([base], 1, "page-2", "partial"));
  h.share.shareMemoryPage.mockResolvedValue(true);
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Share memory export" }));
  await waitFor(() =>
    expect(h.share.shareMemoryPage).toHaveBeenCalledWith(
      expect.objectContaining({ nextCursor: "page-2" }),
      1,
      expect.any(Function),
    ),
  );
  await expectToast(
    "Preparing memory export…",
    "success",
    "Shared export page 1. Share the next page to continue.",
  );
  h.api.exportKnowledge.mockResolvedValueOnce(page([base], 1));
  fireEvent.click(await screen.findByRole("button", { name: "Share next export page" }));
  await waitFor(() => expect(h.api.exportKnowledge).toHaveBeenLastCalledWith({ cursor: "page-2" }));
  await waitFor(() =>
    expect(h.toast.success).toHaveBeenLastCalledWith("Memory export shared.", expect.anything()),
  );
  await screen.findByRole("button", { name: "Share memory export" });

  // A dismissed share sheet ends quietly; an unavailable export says so.
  h.share.shareMemoryPage.mockResolvedValueOnce(false);
  h.api.exportKnowledge.mockResolvedValueOnce(page([base], 1));
  press("Share memory export");
  await waitFor(() => expect(h.toast.dismiss).toHaveBeenCalled());
  h.api.exportKnowledge.mockResolvedValueOnce(page([], 1, null, "unavailable"));
  press("Share memory export");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenLastCalledWith(
      "Memory export is unavailable.",
      expect.anything(),
    ),
  );
});

it("reports_when_sharing_is_unavailable", async () => {
  h.share.available = false;
  setup();
  await screen.findByText("Sharing files isn’t available on this device.");
  press("Share memory export");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith(
      "Sharing files isn’t available on this device.",
      expect.anything(),
    ),
  );
  expect(h.api.exportKnowledge).not.toHaveBeenCalled();
});

it("shows_sources_scope_and_who_saved_it", async () => {
  const agent = { actorId: otherId, actorType: "agent" as const };
  records.set(
    id,
    memory({
      purposes: [],
      tags: [],
      author: agent,
      lastConfirmedAt: "2026-11-14T15:00:00.000Z",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      sources: [
        {
          id: linkedId,
          classification: "owner_statement",
          evidence: {
            type: "statement",
            wording: "I like bullets",
            sessionRef: "s1",
            messageRef: "m1",
          },
          ...agent,
        },
        {
          id: proposalId,
          classification: "agent_observation",
          evidence: { type: "observation", reference: "Mail thread" },
          ...agent,
        },
        {
          id: groupId,
          classification: "domain_record",
          evidence: { type: "domain_record", domain: "goals", id: groupId, revision: 2 },
          ...agent,
        },
        {
          id: otherId,
          classification: "signed_inbound_message",
          evidence: { type: "signed_inbound_message", id: otherId },
          ...agent,
          availability: "unavailable",
        },
      ],
    }),
  );
  setup();
  await openMemory();
  expect(screen.getByText("Every use")).toBeTruthy();
  expect(screen.getByText("None")).toBeTruthy();
  expect(screen.getByText(/I like bullets Session s1 Message m1/)).toBeTruthy();
  expect(screen.getByText(/Mail thread/)).toBeTruthy();
  expect(screen.getByText(new RegExp(`Goals ${groupId} · revision 2`))).toBeTruthy();
  expect(screen.getByText(/Source unavailable/)).toBeTruthy();
  expect(screen.getByText("Confirmed by you")).toBeTruthy();
  expect(screen.getByText("Valid until")).toBeTruthy();

  records.set(id, memory({ evidenceAvailable: false }));
  press("Refresh list");
  await screen.findByText("Supporting evidence is unavailable.");
});

it("adds_memories_of_other_kinds", async () => {
  h.api.saveKnowledge.mockResolvedValue({ receiptId: id, recordId: id, outcome: "forgotten" });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Fact" }), { target: { value: "x" } });
  press("Save changes");
  expect(h.toast.error).toHaveBeenCalledWith("Check the memory fields and try again.");
  choose("Memory type", "Routine");
  fireEvent.change(screen.getByRole("textbox", { name: "Recurrence" }), {
    target: { value: "Weekly" },
  });
  choose("Origin", "Observed");
  fireEvent.change(screen.getByRole("textbox", { name: "Starts (ISO date and time)" }), {
    target: { value: "2026-01-01T00:00:00.000Z" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Ends (ISO date and time)" }), {
    target: { value: "2027-01-01T00:00:00.000Z" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "habits" } });
  choose("Workspace", "Mail");
  fireEvent.click(screen.getByRole("switch", { name: "Planning" }));
  fireEvent.click(screen.getByRole("switch", { name: "Planning" }));
  press("Save changes");
  await waitFor(() =>
    expect(h.api.saveKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          kind: "routine",
          value: expect.objectContaining({ classification: "observed", recurrence: "Weekly" }),
        }),
        scope: { workspace: "mail" },
      }),
    ),
  );
  await expectToast("Saving memory…", "success", "This memory is unavailable.");

  fireEvent.click(await screen.findByRole("button", { name: "Add memory" }));
  choose("Memory type", "Preference");
  fireEvent.change(screen.getByRole("textbox", { name: "Preference" }), {
    target: { value: "dark mode" },
  });
  choose("Value type", "Boolean");
  fireEvent.click(screen.getByRole("switch", { name: "Value" }));
  fireEvent.click(screen.getByRole("switch", { name: "Value" }));
  choose("Value type", "Date");
  expect(screen.getByPlaceholderText("2026-01-31")).toBeTruthy();
  choose("Value type", "Boolean");
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), { target: { value: "ui" } });
  press("Save changes");
  await waitFor(() =>
    expect(h.api.saveKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: {
          kind: "preference",
          value: { subject: "owner", key: "dark mode", value: { type: "boolean", value: true } },
        },
      }),
    ),
  );
});

it("an_undo_that_fails_for_another_reason_says_so", async () => {
  const mergeId = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d05";
  h.api.listKnowledgeTags.mockResolvedValue({
    tags: [],
    aliases: [{ alias: "kin", name: "family", mergeId }],
  });
  h.api.unmergeKnowledgeTags.mockRejectedValue(new Error("offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo merge of #kin into #family" }));
  await expectToast(
    "Undoing merge…",
    "error",
    "Couldn’t confirm the undo. Check the tags before trying again.",
  );
  expect(screen.queryByRole("button", { name: "Merge tags" })).toBeNull();
});

it("outcome_toasts_release_their_ids_when_they_close", async () => {
  setup();
  await openMemory();
  menu("Archive memory");
  await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
  const options = h.toast.success.mock.calls.at(-1)?.[1];
  act(() => {
    options?.onAutoClose?.();
    options?.onDismiss?.();
  });
  // A released toast is not dismissed again when the visit ends.
  h.toast.dismiss.mockClear();
  h.epoch++;
  h.owner = "";
  cleanup();
  expect(h.toast.dismiss).not.toHaveBeenCalledWith(options?.id);
});

it("edit_and_keep_mine_settles_the_conflict_then_edits_from_the_agents_wording", async () => {
  const preference = (value: string): KnowledgeRecord["content"] => ({
    kind: "preference",
    value: { subject: "owner", key: "communication_style", value: { type: "string", value } },
  });
  records.set(id, memory({ conflictRecordIds: [proposalId] }));
  // Another memory the person saved for the same claim also conflicts, and sorts first.
  records.set(
    linkedId,
    memory({ id: linkedId, content: preference("headings"), conflictRecordIds: [proposalId] }),
  );
  records.set(
    proposalId,
    memory({
      id: proposalId,
      revision: 2,
      status: "proposed",
      ownerHeld: false,
      origin: "inferred",
      content: preference("numbered lists"),
      conflictRecordIds: [linkedId, id],
    }),
  );
  h.api.searchKnowledge.mockImplementation(async (query: { hasConflict?: boolean }) =>
    page(
      [...records.values()].filter(
        (record) => !query.hasConflict || record.conflictRecordIds.length > 0,
      ),
    ),
  );
  h.api.updateKnowledge.mockImplementation(async (input: { recordId: string; action: string }) => {
    if (input.action === "resolve_conflict") {
      // The API retires the proposal in favor of the record it proposed to change.
      records.set(proposalId, memory({ id: proposalId, status: "superseded", supersededBy: id }));
      records.set(id, memory());
      records.set(linkedId, memory({ id: linkedId, content: preference("headings") }));
    }
    return receipt(records.get(input.recordId) ?? base);
  });
  setup();
  press("Conflicts");
  await waitFor(() => expect(lastQuery()).toEqual({ hasConflict: true }));
  fireEvent.click(await screen.findByRole("button", { name: /numbered lists/ }));
  await screen.findByRole("button", { name: "Revision history" });
  // A same-claim conflict is not what the proposal targets; resolving opens the real target.
  fireEvent.click(await screen.findByRole("button", { name: "Edit and keep mine" }));
  await waitFor(() =>
    expect(h.api.updateKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: proposalId,
        action: "resolve_conflict",
        keep: "current",
        expectedRevision: 2,
      }),
    ),
  );
  await expectToast(
    "Keeping your version…",
    "success",
    "Kept your version. Edit it with the agent’s wording.",
  );
  // The person's memory opens in its editor, filled with the agent's wording, ready to save.
  const value = await screen.findByRole("textbox", { name: "Value" });
  expect(value).toHaveProperty("value", "numbered lists");
  expect(h.api.getKnowledge).toHaveBeenLastCalledWith({ id });
  expect(h.api.getKnowledge).not.toHaveBeenCalledWith({ id: linkedId });
  expect(screen.getByText(/The agent’s wording is filled in/)).toBeTruthy();
  expect(h.toast.loading).toHaveBeenCalledTimes(1);
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({
      recordId: id,
      action: "revise",
      content: preference("numbered lists"),
    }),
  );
  await expectToast("Saving memory…", "success", "Memory saved.");
  // The proposal has left Conflicts.
  await screen.findByRole("button", { name: "Revision history" });
  nativeBack();
  await screen.findByText(/No conflicts/);
  expect(button("Conflicts").getAttribute("aria-pressed")).toBe("true");
});

it("restore_conflicts_say_why_and_never_retry", async () => {
  const trashed = memory({
    trashedAt: "2026-11-14T15:00:00.000Z",
    trashGroupId: id,
    trashVersion: 1,
  });
  records.set(id, trashed);
  records.set(
    linkedId,
    memory({
      id: linkedId,
      content: fact("owner", "source", "notes"),
      claimKey: null,
      trashedAt: "2026-11-14T15:00:00.000Z",
      trashGroupId: linkedId,
    }),
  );
  h.api.getKnowledge.mockImplementation(async ({ id: wanted }: { id: string }) => {
    if (wanted === groupId)
      return {
        id: groupId,
        state: "forgotten",
        trashedAt: base.createdAt,
        purgedAt: base.createdAt,
      };
    const record = records.get(wanted);
    if (!record) throw new Error("offline");
    return record;
  });
  setup();
  await openMemory();
  const restore = async (details: unknown, message: string) => {
    const calls = h.api.updateKnowledge.mock.calls.length;
    h.api.updateKnowledge.mockRejectedValueOnce(conflict(details));
    press("Restore");
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith(message, expect.anything()));
    expect(h.api.updateKnowledge).toHaveBeenCalledTimes(calls + 1);
    await waitFor(() => expect(button("Restore")).toHaveProperty("disabled", false));
  };
  await restore({ blockedBy: [linkedId] }, "Restore “Source” first. This memory came from it.");
  await restore(
    { blockedBy: [linkedId, otherId] },
    "Restore “Source”, a memory you can’t open first. This memory came from them.",
  );
  await restore(
    { blockedBy: [linkedId, groupId] },
    "A memory this one came from was deleted, so it can’t be restored.",
  );
  await restore(
    { trashGroupId: linkedId },
    "This memory moved to Trash with another memory. Restore that one instead.",
  );
  // Past Trash retention the API refuses without details; the app says why.
  records.set(id, { ...trashed, trashedAt: "2026-10-01T15:00:00.000Z" });
  press("Refresh list");
  await screen.findByText(/Moved to Trash Oct/);
  await restore(undefined, "This memory has been in Trash too long to restore.");
  // Any other refusal is a stale view: it reloads.
  vi.setSystemTime(Date.parse("2026-10-02T15:00:00.000Z"));
  await restore(undefined, "This memory changed. Showing the latest version.");
});

it("core_toggle_explains_when_it_is_unavailable", async () => {
  records.set(id, memory({ status: "disputed" }));
  setup();
  await openMemory();
  const core = () => screen.getByRole("switch", { name: "Core memory" });
  expect(core()).toHaveProperty("disabled", true);
  expect(screen.getByText("Settle the dispute first: confirm or edit this memory.")).toBeTruthy();

  records.set(id, memory({ agentAccess: "blocked" }));
  press("Refresh list");
  await screen.findByText("Agents can’t use this memory, so it never loads at session start.");
  expect(core()).toHaveProperty("disabled", true);

  records.set(id, memory({ sensitivity: "sensitive" }));
  press("Refresh list");
  await screen.findByText("Sensitive memories never load at session start.");
  expect(core()).toHaveProperty("disabled", true);

  // A sensitive memory that is already core can still be taken out.
  records.set(id, memory({ sensitivity: "sensitive", core: true }));
  press("Refresh list");
  await waitFor(() => expect(core()).toHaveProperty("disabled", false));
  // It still says why it does not load, rather than promising that it does.
  expect(screen.getByText("Sensitive memories never load at session start.")).toBeTruthy();
  expect(screen.queryByText("Agents load it at the start of every session.")).toBeNull();
});

it("tag_chips_stop_at_eight", async () => {
  const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  h.api.listKnowledgeTags.mockResolvedValue({
    tags: names.map((name) => ({ name, count: 1 })),
    aliases: [],
  });
  setup();
  for (const name of names.slice(0, 8))
    fireEvent.click(await screen.findByRole("button", { name: `#${name}` }));
  await waitFor(() => expect(lastQuery()).toEqual({ tags: names.slice(0, 8) }));
  expect(button("#i")).toHaveProperty("disabled", true);
  expect(button("#a")).toHaveProperty("disabled", false);
  press("#a");
  await waitFor(() => expect(button("#i")).toHaveProperty("disabled", false));
});

it("detail_and_tags_pull_to_refresh_report_one_error", async () => {
  setup();
  await openMemory();
  h.api.getKnowledge.mockRejectedValueOnce(new Error("offline"));
  press("Refresh list");
  await waitFor(() =>
    expect(h.toast.error).toHaveBeenCalledWith("Couldn’t refresh. Pull down to try again."),
  );
  expect(h.toast.error).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("bullets").length).toBeGreaterThan(0);

  // While an action runs, a refresh waits rather than dropping its outcome.
  let resolve!: (value: unknown) => void;
  h.api.updateKnowledge.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  menu("Archive memory");
  const reads = h.api.getKnowledge.mock.calls.length;
  press("Refresh list");
  expect(h.api.getKnowledge).toHaveBeenCalledTimes(reads);
  await act(async () => resolve(receipt(base)));
  await expectToast("Archiving memory…", "success", "Memory archived.");

  nativeBack();
  fireEvent.click(await screen.findByRole("button", { name: "Manage tags" }));
  await screen.findByText("#family · 2 memories");
  h.api.listKnowledgeTags.mockRejectedValueOnce(new Error("offline"));
  press("Refresh list");
  await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
  expect(screen.getByText("#family · 2 memories")).toBeTruthy();
});

it("a_refresh_that_returns_after_editing_starts_keeps_the_draft", async () => {
  setup();
  await openMemory();
  let arrive!: (record: KnowledgeRecord) => void;
  h.api.getKnowledge.mockReturnValueOnce(new Promise((done) => (arrive = done)));
  press("Refresh list");
  menu("Edit memory");
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
  // The refresh brings a changed record, but the person is editing: it never replaces the draft.
  await act(async () => arrive(memory({ revision: 2, tags: ["writing"] })));
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveProperty("value", "prose");
  press("Save changes");
  await waitFor(() =>
    expect(lastUpdate()).toMatchObject({ action: "revise", expectedRevision: 1 }),
  );

  // An idle detail still refreshes.
  await screen.findByRole("button", { name: "Revision history" });
  records.set(id, memory({ revision: 4, tags: ["refreshed"] }));
  press("Refresh list");
  await screen.findByText("#refreshed");
});

it("a_trashed_or_replaced_proposal_offers_no_resolution_and_a_pending_one_no_trash", async () => {
  const proposal = memory({
    id: proposalId,
    status: "proposed",
    ownerHeld: false,
    origin: "inferred",
    content: fact("owner", "coffee", "oat milk"),
    claimKey: null,
    conflictRecordIds: [id],
  });
  records.set(proposalId, proposal);
  setup();
  await openMemory(/Coffee/);
  // Pending: resolve it; Trash is not offered.
  expect(button("Keep mine")).toBeTruthy();
  expect(headerActions()).not.toContain("Move to Trash");

  // In Trash: no resolution, only its Trash state.
  records.set(proposalId, {
    ...proposal,
    trashedAt: "2026-11-14T15:00:00.000Z",
    trashGroupId: proposalId,
    trashVersion: 1,
  });
  press("Refresh list");
  await screen.findByRole("button", { name: "Restore" });
  for (const name of ["Keep mine", "Take the agent’s", "Edit and keep mine"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(headerActions()).toEqual([]);

  // Superseded: no resolution either; it can only be read or trashed.
  records.set(proposalId, { ...proposal, status: "superseded", supersededBy: id });
  press("Refresh list");
  await screen.findByRole("button", { name: "Open replacement memory" });
  for (const name of ["Keep mine", "Take the agent’s", "Edit and keep mine"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(headerActions()).toEqual(["Move to Trash"]);
  press("Open replacement memory");
  await waitFor(() => expect(h.api.getKnowledge).toHaveBeenLastCalledWith({ id }));
});
