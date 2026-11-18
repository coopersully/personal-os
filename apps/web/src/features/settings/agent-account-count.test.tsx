// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { agentAccountFixture } from "../../test-fixtures/agent-account";
import { useSettingsSidebarCounts } from "./sidebar-counts";

const api = vi.hoisted(() => ({
  listAgentAccounts: vi.fn(),
  listGoals: vi.fn().mockResolvedValue([]),
  listMotives: vi.fn().mockResolvedValue([]),
  listConnectors: vi.fn().mockResolvedValue([]),
  getXBookmarkAccount: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../api.js", () => ({ api }));

it("counts three shared accounts even when they own twenty connections", async () => {
  api.listAgentAccounts.mockResolvedValue({
    accounts: ["one", "two", "three", "previous"].map((id) => ({ ...agentAccountFixture, id })),
    connections: Array.from({ length: 20 }, (_, index) => ({
      id: `connection-${index}`,
      agentAccountId: ["one", "two", "three"][index % 3],
      label: "Connection",
      scopes: [],
      active: index % 3 !== 2,
      lastUsedAt: null,
    })),
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner-a" });
  const { result } = renderHook(() => useSettingsSidebarCounts(true), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current["agent-connections"]).toBe(3));
});
