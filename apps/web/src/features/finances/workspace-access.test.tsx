// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceWorkspaceAccess } from "./workspace-access";

const mocks = vi.hoisted(() => ({
  state: {
    snapshot: undefined as unknown,
    readiness: undefined as unknown,
    isPending: true,
    isError: false,
    error: null as unknown,
    reload: vi.fn(),
  },
  error: vi.fn(),
}));
vi.mock("./use-finance-workspace-readiness", () => ({
  useFinanceWorkspaceReadiness: () => mocks.state,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, loading: vi.fn(), dismiss: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  mocks.state.snapshot = undefined;
  mocks.state.readiness = undefined;
  mocks.state.isPending = true;
  mocks.state.isError = false;
  mocks.state.error = null;
  vi.clearAllMocks();
});
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/finances/setup" element={<p>Setup route</p>} />
        <Route
          path="*"
          element={
            <FinanceWorkspaceAccess>
              <p>Domain task</p>
            </FinanceWorkspaceAccess>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
it("does not infer new access or redirect from loading or failure", async () => {
  const mounted = show("/finances/spending");
  expect(screen.queryByText("Setup route")).toBeNull();
  expect(screen.queryByText("Domain task")).toBeNull();
  mounted.unmount();
  mocks.state.isPending = false;
  mocks.state.isError = true;
  mocks.state.error = new Error("offline");
  show("/finances/spending");
  expect(screen.queryByText("Setup route")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry Finance setup" })).toBeTruthy();
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
});
it("routes confirmed new owners to setup but preserves task-specific repairs", () => {
  mocks.state.snapshot = { existingAccess: false, completedAt: null };
  mocks.state.readiness = { workspaceAccessible: false };
  let view = show("/finances/transactions");
  expect(screen.getByText("Setup route")).toBeTruthy();
  view.unmount();
  view = show("/finances/transactions?financeTask=correct");
  expect(screen.getByText("Domain task")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Return to setup" })).toBeTruthy();
  view.unmount();
  show("/finances/spending?financeTask=correct");
  expect(screen.getByText("Setup route")).toBeTruthy();
});
it.each([
  "accounts",
  "chat",
  "automations",
  "review",
  "activity",
])("keeps %s repair/evidence reachable without access evidence", (section) => {
  show(`/finances/${section}`);
  expect(screen.getByText("Domain task")).toBeTruthy();
});
it.each([
  { completedAt: "2026-10-18T00:00:00Z", existingAccess: false },
  { completedAt: null, existingAccess: true },
])("never relocks completed or grandfathered owners", (snapshot) => {
  mocks.state.snapshot = snapshot;
  mocks.state.readiness = { workspaceAccessible: true };
  show("/finances/spending");
  expect(screen.getByText("Domain task")).toBeTruthy();
  expect(screen.queryByText("Setup route")).toBeNull();
});
