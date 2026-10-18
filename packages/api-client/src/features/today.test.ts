import { createTodayApiClient } from "./today.js";

it("sends typed Today settings and encodes weekly filters", async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push([path, init]);
    return {} as T;
  };
  const api = createTodayApiClient(request);
  await api.getTodaySettings();
  await api.updateTodaySettings({ expectedRevision: 3, preferences: { background: "map" } });
  await api.getTodayCommitments({
    filter: "reminders",
    includeUndated: true,
    cursor: "a/b",
    limit: 6,
  });
  expect(calls[0]?.[0]).toBe("/v1/today/settings");
  expect(calls[1]).toEqual([
    "/v1/today/settings",
    {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: 3, preferences: { background: "map" } }),
    },
  ]);
  expect(calls[2]?.[0]).toBe(
    "/v1/today/commitments?filter=reminders&includeUndated=true&cursor=a%2Fb&limit=6",
  );
});
