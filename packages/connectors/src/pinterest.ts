import { type PinterestPin, pinterestBoardUrlSchema } from "@personal-os/domain";

export class PinterestBoardError extends Error {
  constructor(
    public readonly code: "invalid_request" | "not_found" | "service_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PinterestBoardError";
  }
}

const MAX_BOARD_BYTES = 4 * 1024 * 1024;
const BOARD_TIMEOUT_MS = 10_000;

/** Public board HTML is provider material: callers never receive an arbitrary fetch capability. */
export async function fetchPinterestBoardPins(
  rawUrl: string,
  requestFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<PinterestPin[]> {
  const parsed = pinterestBoardUrlSchema.safeParse(rawUrl);
  if (!parsed.success) {
    throw new PinterestBoardError(
      "invalid_request",
      "Provide the URL of a public Pinterest board.",
    );
  }
  const url = new URL(parsed.data);
  // Normalize regional/apex URLs before fetching. Do not follow provider open redirects.
  url.hostname = "www.pinterest.com";
  url.search = "";
  url.hash = "";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new PinterestBoardError(
          "service_unavailable",
          "Pinterest took too long to load the public board. Retry.",
        ),
      );
    }, BOARD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await requestFetch(url.toString(), {
          headers: { "user-agent": "nohmi wallpaper/1.0" },
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new PinterestBoardError(
            "service_unavailable",
            "Pinterest could not load that public board right now.",
          );
        }
        if (Number(response.headers.get("content-length")) > MAX_BOARD_BYTES) {
          await response.body?.cancel();
          throw new PinterestBoardError(
            "service_unavailable",
            "The Pinterest board response exceeded the 4 MiB limit.",
          );
        }
        const reader = response.body?.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        let size = 0;
        let page = "";
        if (reader) {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > MAX_BOARD_BYTES) {
                throw new PinterestBoardError(
                  "service_unavailable",
                  "The Pinterest board response exceeded the 4 MiB limit.",
                );
              }
              page += decoder.decode(chunk.value, { stream: true });
            }
            page += decoder.decode();
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
            activeReader = undefined;
          }
        }
        const images = new Set<string>();
        for (const match of page.matchAll(
          /https:\/\/i\.pinimg\.com\/(?:\d+x|originals)\/[^"\\\s?]+?\.(?:avif|jpe?g|png|webp)/gi,
        )) {
          const image = match[0].replace(/\/\d+x\//, "/736x/");
          if (image.length <= 2048) images.add(image);
          if (images.size >= 100) break;
        }
        if (!images.size) {
          throw new PinterestBoardError(
            "not_found",
            "Pinterest did not expose any images from that public board.",
          );
        }
        return [...images].map((imageUrl) => ({ id: imageUrl, imageUrl, title: null }));
      })(),
    ]);
  } catch (error) {
    if (error instanceof PinterestBoardError) throw error;
    throw new PinterestBoardError(
      "service_unavailable",
      "Pinterest could not load that public board right now.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    void activeReader?.cancel().catch(() => undefined);
  }
}
