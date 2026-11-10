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

it("requests body-free summaries with stable pagination and inbox search", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ threads: [{ id: "summary" }] })));
  const client = createApiClient({ baseUrl: "https://example.test", fetch });
  await expect(
    client.listMailThreadSummaries({
      mailboxRole: "inbox",
      query: "board packet",
      limit: 50,
      beforeId: "last",
      beforeReceivedAt: "2026-11-09T12:00:00.000Z",
    }),
  ).resolves.toEqual([{ id: "summary" }]);
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe("/v1/mail/thread-summaries");
  expect(url.searchParams.get("query")).toBe("board packet");
  expect(url.searchParams.get("beforeId")).toBe("last");
});
