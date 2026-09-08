import { ApiClientError, createApiClient } from "./client.js";

describe("task workspace typed HTTP client", () => {
  it("serializes all query axes without losing exact offsets, literals or the returned total", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ items: [], nextCursor: "next.signed", total: 27 }));
    const api = createApiClient({ baseUrl: "https://nohmi.example", token: "test-token", fetch });
    const page = await api.listTaskWorkspace({
      kind: "all",
      view: "history",
      status: "completed",
      query: "100% & ready",
      priority: "high",
      tag: "a/b",
      due: "dated",
      reserved: "scheduled",
      dueAfter: "2026-09-03T01:00:00+02:00",
      dueBefore: "2026-09-04T00:00:00Z",
      scheduledAfter: "2026-09-03T00:00:00Z",
      scheduledBefore: "2026-09-04T00:00:00Z",
      sort: "priority",
      group: "date",
      cursor: "opaque.signed",
      limit: 7,
    });
    expect(page).toEqual({ items: [], nextCursor: "next.signed", total: 27 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v1/task-workspace");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      kind: "all",
      view: "history",
      status: "completed",
      query: "100% & ready",
      priority: "high",
      tag: "a/b",
      due: "dated",
      reserved: "scheduled",
      dueAfter: "2026-09-03T01:00:00+02:00",
      dueBefore: "2026-09-04T00:00:00Z",
      scheduledAfter: "2026-09-03T00:00:00Z",
      scheduledBefore: "2026-09-04T00:00:00Z",
      sort: "priority",
      group: "date",
      cursor: "opaque.signed",
      limit: "7",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    expect(init?.body).toBeUndefined();
  });

  it("preserves API scope errors and permits an omitted query", async () => {
    const api = createApiClient({
      baseUrl: "https://nohmi.example",
      fetch: async () =>
        Response.json(
          {
            error: {
              code: "forbidden",
              message: "Both read scopes required",
              requestId: "workspace",
            },
          },
          { status: 403 },
        ),
    });
    await expect(api.listTaskWorkspace()).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.listTaskWorkspace({ kind: "reminder" })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
      requestId: "workspace",
    });
  });
});
