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
