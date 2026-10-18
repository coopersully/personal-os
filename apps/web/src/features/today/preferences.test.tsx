// @vitest-environment jsdom
import { resolveTodaySettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/api";
import { useSaveTodayPreferences, useTodayPreferences } from "./preferences";

afterEach(() => vi.restoreAllMocks());
it("shares queued Today saves across controls without losing unrelated preferences", async () => {
  let settings = resolveTodaySettings(null);
  vi.spyOn(api, "getTodaySettings").mockImplementation(async () => settings);
  vi.spyOn(api, "updateTodaySettings").mockImplementation(async (input) => {
    expect(input.expectedRevision).toBe(settings.revision);
    settings = resolveTodaySettings({
      ...settings.preferences,
      ...Object.fromEntries(
        Object.entries(input.preferences).filter(([, value]) => value !== undefined),
      ),
      revision: settings.revision + 1,
    });
    return settings;
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  const hook = renderHook(
    () => ({
      query: useTodayPreferences(),
      a: useSaveTodayPreferences(),
      b: useSaveTodayPreferences(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
  act(() => {
    hook.result.current.a.mutate({ background: "weather" });
    hook.result.current.b.mutate({ showSpending: true });
  });
  await waitFor(() => expect(hook.result.current.b.isSuccess).toBe(true));
  expect(settings).toMatchObject({
    revision: 2,
    preferences: { background: "weather", showSpending: true },
  });
});
