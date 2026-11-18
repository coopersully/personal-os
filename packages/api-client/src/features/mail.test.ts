import { createApiClient } from "../client.js";

it("passes attachment cancellation through to fetch without requiring a signal for existing callers", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        attachment: { filename: "a.txt", contentType: "text/plain", data: "YQ==", size: 1 },
      }),
    ),
  );
  const client = createApiClient({ baseUrl: "https://example.test", fetch });
  await expect(client.downloadMailAttachment("message/id", "file/id")).resolves.toMatchObject({
    data: "YQ==",
  });
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://example.test/v1/mail/messages/message%2Fid/attachments/file%2Fid",
  );
  const controller = new AbortController();
  fetch.mockImplementationOnce(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
  const pending = client.downloadMailAttachment("message", "file", controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(fetch.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
});

it("requests body-free summaries with filters and the page cursor", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ threads: [{ id: "summary" }] })));
  const client = createApiClient({ baseUrl: "https://example.test", fetch });

  await expect(
    client.listMailThreadSummaries({
      accountIds: ["one", "two"],
      beforeId: "last",
      beforeReceivedAt: "2026-11-09T12:00:00.000Z",
      limit: 50,
      mailboxRole: "inbox",
      query: "board packet",
    }),
  ).resolves.toEqual([{ id: "summary" }]);
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/v1/mail/thread-summaries");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    accountIds: "one,two",
    beforeId: "last",
    beforeReceivedAt: "2026-11-09T12:00:00.000Z",
    limit: "50",
    mailboxRole: "inbox",
    query: "board packet",
  });
});

it("keeps the web thread list on the full thread endpoint", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ threads: [] })));
  const client = createApiClient({ baseUrl: "https://example.test", fetch });

  await client.listMailThreads({ mailboxRole: "inbox" });
  await client.listMailThreadSummaries();

  expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/v1/mail/threads",
    "/v1/mail/thread-summaries",
  ]);
});
