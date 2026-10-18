// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceOnboardingSnapshot } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { captureFinanceOnboardingAccess, denyFinanceOnboardingAccess } from "./onboarding-access";
import {
  financeWorkspaceReadinessKey,
  useFinanceWorkspaceReadiness,
} from "./use-finance-workspace-readiness";

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

it.each([
  401, 403,
])("suppresses same-owner cached access after authoritative %s and recovers only by fresh read", async (status) => {
  read.mockResolvedValue({ ...snapshot(0), existingAccess: true });
  const { wrapper, client } = fixture();
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(result.current.readiness?.workspaceAccessible).toBe(true));
  read.mockRejectedValueOnce(new ApiClientError({ status, code: "forbidden", message: "Denied" }));
  await act(async () => {
    await result.current.reload().catch(() => undefined);
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.snapshot).toBeUndefined();
  expect(result.current.readiness).toBeUndefined();
  expect(result.current.manualCreationVisible).toBeUndefined();
  expect(client.getQueryData(financeWorkspaceReadinessKey)).toBeUndefined();
  expect(client.getQueryData(["me"])).toEqual({ id: "owner" });
  read.mockResolvedValue({ ...snapshot(1), existingAccess: true });
  await act(async () => {
    await result.current.reload();
  });
  await waitFor(() => expect(result.current.readiness?.workspaceAccessible).toBe(true));
  expect(result.current.manualCreationVisible).toBe(false);
});
it("preserves the last valid same-owner projection after a transient failure", async () => {
  read.mockResolvedValue({ ...snapshot(0), existingAccess: true });
  const { wrapper } = fixture();
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(result.current.readiness?.workspaceAccessible).toBe(true));
  read.mockRejectedValueOnce(
    new ApiClientError({ status: 503, code: "unavailable", message: "Offline" }),
  );
  await act(async () => {
    await result.current.reload().catch(() => undefined);
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.readiness?.workspaceAccessible).toBe(true);
  expect(result.current.manualCreationVisible).toBe(true);
});
it("cannot restore a late read from before same-owner denial even after recovery", async () => {
  let resolve!: (value: FinanceOnboardingSnapshot) => void;
  read.mockReturnValueOnce(
    new Promise<FinanceOnboardingSnapshot>((r) => {
      resolve = r;
    }),
  );
  const { wrapper, client } = fixture();
  const { result } = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  act(() => {
    denyFinanceOnboardingAccess(
      client,
      captureFinanceOnboardingAccess(client),
      new ApiClientError({ status: 403, code: "forbidden", message: "Denied" }),
    );
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  read.mockResolvedValue({ ...snapshot(1), existingAccess: false });
  await act(async () => {
    await result.current.reload();
  });
  await waitFor(() => expect(result.current.snapshot?.automation.registrationCount).toBe(1));
  await act(async () => {
    resolve({ ...snapshot(0), existingAccess: true });
  });
  expect(result.current.snapshot?.existingAccess).toBe(false);
  expect(result.current.manualCreationVisible).toBe(false);
});

it("ignores a canceled read denial after a fresh same-owner read succeeds", async () => {
  let reject!: (reason: unknown) => void;
  read.mockReturnValueOnce(
    new Promise<FinanceOnboardingSnapshot>((_, r) => {
      reject = r;
    }),
  );
  const { wrapper, client } = fixture();
  const mounted = renderHook(useFinanceWorkspaceReadiness, { wrapper });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => {
    await client.cancelQueries({ queryKey: financeWorkspaceReadinessKey });
  });
  read.mockResolvedValue({ ...snapshot(1), existingAccess: true });
  await act(async () => {
    await mounted.result.current.reload();
  });
  await waitFor(() => expect(mounted.result.current.readiness?.workspaceAccessible).toBe(true));
  await act(async () => {
    reject(new ApiClientError({ status: 403, code: "forbidden", message: "Old denial" }));
  });
  expect(mounted.result.current.isError).toBe(false);
  expect(mounted.result.current.snapshot?.existingAccess).toBe(true);
});
