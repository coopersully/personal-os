import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { resetDesktopSession } from "./session.js";

it("clears private data and refetches mounted session observers without reloading the webview", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["private"], "old account");
  cache.setQueryData(["me"], "old user");
  const observer = new QueryObserver(cache, {
    queryKey: ["me"],
    queryFn: async () => "signed out",
    staleTime: Infinity,
  });
  const values: unknown[] = [];
  const stop = observer.subscribe((result) => values.push(result.data));
  await resetDesktopSession(cache);
  expect(cache.getQueryData(["private"])).toBeUndefined();
  expect(values).toContain(undefined);
  expect(observer.getCurrentResult().data).toBe("signed out");
  stop();
  cache.clear();
});
