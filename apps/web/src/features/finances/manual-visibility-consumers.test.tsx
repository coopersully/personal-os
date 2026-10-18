// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingSnapshot,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceTransactionControls } from "./transaction-controls";
import { FinanceCreateButton } from "./workspace-header";

const state = vi.hoisted(() => ({
  snapshot: undefined as FinanceOnboardingSnapshot | undefined,
  queryState: "current" as "current" | "pending" | "error",
}));
beforeEach(() => {
  state.queryState = "current";
});
vi.mock("./use-finance-workspace-readiness", () => ({
  useFinanceWorkspaceReadiness: () => {
    const readiness = state.snapshot ? deriveFinanceOnboardingReadiness(state.snapshot) : undefined;
    return {
      snapshot: state.snapshot,
      isPending: state.queryState === "pending",
      isError: state.queryState === "error",
      readiness,
      manualCreationVisible: readiness?.manualCreationVisible,
    };
  },
}));
vi.mock("./plaid-connect", () => ({
  PlaidConnectButton: () => <button type="button">Connect bank</button>,
}));
vi.mock("../workspace-settings/preferences", () => ({
  useWorkspacePreferences: () => ({ data: undefined }),
  useSaveWorkspacePreferences: () => ({ mutate: vi.fn() }),
}));
function snapshot(
  manualVisibility: "auto" | "show" | "hide",
  registrations: number,
  complete = true,
): FinanceOnboardingSnapshot {
  return {
    revision: 1,
    completedAt: complete ? "2026-10-18T12:00:00Z" : null,
    existingAccess: false,
    source: { state: "unavailable", summary: "Offline", recoveryHref: null },
    contextReview: "unavailable",
    questions: [],
    displayPreferences: { reviewed: false, summary: [] },
    automationChoice: null,
    manualVisibility,
    automation: {
      registrationCount: registrations,
      authorizedRegistrationWithCadence: false,
      chatVerification: "pending",
      canSendChat: false,
      historyAvailable: true,
    },
  };
}
function mount(path = "/finances/transactions") {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <FinanceCreateButton />
        <FinanceTransactionControls
          accounts={[]}
          categories={[]}
          exportAction={<button type="button">Export</button>}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it.each([
  ["auto", 0, true],
  ["auto", 1, false],
  ["show", 1, true],
  ["hide", 0, false],
] as const)("uses %s with %i registrations independent of unavailable health", async (mode, count, visible) => {
  state.snapshot = snapshot(mode, count);
  mount();
  expect(!!screen.queryByRole("button", { name: "Add in Transactions" })).toBe(visible);
  expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: visible ? "Add in Finances" : "Add account" }),
  );
  if (visible) await userEvent.click(screen.getByRole("button", { name: "Account" }));
  expect(screen.getByRole("button", { name: "Connect bank" })).toBeVisible();
  expect(!!screen.queryByRole("button", { name: "Track account manually" })).toBe(visible);
});
it("keeps unknown readiness from implying Auto without registrations while preserving linking", async () => {
  state.snapshot = undefined;
  mount();
  expect(screen.queryByRole("button", { name: "Add in Transactions" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(screen.getByRole("button", { name: "Connect bank" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Track account manually" })).not.toBeInTheDocument();
});
it("keeps incomplete setup from exposing ordinary transaction creation", async () => {
  state.snapshot = snapshot("auto", 0, false);
  mount();
  expect(screen.queryByRole("button", { name: "Add in Transactions" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(screen.getByRole("button", { name: "Connect bank" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Track account manually" })).toBeVisible();
});
it("keeps correction tasks free of ordinary creation while retaining correction view controls", () => {
  state.snapshot = snapshot("show", 0);
  mount("/finances/transactions?financeTask=correct");
  expect(screen.queryByRole("button", { name: "Add in Transactions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add in Finances" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
});

it.each([
  "pending",
  "error",
] as const)("fails closed for capture during a %s readiness read while keeping linking available", async (queryState) => {
  state.snapshot = snapshot("show", 1);
  state.queryState = queryState;
  mount();
  expect(screen.queryByRole("button", { name: "Add in Transactions" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(screen.getByRole("button", { name: "Connect bank" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Track account manually" })).not.toBeInTheDocument();
});
