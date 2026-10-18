// @vitest-environment jsdom
import type { FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFinanceWorkspaceReadiness } from "./use-finance-workspace-readiness";

const read = vi.hoisted(() => vi.fn());
vi.mock("./onboarding-adapter", () => ({
  financeOnboardingApiAdapter: { getFinanceOnboarding: read },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const snapshot = (
  count: number,
  visibility: "auto" | "show" | "hide" = "auto",
): FinanceOnboardingSnapshot => ({
  revision: 0,
  completedAt: null,
  existingAccess: false,
  source: { state: "missing", summary: "Missing", recoveryHref: "/finances/accounts" },
  contextReview: "needs_review",
  questions: [],
  displayPreferences: { reviewed: false, summary: [] },
  automationChoice: null,
  manualVisibility: visibility,
  automation: {
    registrationCount: count,
    authorizedRegistrationWithCadence: false,
    chatVerification: "pending",
    canSendChat: false,
    historyAvailable: true,
  },
});
function fixture(owner: string | null = "owner") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (owner) client.setQueryData(["me"], { id: owner });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
it.each([
  [0, "auto", true],
  [1, "auto", false],
  [1, "show", true],
  [0, "hide", false],
] as const)("uses actual registration count %s and preference %s", async (count, visibility, expected) => {
  read.mockResolvedValue(snapshot(count, visibility));
  const { wrapper } = fixture();
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(result.current.manualCreationVisible).toBe(expected));
  expect(result.current.readiness?.workspaceAccessible).toBe(false);
});
it("does not fabricate readiness before owner identity or after transport failure", async () => {
  const { wrapper } = fixture(null);
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  expect(read).not.toHaveBeenCalled();
  expect(result.current.manualCreationVisible).toBeUndefined();
  cleanup();
  read.mockRejectedValue(new Error("offline"));
  const owned = fixture();
  const mounted = renderHook(useFinanceWorkspaceReadiness, { wrapper: owned.wrapper });
  await waitFor(() => expect(mounted.result.current.isError).toBe(true));
  expect(mounted.result.current.snapshot).toBeUndefined();
});
it("discards an in-flight response when the account changes", async () => {
  let resolve!: (value: FinanceOnboardingSnapshot) => void;
  read.mockReturnValueOnce(
    new Promise<FinanceOnboardingSnapshot>((r) => {
      resolve = r;
    }),
  );
  const { wrapper, client } = fixture("first");
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  read.mockResolvedValue(snapshot(1));
  act(() => client.setQueryData(["me"], { id: "second" }));
  await act(async () => resolve({ ...snapshot(0), existingAccess: true }));
  await waitFor(() => expect(result.current.manualCreationVisible).toBe(false));
  expect(result.current.snapshot?.existingAccess).toBe(false);
});
