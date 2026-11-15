// @vitest-environment jsdom

import type { KnowledgeRecord } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryScreen } from "./screen";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  api: {
    searchKnowledge: vi.fn(),
    getKnowledge: vi.fn(),
    getKnowledgeHistory: vi.fn(),
    updateKnowledge: vi.fn(),
  },
  epoch: 1,
  owner: "owner",
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  buttons: [] as { text: string; onPress?: () => void }[],
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
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  usePreventRemove: () => () => {},
}));

import { useEffect } from "react";

vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Alert: {
    alert: (_: string, __: string, buttons: typeof h.buttons) => {
      h.buttons = buttons;
    },
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: {} } }));
vi.mock("sonner-native", () => ({ toast: h.toast }));
vi.mock("../../components/screen", () => ({
  Screen: ({
    children,
    onRefresh,
  }: {
    children: ReactNode;
    onRefresh?: () => Promise<unknown>;
  }) => (
    <main>
      {onRefresh && (
        <button type="button" onClick={() => void onRefresh()}>
          Pull to refresh
        </button>
      )}
      {children}
    </main>
  ),
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
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
const inferred: KnowledgeRecord = {
  id,
  origin: "inferred",
  revision: 1,
  status: "active",
  stale: false,
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
  acceptance: {
    kind: "owner",
    actorId: id,
    acceptedAt: "2026-11-12T15:00:00.000Z",
    evidenceIds: [],
  },
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
};
const revised: KnowledgeRecord = {
  ...inferred,
  origin: "stated",
  acceptance: null,
  revision: 2,
  content: {
    kind: "preference",
    value: {
      subject: "owner",
      key: "communication_style",
      value: { type: "string", value: "prose" },
    },
  },
};
const page = (items: KnowledgeRecord[], epoch = 1, nextCursor: string | null = null) => ({
  schemaVersion: 1,
  items,
  epoch,
  state: "available",
  nextCursor,
});
function setup() {
  const renderResult = render(<MemoryScreen />);
  return { ...renderResult, refreshSession: () => renderResult.rerender(<MemoryScreen />) };
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (name: string | RegExp) => fireEvent.click(button(name));
async function openEditor() {
  fireEvent.click(await screen.findByRole("button", { name: /Communication style/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "prose" } });
}
beforeEach(() => {
  vi.resetAllMocks();
  h.owner = "owner";
  h.epoch = 1;
  h.toast.loading.mockReturnValue("memory-toast");
  h.api.searchKnowledge.mockResolvedValue(page([inferred]));
  h.api.getKnowledge.mockResolvedValue(inferred);
  h.api.getKnowledgeHistory.mockResolvedValue(page([revised, inferred], 2));
});
afterEach(cleanup);

it("native_owner_reviews_and_corrects", async () => {
  setup();
  await screen.findByText(/Inferred/);
  await openEditor();
  h.api.getKnowledge.mockResolvedValue(revised);
  h.api.searchKnowledge.mockResolvedValue(page([revised], 2));
  h.api.updateKnowledge.mockResolvedValue({ outcome: "readable", record: revised });
  press("Save changes");
  await screen.findAllByText("prose");
  expect(h.api.updateKnowledge).toHaveBeenCalledWith(
    expect.objectContaining({ action: "revise", expectedRevision: 1 }),
  );
  press("Revision history");
  await screen.findByText("Accepted by you");
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
  await screen.findByRole("button", { name: "Back to memory" });
  expect(screen.queryByRole("button", { name: "Edit memory" })).toBeNull();
  expect(screen.queryByText("bullets")).toBeNull();
});

it("back_navigation_and_logout_fence_pending_writes", async () => {
  const view = setup();
  for (const leave of ["back", "logout"]) {
    await openEditor();
    let resolve!: (value: unknown) => void;
    h.api.updateKnowledge.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    press("Save changes");
    if (leave === "back") press("Back to memory");
    else {
      h.epoch++;
      h.owner = "";
      view.refreshSession();
    }
    await act(async () => resolve({ outcome: "readable", record: revised }));
    await waitFor(() => expect(screen.queryByText("prose")).toBeNull());
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.dismiss).toHaveBeenCalled();
  }
});
