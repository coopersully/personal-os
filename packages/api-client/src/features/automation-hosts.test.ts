import { createApiClient } from "../client.js";

it("keeps host setup and continuation identifiers exact at the authenticated API boundary", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
  const api = createApiClient({ baseUrl: "https://example.test", fetch });
  await api.getFinanceContinuations("host/id");
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://example.test/v1/automation-hosts/host%2Fid/continuations",
  );
  await api.bindFinanceAnswerContinuation("answer/id", "host/id");
  expect(fetch.mock.calls[1]?.[0]).toBe(
    "https://example.test/v1/automation-hosts/answers/answer%2Fid/bind",
  );
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ scheduleId: "host/id" });
  await api.cancelAutomationHostSchedule("host/id", {
    expectedVersion: 7,
    expectedState: "setup_pending",
  });
  expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
    expectedVersion: 7,
    expectedState: "setup_pending",
  });
  fetch.mockResolvedValueOnce(
    Response.json(
      { error: { code: "conflict", message: "The host schedule changed." } },
      { status: 409 },
    ),
  );
  await expect(
    api.updateAutomationHostSchedule("host/id", { expectedVersion: 7, label: "New name" }),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("loads every owner-bound answer page and fails if a cursor repeats", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ continuations: [{ id: "first" }], nextCursor: "next/id" }),
    )
    .mockResolvedValueOnce(Response.json({ continuations: [{ id: "last" }], nextCursor: null }));
  const api = createApiClient({ baseUrl: "https://example.test", fetch });
  await expect(api.listFinanceAnswerContinuations()).resolves.toEqual([
    { id: "first" },
    { id: "last" },
  ]);
  expect(fetch.mock.calls[1]?.[0]).toBe(
    "https://example.test/v1/automation-hosts/answers?cursor=next%2Fid",
  );
  fetch.mockImplementation(async () => Response.json({ continuations: [], nextCursor: "repeat" }));
  await expect(api.listFinanceAnswerContinuations()).rejects.toThrow("cursor did not advance");
});
