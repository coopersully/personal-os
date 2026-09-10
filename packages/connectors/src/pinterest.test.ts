import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPinterestBoardPins } from "./pinterest.js";

const board = "https://www.pinterest.com/example/board/";
const image = '"https://i.pinimg.com/236x/first.jpg"';

afterEach(() => vi.useRealTimers());

describe("Pinterest public board connector", () => {
  it("normalizes regional board hosts and extracts only bounded Pinterest images", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            image,
            image,
            '"https://i.pinimg.com/originals/second.webp"',
            '"https://evil.test/private.png"',
          ].join(" "),
        ),
      );
    const pins = await fetchPinterestBoardPins(
      "https://uk.pinterest.com/example/board/?source=x#saved",
      fetch,
    );
    expect(fetch).toHaveBeenCalledWith(
      board,
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
    expect(pins.map((p) => p.imageUrl)).toEqual([
      "https://i.pinimg.com/736x/first.jpg",
      "https://i.pinimg.com/originals/second.webp",
    ]);
    const bounded = await fetchPinterestBoardPins(
      board,
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `"https://i.pinimg.com/236x/${"a".repeat(2100)}.jpg" ` +
              Array.from({ length: 110 }, (_, i) => `"https://i.pinimg.com/236x/${i}.png"`).join(
                " ",
              ),
          ),
        ),
    );
    expect(bounded).toHaveLength(100);
  });

  it("rejects untrusted URLs without making a network request", async () => {
    const fetch = vi.fn();
    for (const url of [
      "http://pinterest.com/a/b/",
      "https://pinterest.com:444/a/b/",
      "https://user:pass@pinterest.com/a/b/",
      "https://pinterest.com.evil.test/a/b/",
      "https://pinterest.com/a/",
    ]) {
      await expect(fetchPinterestBoardPins(url, fetch)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects redirects, provider failures, network failures and empty bodies", async () => {
    for (const response of [
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
      new Response("Unavailable", { status: 503 }),
    ]) {
      await expect(
        fetchPinterestBoardPins(board, vi.fn().mockResolvedValue(response)),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    }
    await expect(
      fetchPinterestBoardPins(board, vi.fn().mockRejectedValue(new Error("network"))),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    for (const response of [new Response(null), new Response("No image data")]) {
      await expect(
        fetchPinterestBoardPins(board, vi.fn().mockResolvedValue(response)),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it("enforces advertised and streamed 4 MiB limits", async () => {
    await expect(
      fetchPinterestBoardPins(
        board,
        vi
          .fn()
          .mockResolvedValue(new Response(image, { headers: { "content-length": "9999999" } })),
      ),
    ).rejects.toThrow("4 MiB");
    const cancel = vi.fn();
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(++sent === 1 ? 4 * 1024 * 1024 : 1));
      },
      cancel,
    });
    await expect(
      fetchPinterestBoardPins(board, vi.fn().mockResolvedValue(new Response(stream))),
    ).rejects.toThrow("4 MiB");
    expect(cancel).toHaveBeenCalled();
    const exact = new Response(image + " ".repeat(4 * 1024 * 1024 - image.length));
    await expect(
      fetchPinterestBoardPins(board, vi.fn().mockResolvedValue(exact)),
    ).resolves.toHaveLength(1);
  });

  it("bounds both a stalled connection and a stalled response stream", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    const request = fetchPinterestBoardPins(board, fetch);
    const rejection = expect(request).rejects.toMatchObject({ code: "service_unavailable" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const stalled = fetchPinterestBoardPins(board, vi.fn().mockResolvedValue(new Response(stream)));
    const stalledRejection = expect(stalled).rejects.toMatchObject({ code: "service_unavailable" });
    await vi.advanceTimersByTimeAsync(10_000);
    await stalledRejection;
    expect(cancel).toHaveBeenCalled();
  });
});
