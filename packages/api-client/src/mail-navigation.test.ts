import { createApiClient } from "./client.js";

it("reads full Mail destination totals in the selected account scope", async () => {
  const counts = { all: 315, unread: 20, starred: 5, snoozed: 2, sent: 21, drafts: 3 };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ counts }));
  const api = createApiClient({ baseUrl: "https://nohmi.example", token: "test-token", fetch });
  expect(await api.getMailNavigationCounts(["one", "two"])).toEqual(counts);
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/v1/mail/counts");
  expect(url.searchParams.get("accountIds")).toBe("one,two");
});
